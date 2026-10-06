/**
 * dbBackup.ts — Lifetime-free database persistence for Render hosting.
 *
 * Problem: Render's free tier has no persistent disk, so db.sqlite is wiped
 * on every restart/deploy.
 *
 * Solution: Store SQLite database backups inside the TeleCloud Drive
 * forum supergroup itself (under a dedicated "⚙️ System / Backups" topic),
 * keeping the user's personal "Saved Messages" completely clean and uncluttered.
 * On startup, restore the latest backup before SQLite opens.
 *
 * The database only contains metadata (~1-5 MB), so uploads are fast.
 * Actual files are always safe on Telegram — only UI metadata is at risk
 * during the short window between backups.
 */

import fs from "fs";
import path from "path";
import { TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { Api } from "telegram";

// Marker caption that uniquely identifies our backup messages
const BACKUP_CAPTION = "🔒 TELECLOUD_DB_BACKUP_V1";

// How many old backup messages to keep (deletes the rest to save Telegram storage)
const MAX_BACKUPS_TO_KEEP = 3;

// Backup every 2 minutes while the server is running
const BACKUP_INTERVAL_MS = 2 * 60 * 1000;

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = path.join(DATA_DIR, "db.sqlite");

let backupIntervalHandle: ReturnType<typeof setInterval> | null = null;
let isBacking = false;

/**
 * Resolves the TeleCloud Drive forum supergroup and dedicated backup topic.
 * Falls back to "me" (Saved Messages) only if supergroup resolution fails.
 */
async function getBackupTarget(client: TelegramClient): Promise<{ targetPeer: any; topicId?: number }> {
  try {
    const me = (await client.getMe()) as Api.User;
    const userId = me.id.toString();
    const { getOrCreateForumSupergroup, getOrCreateBackupTopic, inputChannelFor } = await import(
      "../telegram/storageManager"
    );
    const forumMod = await getOrCreateForumSupergroup(client, userId);
    const targetPeer = inputChannelFor(forumMod);
    const topicId = await getOrCreateBackupTopic(client, forumMod);
    return { targetPeer, topicId };
  } catch (err) {
    console.warn("[DB Backup] Notice: could not resolve TeleCloud Drive channel, falling back to Saved Messages:", err);
    return { targetPeer: "me" };
  }
}

/**
 * Restore db.sqlite from the latest Telegram backup.
 * Checks TeleCloud Drive channel first, then falls back to Saved Messages for legacy backups.
 */
export async function restoreDbFromTelegram(client: TelegramClient): Promise<boolean> {
  if (process.env.DB_BACKUP_DISABLED === "true") return false;

  try {
    console.log("[DB Backup] Searching for database backup in TeleCloud Drive channel...");
    const { targetPeer } = await getBackupTarget(client);

    let backupMessages: any[] = [];
    if (targetPeer !== "me") {
      try {
        const channelMsgs = await client.getMessages(targetPeer, { limit: 50 });
        backupMessages = channelMsgs.filter(
          (msg: any) =>
            msg.message === BACKUP_CAPTION &&
            msg.media &&
            ((msg.media as any).className === "MessageMediaDocument" ||
              msg.media instanceof Api.MessageMediaDocument)
        );
      } catch (err) {
        console.warn("[DB Backup] Channel message fetch warning:", err);
      }
    }

    // Fall back to Saved Messages if not found in channel yet
    if (backupMessages.length === 0) {
      console.log("[DB Backup] Checking Saved Messages for backup...");
      const savedMsgs = await client.getMessages("me", { limit: 50 });
      backupMessages = savedMsgs.filter(
        (msg: any) =>
          msg.message === BACKUP_CAPTION &&
          msg.media &&
          ((msg.media as any).className === "MessageMediaDocument" ||
            msg.media instanceof Api.MessageMediaDocument)
      );
    }

    if (backupMessages.length === 0) {
      console.log("[DB Backup] No backup found — starting with a fresh database.");
      return false;
    }

    // Most recent is first (Telegram returns newest first)
    const latest = backupMessages[0];
    console.log(
      `[DB Backup] Found backup from ${new Date((latest as any).date * 1000).toISOString()}. Restoring...`
    );

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Download the backup file to the db path
    const buffer = (await client.downloadMedia(latest as any, {})) as Buffer;

    if (!buffer || buffer.length === 0) {
      console.warn("[DB Backup] Downloaded backup was empty — starting fresh.");
      return false;
    }

    // Close existing SQLite instance and wipe stale WAL/SHM journals before overwriting db.sqlite
    try {
      const { closeSqlite } = await import("../db/sqlite");
      closeSqlite();
    } catch {}
    try { fs.unlinkSync(`${DB_PATH}-wal`); } catch {}
    try { fs.unlinkSync(`${DB_PATH}-shm`); } catch {}

    fs.writeFileSync(DB_PATH, buffer);

    try {
      const { reloadSqlite } = await import("../db/sqlite");
      reloadSqlite();
    } catch {}
    console.log(
      `[DB Backup] ✅ Database restored (${(buffer.length / 1024).toFixed(1)} KB) from Telegram.`
    );
    return true;
  } catch (err: any) {
    console.warn("[DB Backup] Restore failed (will start fresh):", err?.message);
    return false;
  }
}

/**
 * Upload the current db.sqlite to TeleCloud Drive forum supergroup.
 * Keeps only the last MAX_BACKUPS_TO_KEEP messages in the channel,
 * and automatically purges old backup messages from personal Saved Messages.
 */
export async function backupDbToTelegram(client: TelegramClient): Promise<void> {
  if (process.env.DB_BACKUP_DISABLED === "true") return;
  if (isBacking) return; // Prevent overlapping backups
  if (!fs.existsSync(DB_PATH)) return;

  isBacking = true;
  try {
    const dbBuffer = fs.readFileSync(DB_PATH);
    const { targetPeer, topicId } = await getBackupTarget(client);

    // Upload db.sqlite into TeleCloud Drive channel (or fallback)
    const sendParams: any = {
      file: new CustomFile("db.sqlite", dbBuffer.length, "db.sqlite", dbBuffer),
      caption: BACKUP_CAPTION,
      forceDocument: true,
    };
    if (topicId) {
      sendParams.replyTo = topicId;
    }

    await client.sendFile(targetPeer, sendParams);

    // Clean up old backups in target channel — keep only the last MAX_BACKUPS_TO_KEEP
    try {
      const messages = await client.getMessages(targetPeer, { limit: 100 });
      const backupMessages = messages.filter(
        (msg: any) =>
          msg.message === BACKUP_CAPTION &&
          msg.media &&
          ((msg.media as any).className === "MessageMediaDocument" ||
            msg.media instanceof Api.MessageMediaDocument)
      );

      if (backupMessages.length > MAX_BACKUPS_TO_KEEP) {
        const toDelete = backupMessages
          .slice(MAX_BACKUPS_TO_KEEP)
          .map((m: any) => m.id);

        await client.deleteMessages(targetPeer, toDelete, { revoke: true });
        console.log(`[DB Backup] Cleaned up ${toDelete.length} old backup(s) in channel.`);
      }
    } catch (e) {
      console.warn("Could not clean old backups in channel:", e);
    }

    // Clean up any remaining backup messages in personal Saved Messages ("me") so user's Saved Messages is spotless!
    try {
      const savedMessages = await client.getMessages("me", { limit: 100 });
      const staleSaved = savedMessages.filter(
        (msg: any) =>
          msg.message === BACKUP_CAPTION &&
          msg.media &&
          ((msg.media as any).className === "MessageMediaDocument" ||
            msg.media instanceof Api.MessageMediaDocument)
      );
      if (staleSaved.length > 0) {
        await client.deleteMessages(
          "me",
          staleSaved.map((m: any) => m.id),
          { revoke: true }
        );
        console.log(`[DB Backup] Purged ${staleSaved.length} old backup message(s) from personal Saved Messages.`);
      }
    } catch (e) {
      console.warn("Notice: could not purge Saved Messages backups:", e);
    }

    console.log(
      `[DB Backup] ✅ Backed up to TeleCloud channel (${(dbBuffer.length / 1024).toFixed(1)} KB).`
    );
  } catch (err: any) {
    console.warn("[DB Backup] Backup failed:", err?.message);
  } finally {
    isBacking = false;
  }
}

/**
 * Start a periodic backup loop. Call after server is fully initialized.
 */
export function startPeriodicDbBackup(client: TelegramClient): void {
  if (process.env.DB_BACKUP_DISABLED === "true") return;

  stopPeriodicDbBackup();
  backupIntervalHandle = setInterval(async () => {
    try {
      await backupDbToTelegram(client);
    } catch {
      // Swallow errors — backup is best-effort
    }
  }, BACKUP_INTERVAL_MS);

  console.log(
    `[DB Backup] Periodic backup started (every ${BACKUP_INTERVAL_MS / 1000}s).`
  );
}

/**
 * Stop the periodic backup loop.
 */
export function stopPeriodicDbBackup(): void {
  if (backupIntervalHandle) {
    clearInterval(backupIntervalHandle);
    backupIntervalHandle = null;
  }
}

/**
 * Register SIGTERM / SIGINT handlers to do a final backup before the
 * process exits (Render sends SIGTERM before killing a service).
 */
export function registerShutdownBackup(client: TelegramClient): void {
  if (process.env.DB_BACKUP_DISABLED === "true") return;

  const shutdown = async (signal: string) => {
    console.log(`[DB Backup] Received ${signal} — performing final backup before exit...`);
    stopPeriodicDbBackup();
    await backupDbToTelegram(client);
    console.log("[DB Backup] Final backup complete. Exiting.");
    process.exit(0);
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// ── Auto-Sync from Telegram ──────────────────────────────────────────
let lastAppliedBackupTimestamp = 0;
let syncCheckIntervalHandle: ReturnType<typeof setInterval> | null = null;

export async function syncNewerDbFromTelegram(client: TelegramClient): Promise<boolean> {
  if (process.env.DB_BACKUP_DISABLED === "true") return false;
  if (isBacking) return false;

  try {
    const { targetPeer } = await getBackupTarget(client);
    let messages: any[] = [];
    if (targetPeer !== "me") {
      try {
        messages = await client.getMessages(targetPeer, { limit: 20 });
      } catch {}
    }
    if (messages.length === 0) {
      messages = await client.getMessages("me", { limit: 20 });
    }

    const backupMessages = messages.filter(
      (msg: any) =>
        msg.message === BACKUP_CAPTION &&
        msg.media &&
        ((msg.media as any).className === "MessageMediaDocument" ||
          msg.media instanceof Api.MessageMediaDocument)
    );

    if (backupMessages.length === 0) return false;

    const latest = backupMessages[0];
    const backupDate = (latest as any).date * 1000; // ms

    if (lastAppliedBackupTimestamp && backupDate <= lastAppliedBackupTimestamp) {
      return false;
    }

    if (fs.existsSync(DB_PATH)) {
      const stat = fs.statSync(DB_PATH);
      if (backupDate <= stat.mtimeMs) {
        lastAppliedBackupTimestamp = backupDate;
        return false;
      }
    }

    console.log(
      `[DB Sync] Newer database snapshot detected in Telegram (${new Date(backupDate).toISOString()}). Hot-syncing...`
    );

    const buffer = (await client.downloadMedia(latest as any, {})) as Buffer;
    if (!buffer || buffer.length === 0) return false;

    try {
      const { closeSqlite } = await import("../db/sqlite");
      closeSqlite();
    } catch {}
    try { fs.unlinkSync(`${DB_PATH}-wal`); } catch {}
    try { fs.unlinkSync(`${DB_PATH}-shm`); } catch {}

    fs.writeFileSync(DB_PATH, buffer);

    try {
      const { reloadSqlite } = await import("../db/sqlite");
      reloadSqlite();
    } catch {}

    lastAppliedBackupTimestamp = backupDate;
    console.log(
      `[DB Sync] ✅ Hot-reloaded newer database snapshot (${(buffer.length / 1024).toFixed(1)} KB) without server restart!`
    );
    return true;
  } catch (err: any) {
    console.warn("[DB Sync] Sync check warning:", err?.message);
    return false;
  }
}

export function startPeriodicDbSyncCheck(
  client: TelegramClient,
  intervalMs = 3 * 60 * 1000
): void {
  if (process.env.DB_BACKUP_DISABLED === "true") return;

  if (syncCheckIntervalHandle) clearInterval(syncCheckIntervalHandle);
  syncCheckIntervalHandle = setInterval(() => {
    syncNewerDbFromTelegram(client).catch(() => {});
  }, intervalMs);

  console.log(`[DB Sync] Background auto-sync checker active (every ${intervalMs / 1000}s).`);
}
