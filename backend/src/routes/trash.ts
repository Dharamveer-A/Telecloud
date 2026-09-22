import { Router } from "express";
import { db } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getClientForUser } from "../telegram/client";
import {
  getOrCreateForumSupergroup,
  deleteFolderTopic,
  restoreFileFromTrash,
  purgeFileFromTelegram,
} from "../telegram/storageManager";

const router = Router();
router.use(requireAuth);

function rootIdFor(userId: string) {
  return `root_${userId}`;
}

// Get all items in the trash for the current user
router.get("/", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const trash = db.trash.get(userId);
  const items = [...trash.folders, ...trash.files].sort((a, b) => b.deletedAt - a.deletedAt);
  res.json({ files: trash.files, folders: trash.folders, items });
});

// Restore items from the trash
router.post("/restore", async (req: AuthedRequest, res) => {
  const { ids = [] } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array is required" });
  }

  const userId = req.userId!;
  const rootId = rootIdFor(userId);

  let client: any;
  try {
    client = await getClientForUser(userId);
  } catch (err) {
    console.warn("Could not get Telegram client for restore:", err);
  }

  for (const id of ids) {
    const file = db.files.get(id);
    if (file && file.deletedAt) {
      if (client) {
        const targetFolder = db.folders.get(file.folderId) || db.folders.get(rootId);
        await restoreFileFromTrash(client, userId, file, targetFolder).catch(() => {});
      }
      db.files.restore(id, rootId);
      continue;
    }
    const folder = db.folders.get(id);
    if (folder && folder.deletedAt) {
      if (client) {
        const allFoldersRaw = db.folders.allRaw();
        const toRestore = new Set<string>([id]);
        const queue = [id];
        while (queue.length > 0) {
          const curr = queue.shift()!;
          for (const f of allFoldersRaw) {
            if (f.parentId === curr && f.deletedAt && !toRestore.has(f.id)) {
              toRestore.add(f.id);
              queue.push(f.id);
            }
          }
        }
        for (const fId of toRestore) {
          const fObj = db.folders.get(fId);
          const files = db.files.byFolder(fId);
          for (const f of files) {
            await restoreFileFromTrash(client, userId, f, fObj).catch(() => {});
          }
        }
      }
      db.folders.restore(id, rootId);
    }
  }

  res.json({ ok: true });
});

// Permanently empty the trash for the current user
router.delete("/empty", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const trash = db.trash.get(userId);
  try {
    const client = await getClientForUser(userId);
    const forumMod = await getOrCreateForumSupergroup(client, userId);
    for (const f of trash.files) {
      await purgeFileFromTelegram(client, f).catch(() => {});
    }
    for (const f of trash.folders) {
      if (f.topicId) {
        await deleteFolderTopic(client, forumMod, f.topicId).catch(() => {});
      }
    }
  } catch (err: any) {
    console.warn("Failed to purge trash items from Telegram:", err?.message);
  }
  db.trash.empty(userId);
  res.json({ ok: true });
});

// Permanently delete a single item from the trash
router.delete("/:id", async (req: AuthedRequest, res) => {
  const id = req.params.id;
  const userId = req.userId!;
  const file = db.files.get(id);
  if (file) {
    try {
      const client = await getClientForUser(userId);
      await purgeFileFromTelegram(client, file).catch(() => {});
    } catch {}
    db.files.deletePermanent(id);
    return res.json({ ok: true });
  }

  const folder = db.folders.get(id);
  if (folder) {
    try {
      const client = await getClientForUser(userId);
      const allFoldersRaw = db.folders.allRaw();
      const toDelete = new Set<string>([id]);
      const queue = [id];
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
        for (const f of files) {
          await purgeFileFromTelegram(client, f).catch(() => {});
        }
      }
      if (folder.topicId) {
        const forumMod = await getOrCreateForumSupergroup(client, userId);
        await deleteFolderTopic(client, forumMod, folder.topicId).catch(() => {});
      }
    } catch {}
    db.folders.deletePermanent(id);
    return res.json({ ok: true });
  }

  res.status(404).json({ error: "Item not found" });
});

export default router;
