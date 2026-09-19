import { Router } from "express";
import crypto from "crypto";
import { v4 as uuid } from "uuid";
import archiver from "archiver";
import { PassThrough } from "stream";
import { db, ShareRecord, FolderRecord, FileRecord } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import {
  hashFolderPassword,
  verifyFolderPassword,
  deriveFolderFileKey,
  encryptWithMasterKey,
  decryptWithMasterKey,
} from "../utils/crypto";
import { getClientForUser } from "../telegram/client";
import { streamFileToResponse, streamFileRangeToResponse } from "../telegram/fileService";

export const sharesRouter = Router();
export const publicSharesRouter = Router();

function userOwnsFolder(userId: string, folderId: string): boolean {
  const rootId = `root_${userId}`;
  let currId: string | null = folderId;
  const visited = new Set<string>();
  while (currId) {
    if (currId === rootId) return true;
    if (visited.has(currId)) break;
    visited.add(currId);
    const f = db.folders.get(currId);
    if (!f) break;
    currId = f.parentId;
  }
  return false;
}

function getFolderStats(folderId: string): { fileCount: number; folderCount: number; totalSize: number } {
  let fileCount = 0;
  let folderCount = 0;
  let totalSize = 0;

  function traverse(currentId: string) {
    const subfolders = db.folders.subfolders(currentId);
    folderCount += subfolders.length;
    const files = db.files.byFolder(currentId);
    fileCount += files.length;
    for (const file of files) {
      totalSize += file.size;
    }
    for (const sub of subfolders) {
      traverse(sub.id);
    }
  }

  traverse(folderId);
  return { fileCount, folderCount, totalSize };
}

// =========================================================================
// Authenticated Share Management Routes (/api/shares)
// =========================================================================

sharesRouter.use(requireAuth);

// Create or update a share link for a file or folder
sharesRouter.post("/", async (req: AuthedRequest, res) => {
  const { targetType, targetId, password, expiresInHours, folderPassword } = req.body;

  if (targetType !== "file" && targetType !== "folder") {
    return res.status(400).json({ error: "targetType must be 'file' or 'folder'" });
  }

  if (!targetId || typeof targetId !== "string") {
    return res.status(400).json({ error: "targetId is required" });
  }

  let folderKeyEncrypted: string | null = null;

  if (targetType === "file") {
    const file = db.files.get(targetId);
    if (!file || file.deletedAt) {
      return res.status(404).json({ error: "File not found or deleted" });
    }
    if (!userOwnsFolder(req.userId!, file.folderId)) {
      return res.status(403).json({ error: "You do not own this file" });
    }

    if (file.encrypted) {
      const folder = db.folders.get(file.folderId);
      if (folder?.locked && folder.passwordHash && folder.salt) {
        if (!folderPassword || !verifyFolderPassword(folderPassword, folder.passwordHash, folder.salt)) {
          return res.status(400).json({
            error: "Folder password is required to share encrypted files",
            needFolderPassword: true,
          });
        }
        const fileKey = deriveFolderFileKey(folderPassword, folder.salt);
        folderKeyEncrypted = encryptWithMasterKey(fileKey);
      }
    }
  } else {
    const folder = db.folders.get(targetId);
    if (!folder || folder.deletedAt) {
      return res.status(404).json({ error: "Folder not found or deleted" });
    }
    if (!userOwnsFolder(req.userId!, folder.id)) {
      return res.status(403).json({ error: "You do not own this folder" });
    }

    if (folder.locked && folder.passwordHash && folder.salt) {
      if (!folderPassword || !verifyFolderPassword(folderPassword, folder.passwordHash, folder.salt)) {
        return res.status(400).json({
          error: "Folder password is required to share locked folders",
          needFolderPassword: true,
        });
      }
      const fileKey = deriveFolderFileKey(folderPassword, folder.salt);
      folderKeyEncrypted = encryptWithMasterKey(fileKey);
    }
  }

  // Remove any existing share for this target to issue a fresh configuration
  const existing = db.shares.byTarget(targetId, req.userId!);
  if (existing) {
    db.shares.delete(existing.id, req.userId!);
  }

  // Optional recipient password protection
  let passwordHash: string | null = null;
  let salt: string | null = null;
  if (password && typeof password === "string" && password.trim().length > 0) {
    const hashed = hashFolderPassword(password.trim());
    passwordHash = hashed.hash;
    salt = hashed.salt;
  }

  // Expiration calculation
  let expiresAt: number | null = null;
  if (typeof expiresInHours === "number" && expiresInHours > 0) {
    expiresAt = Date.now() + Math.round(expiresInHours * 3600 * 1000);
  }

  // Generate unique URL token
  const token = crypto.randomBytes(16).toString("hex");

  const share: ShareRecord = {
    id: uuid(),
    token,
    userId: req.userId!,
    targetType,
    targetId,
    passwordHash,
    salt,
    expiresAt,
    createdAt: Date.now(),
    downloadsCount: 0,
    folderKey: folderKeyEncrypted,
  };

  db.shares.create(share);

  res.json({
    share: {
      id: share.id,
      token: share.token,
      targetType: share.targetType,
      targetId: share.targetId,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      hasPassword: Boolean(share.passwordHash),
      downloadsCount: share.downloadsCount,
    },
    shareUrl: `/share/${token}`,
  });
});

// List all active shares created by the user
sharesRouter.get("/", async (req: AuthedRequest, res) => {
  const list = db.shares.byUser(req.userId!);
  const result = list.map((s) => {
    let name = "Unknown";
    let size = 0;
    let mimeType: string | undefined;

    if (s.targetType === "file") {
      const f = db.files.get(s.targetId);
      if (f) {
        name = f.name;
        size = f.size;
        mimeType = f.mimeType;
      }
    } else {
      const folder = db.folders.get(s.targetId);
      if (folder) {
        name = folder.name;
      }
    }

    const isExpired = Boolean(s.expiresAt && s.expiresAt < Date.now());

    return {
      id: s.id,
      token: s.token,
      targetType: s.targetType,
      targetId: s.targetId,
      name,
      size,
      mimeType,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isExpired,
      hasPassword: Boolean(s.passwordHash),
      downloadsCount: s.downloadsCount,
      shareUrl: `/share/${s.token}`,
    };
  });

  res.json({ shares: result });
});

// Get existing share for a specific target item
sharesRouter.get("/target/:targetId", async (req: AuthedRequest, res) => {
  const share = db.shares.byTarget(req.params.targetId, req.userId!);
  if (!share) {
    return res.json({ share: null });
  }

  const isExpired = Boolean(share.expiresAt && share.expiresAt < Date.now());

  res.json({
    share: {
      id: share.id,
      token: share.token,
      targetType: share.targetType,
      targetId: share.targetId,
      expiresAt: share.expiresAt,
      isExpired,
      createdAt: share.createdAt,
      hasPassword: Boolean(share.passwordHash),
      downloadsCount: share.downloadsCount,
      shareUrl: `/share/${share.token}`,
    },
  });
});

// Revoke a share link
sharesRouter.delete("/:id", async (req: AuthedRequest, res) => {
  db.shares.delete(req.params.id, req.userId!);
  res.json({ ok: true });
});

// =========================================================================
// Public Unauthenticated Recipient Routes (/api/public/shares)
// =========================================================================

// Public share metadata
publicSharesRouter.get("/:token", async (req, res) => {
  const share = db.shares.getByToken(req.params.token);
  if (!share) {
    return res.status(404).json({ error: "Share link not found or has been revoked" });
  }

  if (share.expiresAt && share.expiresAt < Date.now()) {
    return res.status(410).json({ error: "This share link has expired", expired: true });
  }

  if (share.targetType === "file") {
    const file = db.files.get(share.targetId);
    if (!file || file.deletedAt) {
      return res.status(404).json({ error: "Shared file has been deleted" });
    }

    return res.json({
      token: share.token,
      targetType: "file",
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      requiresPassword: Boolean(share.passwordHash),
      downloadsCount: share.downloadsCount,
    });
  }

  const folder = db.folders.get(share.targetId);
  if (!folder || folder.deletedAt) {
    return res.status(404).json({ error: "Shared folder has been deleted" });
  }

  const stats = getFolderStats(folder.id);

  return res.json({
    token: share.token,
    targetType: "folder",
    name: folder.name,
    fileCount: stats.fileCount,
    folderCount: stats.folderCount,
    totalSize: stats.totalSize,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    requiresPassword: Boolean(share.passwordHash),
    downloadsCount: share.downloadsCount,
  });
});

// Verify public password
publicSharesRouter.post("/:token/verify", async (req, res) => {
  const share = db.shares.getByToken(req.params.token);
  if (!share) {
    return res.status(404).json({ error: "Share link not found or has been revoked" });
  }

  if (share.expiresAt && share.expiresAt < Date.now()) {
    return res.status(410).json({ error: "This share link has expired", expired: true });
  }

  if (!share.passwordHash || !share.salt) {
    return res.json({ ok: true });
  }

  const { password = "" } = req.body;
  const ok = verifyFolderPassword(password, share.passwordHash, share.salt);
  if (!ok) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  return res.json({ ok: true });
});

// Download shared file or folder zip (supports HTTP 206 Range seeking for media)
publicSharesRouter.get("/:token/download", async (req, res) => {
  const share = db.shares.getByToken(req.params.token);
  if (!share) {
    return res.status(404).json({ error: "Share link not found or has been revoked" });
  }

  if (share.expiresAt && share.expiresAt < Date.now()) {
    return res.status(410).json({ error: "This share link has expired", expired: true });
  }

  // Password verification
  if (share.passwordHash && share.salt) {
    const password = (req.query.password as string) || "";
    const ok = verifyFolderPassword(password, share.passwordHash, share.salt);
    if (!ok) {
      return res.status(403).json({ error: "Wrong or missing password" });
    }
  }

  let client: any;
  try {
    client = await getClientForUser(share.userId);
  } catch (err: any) {
    return res.status(500).json({ error: "Storage owner client currently unavailable" });
  }

  // Record download count
  try {
    db.shares.incrementDownloads(share.id);
  } catch {}

  if (share.targetType === "file") {
    const file = db.files.get(share.targetId);
    if (!file || file.deletedAt) {
      return res.status(404).json({ error: "File not found" });
    }

    let fileKey: Buffer | undefined;
    if (file.encrypted && share.folderKey) {
      try {
        fileKey = decryptWithMasterKey(share.folderKey);
      } catch (err) {
        console.error("Failed to decrypt folderKey for share:", err);
      }
    }

    const rangeHeader = req.headers.range;
    const isAttachment = req.query.dl === "1";

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `${isAttachment ? "attachment" : "inline"}; filename="${encodeURIComponent(file.name)}"`
    );

    // Serve range request if available and not encrypted
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

      try {
        await streamFileRangeToResponse(client, file, res, start, clampedEnd);
      } catch (err: any) {
        if (!res.headersSent) res.status(500).json({ error: err.message || "Download failed" });
      }
      return;
    }

    res.setHeader("Accept-Ranges", file.encrypted ? "none" : "bytes");
    try {
      await streamFileToResponse(client, file, res, fileKey);
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message || "Download failed" });
    }
    return;
  }

  // Folder ZIP streaming
  const root = db.folders.get(share.targetId);
  if (!root || root.deletedAt) {
    return res.status(404).json({ error: "Folder not found" });
  }

  let folderFileKey: Buffer | undefined;
  if (share.folderKey) {
    try {
      folderFileKey = decryptWithMasterKey(share.folderKey);
    } catch {}
  }

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

    if (folder.locked && !isRootFolder) {
      archive.append(`This folder is locked and was skipped - open it in TeleCloud with its password.`, {
        name: `${zipPath}/LOCKED.txt`,
      });
      return;
    }

    const files = db.files.byFolder(folder.id);
    for (const file of files) {
      const fileKey = file.encrypted ? folderFileKey : undefined;
      try {
        const pt = new PassThrough();
        archive.append(pt, { name: `${zipPath}/${file.name}` });
        await streamFileToResponse(client, file, pt, fileKey);
      } catch (err: any) {
        archive.append(`Could not include this file: ${err.message}`, {
          name: `${zipPath}/${file.name}.error.txt`,
        });
      }
    }

    const subfolders = db.folders.subfolders(folder.id);
    for (const sub of subfolders) {
      await addFolder(sub, `${zipPath}/${sub.name}`);
    }
  }

  try {
    await addFolder(root, root.name);
    await archive.finalize();
  } catch (err: any) {
    archive.abort();
    res.end();
  }
});
