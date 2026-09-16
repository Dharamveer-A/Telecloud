import { Router } from "express";
import multer from "multer";
import os from "os";
import { db } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getClientForUser } from "../telegram/client";
import { uploadFile, downloadFile, streamFileRangeToResponse, streamFileToResponse } from "../telegram/fileService";
import { verifyFolderPassword, deriveFolderFileKey } from "../utils/crypto";

const router = Router();
router.use(requireAuth);

// We use diskStorage so large files (e.g. 5GB) don't crash Node by being fully loaded into RAM.
const upload = multer({ dest: os.tmpdir() });

const progressEmitters = new Map<string, (progress: number) => void>();

router.get("/upload-progress/:id", (req, res) => {
  const id = req.params.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  
  const listener = (progress: number) => {
    res.write(`data: ${JSON.stringify({ progress })}\n\n`);
  };
  progressEmitters.set(id, listener);
  req.on("close", () => progressEmitters.delete(id));
});

router.post("/upload", upload.single("file"), async (req: AuthedRequest, res) => {
  const { folderId, password, name, progressId } = req.body;
  const file = req.file;
  if (!folderId || !file) return res.status(400).json({ error: "folderId and file are required" });
  // `name` lets the client rename a file at upload time (e.g. from the
  // drag-and-drop wizard) without touching the local file on disk. Falls
  // back to the file's own name when not provided.
  const displayName = (name && String(name).trim()) || file.originalname;

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
      filename: displayName,
      mimeType: file.mimetype,
      filePath: file.path,
      size: file.size,
      fileKey,
      progressCallback: progressId ? (progress: number) => {
        const listener = progressEmitters.get(progressId);
        if (listener) listener(progress);
      } : undefined,
    });
    res.json({ file: { id: record.id, name: record.name, size: record.size, mimeType: record.mimeType } });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Upload failed" });
  } finally {
    import("fs/promises").then(fsp => fsp.unlink(file.path).catch(()=>{}));
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

  const rangeHeader = req.headers.range;

  try {
    const client = await getClientForUser(req.userId!);
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);

    // Range requests (what <video>/<audio> use for streaming + seeking)
    // are only safe to serve chunk-by-chunk for UNENCRYPTED files - AES-GCM
    // needs the full ciphertext to verify its auth tag, so locked-folder
    // files always fall back to a full download below, which still works,
    // just without instant seeking on very large files.
    if (rangeHeader && !file.encrypted) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const end = match?.[2] ? parseInt(match[2], 10) : file.size - 1;
      const clampedEnd = Math.min(end, file.size - 1);
      const length = clampedEnd - start + 1;

      res.status(206);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Range", `bytes ${start}-${clampedEnd}/${file.size}`);
      res.setHeader("Content-Length", length.toString());
      await streamFileRangeToResponse(client, file, res, start, clampedEnd);
      return;
    }

    res.setHeader("Accept-Ranges", file.encrypted ? "none" : "bytes");
    await streamFileToResponse(client, file, res, fileKey);
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

// Move a file to a different folder. Restricted to unlocked -> unlocked
// moves: a file's encryption key is derived from its ORIGINAL folder's
// password, so moving it into/out of a locked folder would either leave
// it silently unencrypted despite looking "locked", or leave it
// permanently tied to a password that folder no longer has. Re-upload
// into the locked folder instead if that's what you need.
router.post("/:fileId/move", async (req: AuthedRequest, res) => {
  const { folderId } = req.body;
  if (!folderId) return res.status(400).json({ error: "folderId is required" });

  await db.read();
  const file = db.data!.files.find((f) => f.id === req.params.fileId);
  const dest = db.data!.folders.find((f) => f.id === folderId);
  if (!file) return res.status(404).json({ error: "File not found" });
  if (!dest) return res.status(404).json({ error: "Destination folder not found" });

  if (file.encrypted || dest.locked) {
    return res.status(400).json({
      error: "Can't move files into or out of locked folders - download and re-upload instead",
    });
  }

  file.folderId = folderId;
  await db.write();
  res.json({ ok: true });
});

router.post("/:fileId/rename", async (req: AuthedRequest, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  await db.read();
  const file = db.data!.files.find((f) => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: "File not found" });

  file.name = name.trim();
  await db.write();
  res.json({ ok: true });
});

export default router;
