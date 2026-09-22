import { Router } from "express";
import { v4 as uuid } from "uuid";
import archiver from "archiver";
import { PassThrough } from "stream";
import { db, FolderRecord } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { hashFolderPassword, verifyFolderPassword, deriveFolderFileKey } from "../utils/crypto";
import { getClientForUser, syncTopicMessages } from "../telegram/client";
import { downloadFile, streamFileToResponse } from "../telegram/fileService";
import { getOrCreateForumSupergroup, createFolderTopic, editFolderTopic, moveFileToTrash } from "../telegram/storageManager";

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
  const folder = db.folders.get(req.params.folderId);
  if (!folder || folder.deletedAt) return res.status(404).json({ error: "Folder not found" });

  if (folder.locked) {
    const password = (req.query.password as string) || "";
    const ok = folder.passwordHash && folder.salt && verifyFolderPassword(password, folder.passwordHash, folder.salt);
    if (!ok) {
      return res.status(200).json({ folder: { id: folder.id, name: folder.name, locked: true }, locked: true, subfolders: [], files: [] });
    }
  }

  const subfolders = db.folders.subfolders(folder.id);
  const files = db.files.byFolder(folder.id);
  res.json({
    folder,
    locked: false,
    subfolders: subfolders.map((f) => {
      const childFilesCount = db.files.countByFolder(f.id);
      const childFoldersCount = db.folders.countSubfolders(f.id);
      return {
        id: f.id,
        name: f.name,
        locked: f.locked,
        createdAt: f.createdAt,
        itemCount: childFilesCount + childFoldersCount,
      };
    }),
    files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType, createdAt: f.createdAt, encrypted: f.encrypted })),
  });
});

router.get("/", async (req: AuthedRequest, res) => {
  // convenience: GET / -> user's root folder id
  res.json({ rootFolderId: rootIdFor(req.userId!) });
});

router.get("/tree/all", async (req: AuthedRequest, res) => {
  const allFolders = db.folders.all().map((f) => ({
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

  const parent = db.folders.get(parentId);
  if (!parent) return res.status(404).json({ error: "Parent folder not found" });

  let topicId: number | undefined;
  try {
    const client = await getClientForUser(req.userId!);
    const forumMod = await getOrCreateForumSupergroup(client, req.userId!);
    topicId = await createFolderTopic(client, forumMod, name.trim());
  } catch (err) {
    console.error("Failed to create Telegram forum topic for folder:", err);
  }

  const folder: FolderRecord = {
    id: uuid(),
    parentId,
    name: name.trim(),
    createdAt: Date.now(),
    locked: false,
    topicId: topicId || null,
  };
  db.folders.create(folder);
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

  const folder = db.folders.get(req.params.folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });

  const { hash, salt } = hashFolderPassword(password);
  db.folders.update(folder.id, {
    locked: true,
    passwordHash: hash,
    salt,
  });
  res.json({ ok: true });
});

router.post("/:folderId/unlock-check", async (req: AuthedRequest, res) => {
  const { password } = req.body;
  const folder = db.folders.get(req.params.folderId);
  if (!folder?.locked) return res.status(400).json({ error: "Folder is not locked" });

  const ok = !!folder.passwordHash && !!folder.salt && verifyFolderPassword(password, folder.passwordHash, folder.salt);
  res.json({ ok });
});

router.post("/:folderId/unlock", async (req: AuthedRequest, res) => {
  const { password } = req.body;
  const folder = db.folders.get(req.params.folderId);
  if (!folder?.locked) return res.status(400).json({ error: "Folder is not locked" });
  
  const ok = !!folder.passwordHash && !!folder.salt && verifyFolderPassword(password, folder.passwordHash, folder.salt);
  if (!ok) return res.status(403).json({ error: "Wrong password" });

  const hasEncrypted = db.files.byFolder(folder.id).some((f) => f.encrypted);
  if (hasEncrypted) {
    return res.status(400).json({ error: "Cannot unlock folder: it contains encrypted files. Please move or delete them first." });
  }

  db.folders.update(folder.id, {
    locked: false,
    passwordHash: undefined,
    salt: undefined,
  });
  res.json({ ok: true });
});

router.post("/:folderId/sync", async (req: AuthedRequest, res) => {
  const folderId = req.params.folderId;
  const userId = req.userId!;

  try {
    const client = await getClientForUser(userId);
    const result = await syncTopicMessages(client, userId, folderId);
    res.json({ ok: true, importedCount: result.importedCount, files: result.files });
  } catch (err: any) {
    console.error(`[Sync] Failed to sync folder ${folderId}:`, err);
    res.status(500).json({ error: err.message || "Failed to sync folder with Telegram" });
  }
});

router.delete("/:folderId", async (req: AuthedRequest, res) => {
  const folderId = req.params.folderId;
  const userId = req.userId!;

  try {
    const client = await getClientForUser(userId);
    const allFoldersRaw = db.folders.allRaw();
    const toDelete = new Set<string>([folderId]);
    const queue = [folderId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const f of allFoldersRaw) {
        if (f.parentId === curr && !toDelete.has(f.id)) {
          toDelete.add(f.id);
          queue.push(f.id);
        }
      }
    }
    for (const fId of toDelete) {
      const files = db.files.byFolder(fId);
      for (const file of files) {
        await moveFileToTrash(client, userId, file).catch(() => {});
      }
    }
  } catch (err: any) {
    console.warn("Failed to move folder files to Telegram trash channel:", err?.message);
  }

  db.folders.softDelete(folderId);
  res.json({ ok: true });
});

// Move a folder under a different parent. Refuses to move a folder into
// itself or into one of its own descendants (that would orphan it).
router.post("/:folderId/move", async (req: AuthedRequest, res) => {
  const { newParentId } = req.body;
  if (!newParentId) return res.status(400).json({ error: "newParentId is required" });

  const folder = db.folders.get(req.params.folderId);
  const target = db.folders.get(newParentId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  if (!target) return res.status(404).json({ error: "Destination folder not found" });

  if (folder.id === newParentId) {
    return res.status(400).json({ error: "Can't move a folder into itself" });
  }
  const allFolders = db.folders.allRaw();
  let walk: string | null = target.id;
  while (walk) {
    if (walk === folder.id) {
      return res.status(400).json({ error: "Can't move a folder into one of its own subfolders" });
    }
    const parent = allFolders.find((f) => f.id === walk);
    walk = parent?.parentId ?? null;
  }

  db.folders.update(folder.id, { parentId: newParentId });
  res.json({ ok: true });
});

router.post("/:folderId/rename", async (req: AuthedRequest, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  const folder = db.folders.get(req.params.folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found" });

  db.folders.update(folder.id, { name: name.trim() });

  if (folder.topicId) {
    try {
      const client = await getClientForUser(req.userId!);
      const forumMod = await getOrCreateForumSupergroup(client, req.userId!);
      await editFolderTopic(client, forumMod, folder.topicId, name.trim());
    } catch (err) {
      console.error("Failed to rename Telegram forum topic:", err);
    }
  }

  res.json({ ok: true });
});

// Download an entire folder (recursively) as a single zip.
router.get("/:folderId/download-zip", async (req: AuthedRequest, res) => {
  const root = db.folders.get(req.params.folderId);
  if (!root || root.deletedAt) return res.status(404).json({ error: "Folder not found" });

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

    const files = db.files.byFolder(folder.id);
    for (const file of files) {
      const fileKey = file.encrypted && password ? deriveFolderFileKey(password, folder.salt!) : undefined;
      const pt = new PassThrough();
      archive.append(pt, { name: `${zipPath}/${file.name}` });
      try {
        await streamFileToResponse(client, file, pt, fileKey);
      } catch (err: any) {
        try {
          pt.end();
        } catch {}
        archive.append(`Could not include this file: ${err.message}`, { name: `${zipPath}/${file.name}.error.txt` });
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

export default router;
