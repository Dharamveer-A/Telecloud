import { Router } from "express";
import multer from "multer";
import { db } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getClientForUser } from "../telegram/client";
import { uploadFile, downloadFile } from "../telegram/fileService";
import { verifyFolderPassword, deriveFolderFileKey } from "../utils/crypto";

const router = Router();
router.use(requireAuth);

// Files are received here fully, then streamed to Telegram - fine for a
// personal cloud; for very large files consider multer's disk storage
// instead of memory storage so the whole thing isn't held in RAM twice.
const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload", upload.single("file"), async (req: AuthedRequest, res) => {
  const { folderId, password } = req.body;
  const file = req.file;
  if (!folderId || !file) return res.status(400).json({ error: "folderId and file are required" });

  await db.read();
  const folder = db.data!.folders.find((f) => f.id === folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });

  let fileKey: Buffer | undefined;
  if (folder.locked) {
    if (!folder.passwordHash || !folder.salt || !verifyFolderPassword(password || "", folder.passwordHash, folder.salt)) {
      return res.status(403).json({ error: "Wrong or missing folder password" });
    }
    fileKey = deriveFolderFileKey(password, folder.salt);
  }

  try {
    const client = await getClientForUser(req.userId!);
    const record = await uploadFile(client, {
      userId: req.userId!,
      folderId,
      filename: file.originalname,
      mimeType: file.mimetype,
      data: file.buffer,
      fileKey,
    });
    res.json({ file: { id: record.id, name: record.name, size: record.size, mimeType: record.mimeType } });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

router.get("/:fileId/download", async (req: AuthedRequest, res) => {
  await db.read();
  const file = db.data!.files.find((f) => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: "File not found" });

  const folder = db.data!.folders.find((f) => f.id === file.folderId);
  let fileKey: Buffer | undefined;
  if (folder?.locked) {
    const password = (req.query.password as string) || "";
    if (!folder.passwordHash || !folder.salt || !verifyFolderPassword(password, folder.passwordHash, folder.salt)) {
      return res.status(403).json({ error: "Wrong or missing folder password" });
    }
    fileKey = deriveFolderFileKey(password, folder.salt);
  }

  try {
    const client = await getClientForUser(req.userId!);
    const buf = await downloadFile(client, file, fileKey);
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Download failed" });
  }
});

router.delete("/:fileId", async (req: AuthedRequest, res) => {
  await db.read();
  // See note in folders.ts: metadata-only delete in this scaffold.
  db.data!.files = db.data!.files.filter((f) => f.id !== req.params.fileId);
  await db.write();
  res.json({ ok: true });
});

export default router;
