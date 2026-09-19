import { Router } from "express";
import { db } from "../db/db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getClientForUser } from "../telegram/client";
import { getOrCreateForumSupergroup, deleteFolderTopic } from "../telegram/storageManager";

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

  for (const id of ids) {
    const file = db.files.get(id);
    if (file && file.deletedAt) {
      db.files.restore(id, rootId);
      continue;
    }
    const folder = db.folders.get(id);
    if (folder && folder.deletedAt) {
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
    for (const f of trash.folders) {
      if (f.topicId) {
        await deleteFolderTopic(client, forumMod, f.topicId).catch(() => {});
      }
    }
  } catch {}
  db.trash.empty(userId);
  res.json({ ok: true });
});

// Permanently delete a single item from the trash
router.delete("/:id", async (req: AuthedRequest, res) => {
  const id = req.params.id;
  const userId = req.userId!;
  const file = db.files.get(id);
  if (file) {
    db.files.deletePermanent(id);
    return res.json({ ok: true });
  }

  const folder = db.folders.get(id);
  if (folder) {
    if (folder.topicId) {
      try {
        const client = await getClientForUser(userId);
        const forumMod = await getOrCreateForumSupergroup(client, userId);
        await deleteFolderTopic(client, forumMod, folder.topicId).catch(() => {});
      } catch {}
    }
    db.folders.deletePermanent(id);
    return res.json({ ok: true });
  }

  res.status(404).json({ error: "Item not found" });
});

export default router;
