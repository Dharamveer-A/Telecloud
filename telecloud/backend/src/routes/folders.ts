import { Router } from "express";
import { v4 as uuid } from "uuid";
import { db } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { hashFolderPassword, verifyFolderPassword } from "../utils/crypto";

const router = Router();
router.use(requireAuth);

function rootIdFor(userId: string) {
  return `root_${userId}`;
}

// List a folder's direct children (subfolders + files).
// If the folder is locked, the request must include ?password=... and it
// must match, otherwise only folder metadata (name, locked flag) is
// returned - never its contents.
router.get("/:folderId", async (req: AuthedRequest, res) => {
  await db.read();
  const folder = db.data!.folders.find((f) => f.id === req.params.folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });

  if (folder.locked) {
    const password = (req.query.password as string) || "";
    const ok = folder.passwordHash && folder.salt && verifyFolderPassword(password, folder.passwordHash, folder.salt);
    if (!ok) {
      return res.status(200).json({ folder: { id: folder.id, name: folder.name, locked: true }, locked: true, subfolders: [], files: [] });
    }
  }

  const subfolders = db.data!.folders.filter((f) => f.parentId === folder.id);
  const files = db.data!.files.filter((f) => f.folderId === folder.id);
  res.json({
    folder,
    locked: false,
    subfolders: subfolders.map((f) => ({ id: f.id, name: f.name, locked: f.locked })),
    files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType, createdAt: f.createdAt, encrypted: f.encrypted })),
  });
});

router.get("/", async (req: AuthedRequest, res) => {
  // convenience: GET / -> user's root folder id
  res.json({ rootFolderId: rootIdFor(req.userId!) });
});

router.post("/", async (req: AuthedRequest, res) => {
  const { parentId, name } = req.body;
  if (!parentId || !name) return res.status(400).json({ error: "parentId and name are required" });

  await db.read();
  const parent = db.data!.folders.find((f) => f.id === parentId);
  if (!parent) return res.status(404).json({ error: "Parent folder not found" });

  const folder = { id: uuid(), parentId, name, createdAt: Date.now(), locked: false };
  db.data!.folders.push(folder);
  await db.write();
  res.json({ folder });
});

// Lock a folder with a password. Only new uploads into it will be
// encrypted; call POST /:id/relock after this if you want existing files
// re-encrypted too (not automatic, to avoid a slow surprise re-upload).
router.post("/:folderId/lock", async (req: AuthedRequest, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  await db.read();
  const folder = db.data!.folders.find((f) => f.id === req.params.folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });

  const { hash, salt } = hashFolderPassword(password);
  folder.locked = true;
  folder.passwordHash = hash;
  folder.salt = salt;
  await db.write();
  res.json({ ok: true });
});

router.post("/:folderId/unlock-check", async (req: AuthedRequest, res) => {
  const { password } = req.body;
  await db.read();
  const folder = db.data!.folders.find((f) => f.id === req.params.folderId);
  if (!folder?.locked) return res.status(400).json({ error: "Folder is not locked" });
  const ok = !!folder.passwordHash && !!folder.salt && verifyFolderPassword(password, folder.passwordHash, folder.salt);
  res.json({ ok });
});

router.delete("/:folderId", async (req: AuthedRequest, res) => {
  await db.read();
  const id = req.params.folderId;
  // Note: this only removes metadata. Chunks already sent to Telegram for
  // files inside are NOT deleted from the storage channel automatically
  // in this scaffold - add a cleanup pass in files.ts's delete route if
  // you want hard-delete from Telegram too.
  db.data!.files = db.data!.files.filter((f) => f.folderId !== id);
  db.data!.folders = db.data!.folders.filter((f) => f.id !== id);
  await db.write();
  res.json({ ok: true });
});

export default router;
