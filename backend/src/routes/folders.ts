import { Router } from "express";
import { v4 as uuid } from "uuid";
import archiver from "archiver";
import { db, FolderRecord } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { hashFolderPassword, verifyFolderPassword, deriveFolderFileKey } from "../utils/crypto";
import { getClientForUser } from "../telegram/client";
import { downloadFile, streamFileToResponse } from "../telegram/fileService";

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

router.get("/tree/all", async (req: AuthedRequest, res) => {
  await db.read();
  // Filter out the root folder if we just want subfolders, or just return all folders.
  // We'll return everything so the frontend can build a tree.
  const allFolders = db.data!.folders.map(f => ({
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    locked: f.locked,
  }));
  res.json({ folders: allFolders });
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

router.post("/:folderId/unlock", async (req: AuthedRequest, res) => {
  const { password } = req.body;
  await db.read();
  const folder = db.data!.folders.find((f) => f.id === req.params.folderId);
  if (!folder?.locked) return res.status(400).json({ error: "Folder is not locked" });
  
  const ok = !!folder.passwordHash && !!folder.salt && verifyFolderPassword(password, folder.passwordHash, folder.salt);
  if (!ok) return res.status(403).json({ error: "Wrong password" });

  const hasEncrypted = db.data!.files.some(f => f.folderId === folder.id && f.encrypted);
  if (hasEncrypted) {
    return res.status(400).json({ error: "Cannot unlock folder: it contains encrypted files. Please move or delete them first." });
  }

  folder.locked = false;
  folder.passwordHash = undefined;
  folder.salt = undefined;
  await db.write();
  res.json({ ok: true });
});

router.delete("/:folderId", async (req: AuthedRequest, res) => {
  await db.read();
  const id = req.params.folderId;

  // Recursive: gather this folder + every descendant folder id, then
  // remove all files under any of them. Without this, deleting a folder
  // that has subfolders orphaned them - they'd vanish from navigation
  // but stay in the DB forever.
  const toDelete = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of db.data!.folders) {
      if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
        toDelete.add(f.id);
        grew = true;
      }
    }
  }

  // Note: this only removes metadata. Chunks already sent to Telegram for
  // files inside are NOT deleted from the storage channel automatically
  // in this scaffold.
  db.data!.files = db.data!.files.filter((f) => !toDelete.has(f.folderId));
  db.data!.folders = db.data!.folders.filter((f) => !toDelete.has(f.id));
  await db.write();
  res.json({ ok: true });
});

// Move a folder under a different parent. Refuses to move a folder into
// itself or into one of its own descendants (that would orphan it).
router.post("/:folderId/move", async (req: AuthedRequest, res) => {
  const { newParentId } = req.body;
  if (!newParentId) return res.status(400).json({ error: "newParentId is required" });

  await db.read();
  const folder = db.data!.folders.find((f) => f.id === req.params.folderId);
  const target = db.data!.folders.find((f) => f.id === newParentId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  if (!target) return res.status(404).json({ error: "Destination folder not found" });

  if (folder.id === newParentId) {
    return res.status(400).json({ error: "Can't move a folder into itself" });
  }
  let walk: string | null = target.id;
  while (walk) {
    if (walk === folder.id) {
      return res.status(400).json({ error: "Can't move a folder into one of its own subfolders" });
    }
    const parent: any = db.data!.folders.find((f) => f.id === walk);
    walk = parent?.parentId ?? null;
  }

  folder.parentId = newParentId;
  await db.write();
  res.json({ ok: true });
});

router.post("/:folderId/rename", async (req: AuthedRequest, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  await db.read();
  const folder = db.data!.folders.find((f) => f.id === req.params.folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });

  folder.name = name.trim();
  await db.write();
  res.json({ ok: true });
});

// Download an entire folder (recursively) as a single zip. The password
// (if the target folder itself is locked) decrypts its own direct files;
// any nested subfolder that's ALSO locked gets skipped in the archive
// (its password isn't known here) with a small note file in its place,
// rather than failing the whole download.
router.get("/:folderId/download-zip", async (req: AuthedRequest, res) => {
  await db.read();
  const root = db.data!.folders.find((f) => f.id === req.params.folderId);
  if (!root) return res.status(404).json({ error: "Folder not found" });

  const rootPassword = (req.query.password as string) || "";
  if (root.locked) {
    if (!root.passwordHash || !root.salt || !verifyFolderPassword(rootPassword, root.passwordHash, root.salt)) {
      return res.status(403).json({ error: "Wrong or missing folder password" });
    }
  }

  const client = await getClientForUser(req.userId!);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(root.name)}.zip"`);

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err: any) => {
    console.error("Zip archive error:", err);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  archive.pipe(res);

  async function addFolder(folder: FolderRecord, zipPath: string) {
    const isRootFolder = folder.id === root!.id;
    const password = isRootFolder ? rootPassword : undefined;

    if (folder.locked && !isRootFolder) {
      archive.append(`This folder is locked and was skipped - open it in the app with its password.`, {
        name: `${zipPath}/LOCKED.txt`,
      });
      return;
    }

    const files = db.data!.files.filter((f) => f.folderId === folder.id);
    for (const file of files) {
      const fileKey = file.encrypted && password ? deriveFolderFileKey(password, folder.salt!) : undefined;
      try {
        const { PassThrough } = require("stream");
        const pt = new PassThrough();
        archive.append(pt, { name: `${zipPath}/${file.name}` });
        await streamFileToResponse(client, file, pt, fileKey);
      } catch (err: any) {
        archive.append(`Could not include this file: ${err.message}`, { name: `${zipPath}/${file.name}.error.txt` });
      }
    }

    const subfolders = db.data!.folders.filter((f) => f.parentId === folder.id);
    for (const sub of subfolders) {
      await addFolder(sub, `${zipPath}/${sub.name}`);
    }
  }

  try {
    await addFolder(root, root.name);
    await archive.finalize();
  } catch (err: any) {
    // headers likely already sent (streaming zip) - best effort abort
    archive.abort();
    res.end();
  }
});

export default router;
