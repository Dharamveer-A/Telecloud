import { Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { createReadStream } from "fs";
import crypto from "crypto";
import { v4 as uuid } from "uuid";
import { db } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getClientForUser } from "../telegram/client";
import { uploadFile, downloadFile, streamFileRangeToResponse, streamFileToResponse } from "../telegram/fileService";
import { inputPeerFor, getInputPeerForChatId, moveFileToTrash } from "../telegram/storageManager";
import { verifyFolderPassword, deriveFolderFileKey } from "../utils/crypto";

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

const router = Router();
router.use(requireAuth);

// We use diskStorage so large files (e.g. 5GB) don't crash Node by being fully loaded into RAM.
const upload = multer({ dest: os.tmpdir() });

const uploadProgress = new Map<string, number>();
const progressEmitters = new Map<string, (progress: number) => void>();

router.get("/upload-progress/:id", (req, res) => {
  const id = req.params.id;
  if (req.headers.accept?.includes("text/event-stream")) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    const listener = (progress: number) => {
      res.write(`data: ${JSON.stringify({ progress })}\n\n`);
    };
    progressEmitters.set(id, listener);
    req.on("close", () => progressEmitters.delete(id));
    return;
  }

  res.json({ progress: uploadProgress.get(id) ?? 0 });
});

router.get("/search", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const results = db.search(userId, q);
  res.json(results);
});

function getUniqueFileName(existingNames: Set<string>, name: string): string {
  if (!existingNames.has(name)) return name;
  const lastDot = name.lastIndexOf(".");
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot) : "";
  let counter = 1;
  while (existingNames.has(`${base} (${counter})${ext}`)) {
    counter++;
  }
  return `${base} (${counter})${ext}`;
}

router.post("/check-hash", async (req: AuthedRequest, res) => {
  const { folderId, name, size, sha256 } = req.body;
  if (!folderId || !name || typeof size !== "number" || !sha256) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const folder = db.folders.get(folderId);
  if (!folder || folder.deletedAt) {
    return res.status(404).json({ error: "Folder not found" });
  }
  if (folder.locked) {
    // Locked folders maintain zero-knowledge encryption with unique salts/keys
    return res.json({ instant: false });
  }

  const existing = db.files.byHash(req.userId!, sha256, size);
  if (!existing || !existing.chunks || existing.chunks.length === 0) {
    return res.json({ instant: false });
  }

  const existingFileNames = new Set(
    db.files.byFolder(folderId).map((f) => f.name)
  );
  const uniqueName = getUniqueFileName(existingFileNames, name);

  const newRecord = {
    id: uuid(),
    folderId,
    name: uniqueName,
    size: existing.size,
    mimeType: existing.mimeType,
    chunks: existing.chunks,
    encrypted: false,
    createdAt: Date.now(),
    telegramMessageId: existing.telegramMessageId,
    sha256: existing.sha256,
  };

  db.files.create(newRecord);
  return res.json({ instant: true, file: newRecord });
});

router.post("/upload", upload.single("file"), async (req: AuthedRequest, res) => {
  const { folderId, password, name, progressId } = req.body;
  const file = req.file;
  if (!folderId || !file) return res.status(400).json({ error: "folderId and file are required" });
  // `name` lets the client rename a file at upload time (e.g. from the
  // drag-and-drop wizard) without touching the local file on disk. Falls
  // back to the file's own name when not provided.
  const displayName = (name && String(name).trim()) || file.originalname;
  const baseName = displayName.toLowerCase().split("/").pop() || displayName.toLowerCase();
  if (baseName === ".ds_store" || baseName.startsWith("._")) {
    if (file.path) {
      import("fs/promises").then((fsp) => fsp.unlink(file.path).catch(() => {}));
    }
    return res.status(400).json({ error: "Ignored system file (.DS_Store)" });
  }

  const folder = db.folders.get(folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });

  const existingFileNames = new Set(
    db.files.byFolder(folderId).map((f) => f.name)
  );
  const uniqueName = getUniqueFileName(existingFileNames, displayName);

  let fileKey: Buffer | undefined;
  if (folder.locked) {
    if (!folder.passwordHash || !folder.salt || !verifyFolderPassword(password || "", folder.passwordHash, folder.salt)) {
      return res.status(403).json({ error: "Wrong or missing folder password" });
    }
    fileKey = deriveFolderFileKey(password, folder.salt);
  }

  try {
    const client = await getClientForUser(req.userId!);
    let sha256: string | undefined;
    if (!fileKey) {
      sha256 = await computeFileSha256(file.path).catch(() => undefined);
    }
    const record = await uploadFile(client, {
      userId: req.userId!,
      folderId,
      filename: uniqueName,
      mimeType: file.mimetype,
      filePath: file.path,
      size: file.size,
      fileKey,
      progressCallback: progressId ? (progress: number) => {
        uploadProgress.set(progressId, progress);
        const listener = progressEmitters.get(progressId);
        if (listener) listener(progress);
      } : undefined,
    });
    if (sha256) {
      db.files.update(record.id, { sha256 });
      record.sha256 = sha256;
    }
    res.json({ file: { id: record.id, name: record.name, size: record.size, mimeType: record.mimeType } });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Upload failed" });
  } finally {
    if (progressId) {
      uploadProgress.delete(progressId);
    }
    import("fs/promises").then(fsp => fsp.unlink(file.path).catch(()=>{}));
  }
});

const inFlightThumbnails = new Map<string, Promise<Buffer | null>>();

router.get("/:fileId/thumbnail", async (req: AuthedRequest, res) => {
  const file = db.files.get(req.params.fileId);
  if (!file) return res.status(404).json({ error: "File not found" });

  const isImage = file.mimeType?.startsWith("image/");
  const isVideo = file.mimeType?.startsWith("video/");
  if (!isImage && !isVideo) {
    return res.status(404).json({ error: "No thumbnail for this file type" });
  }

  const cacheDir = path.join(process.env.DATA_DIR || "./data", "thumbnails");
  await fs.mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${file.id}.jpg`);

  // 1. Check disk cache
  try {
    const stat = await fs.stat(cachePath);
    if (stat.isFile() && stat.size > 0) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      return res.sendFile(path.resolve(cachePath));
    }
  } catch {}

  // Check folder password if locked
  const folder = db.folders.get(file.folderId);
  let fileKey: Buffer | undefined;
  if (folder?.locked) {
    const password = (req.query.password as string) || "";
    if (!folder.passwordHash || !folder.salt || !verifyFolderPassword(password, folder.passwordHash, folder.salt)) {
      return res.status(403).json({ error: "Wrong or missing folder password" });
    }
    fileKey = deriveFolderFileKey(password, folder.salt);
  }

  // Deduplicate in-flight fetch for the same thumbnail
  let fetchPromise = inFlightThumbnails.get(file.id);
  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const client = await getClientForUser(req.userId!);
        const chunk = file.chunks[0];
        if (!chunk) return null;

        const peer = chunk.accessHash
          ? inputPeerFor({ chatId: chunk.chatId, accessHash: chunk.accessHash } as any)
          : await getInputPeerForChatId(client, chunk.chatId);

        const [msg] = await client.getMessages(peer, { ids: [chunk.messageId] });
        if (!msg) return null;

        let thumbBuf: Buffer | undefined;
        // Attempt to download Telegram's native thumbnail
        try {
          thumbBuf = (await client.downloadMedia(msg, { thumb: 0 })) as Buffer;
          if (!thumbBuf || thumbBuf.length === 0) {
            thumbBuf = (await client.downloadMedia(msg, { thumb: -1 })) as Buffer;
          }
        } catch {}

        if (thumbBuf && thumbBuf.length > 0) {
          await fs.writeFile(cachePath, thumbBuf).catch(() => {});
          return thumbBuf;
        }

        // If Telegram didn't store a separate thumbnail:
        // For unencrypted images <= 8MB, download the image buffer and cache it
        if (isImage && !file.encrypted && file.size <= 8 * 1024 * 1024) {
          const imgBuf = (await client.downloadMedia(msg)) as Buffer;
          if (imgBuf && imgBuf.length > 0) {
            await fs.writeFile(cachePath, imgBuf).catch(() => {});
            return imgBuf;
          }
        }

        return null;
      } catch (err) {
        console.error(`Error generating thumbnail for ${file.id}:`, err);
        return null;
      } finally {
        inFlightThumbnails.delete(file.id);
      }
    })();
    inFlightThumbnails.set(file.id, fetchPromise);
  }

  const result = await fetchPromise;
  if (result && result.length > 0) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    return res.send(result);
  }

  return res.status(404).json({ error: "Thumbnail not available" });
});

router.get("/:fileId/download", async (req: AuthedRequest, res) => {
  const file = db.files.get(req.params.fileId);
  if (!file) return res.status(404).json({ error: "File not found" });

  const folder = db.folders.get(file.folderId);
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
  const file = db.files.get(req.params.fileId);
  if (!file) return res.status(404).json({ error: "File not found" });

  try {
    const client = await getClientForUser(req.userId!);
    await moveFileToTrash(client, req.userId!, file);
  } catch (err: any) {
    console.warn(`Failed to move file ${file.id} to Telegram trash channel:`, err?.message);
  }

  db.files.softDelete(file.id);
  res.json({ ok: true });
});

// Bulk move files and folders in a single request
router.post("/bulk-move", async (req: AuthedRequest, res) => {
  const { fileIds = [], folderIds = [], destFolderId } = req.body;
  if (!destFolderId) return res.status(400).json({ error: "destFolderId is required" });

  const dest = db.folders.get(destFolderId);
  if (!dest) return res.status(404).json({ error: "Destination folder not found" });
  if (dest.locked) return res.status(400).json({ error: "Can't move items into locked folders" });

  if (Array.isArray(fileIds) && fileIds.length > 0) {
    for (const fId of fileIds) {
      const f = db.files.get(fId);
      if (f && !f.encrypted) {
        db.files.update(f.id, { folderId: destFolderId });
      }
    }
  }

  if (Array.isArray(folderIds) && folderIds.length > 0) {
    const allFolders = db.folders.allRaw();
    for (const fId of folderIds) {
      if (fId === destFolderId) continue;
      let walk: string | null = destFolderId;
      let isDescendant = false;
      while (walk) {
        if (walk === fId) {
          isDescendant = true;
          break;
        }
        const p = allFolders.find((x) => x.id === walk);
        walk = p?.parentId ?? null;
      }
      if (!isDescendant) {
        db.folders.update(fId, { parentId: destFolderId });
      }
    }
  }

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

  const file = db.files.get(req.params.fileId);
  const dest = db.folders.get(folderId);
  if (!file) return res.status(404).json({ error: "File not found" });
  if (!dest) return res.status(404).json({ error: "Destination folder not found" });

  if (file.encrypted || dest.locked) {
    return res.status(400).json({
      error: "Can't move files into or out of locked folders - download and re-upload instead",
    });
  }

  db.files.update(file.id, { folderId });
  res.json({ ok: true });
});

router.post("/:fileId/rename", async (req: AuthedRequest, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const file = db.files.get(req.params.fileId);
  if (!file) return res.status(404).json({ error: "File not found" });

  db.files.update(file.id, { name: name.trim() });
  res.json({ ok: true });
});

export default router;
