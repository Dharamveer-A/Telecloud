import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import { v4 as uuid } from "uuid";
import bigInt from "big-integer";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { encryptSession, decryptSession } from "../utils/crypto";
import { db, FileRecord, StorageModule } from "../db/db";
import { getOrCreateForumSupergroup, inputPeerFor } from "./storageManager";

function getApiCredentials() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  if (!apiId || !apiHash) {
    console.warn(
      "[telecloud] TELEGRAM_API_ID / TELEGRAM_API_HASH are not set. " +
        "Get free ones from https://my.telegram.org before logging in."
    );
  }
  return { apiId, apiHash };
}

// In-flight logins live in memory only, keyed by phone number, for the
// short window between "send code" and "verify code"/"verify 2FA".
// Nothing here touches disk until login actually succeeds.
interface PendingLogin {
  client: TelegramClient;
  phoneCodeHash: string;
  expiresAt: number;
}
const pendingLogins = new Map<string, PendingLogin>();

// Connected clients for already-logged-in users, kept warm so every
// file/folder request doesn't pay a fresh MTProto handshake.
const activeClients = new Map<string, TelegramClient>();

function newClient(session = ""): TelegramClient {
  const { apiId, apiHash } = getApiCredentials();
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 10,
    autoReconnect: true,
    timeout: 30,
  });
}

// Step 1: user submits their phone number.
export async function requestLoginCode(phone: string): Promise<void> {
  const { apiId, apiHash } = getApiCredentials();
  const client = newClient();
  await client.connect();
  const result = await client.sendCode({ apiId, apiHash }, phone);
  pendingLogins.set(phone, {
    client,
    phoneCodeHash: result.phoneCodeHash,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min to enter the code
  });
}

type LoginResult =
  | { status: "ok"; userId: string }
  | { status: "need_password" };

// Step 2: user submits the code Telegram sent them.
export async function submitLoginCode(phone: string, code: string): Promise<LoginResult> {
  const pending = pendingLogins.get(phone);
  if (!pending || pending.expiresAt < Date.now()) {
    throw new Error("Login expired, request a new code");
  }
  const { client, phoneCodeHash } = pending;

  try {
    await client.invoke(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code })
    );
  } catch (err: any) {
    if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return { status: "need_password" };
    }
    throw err;
  }

  return finishLogin(phone, client);
}

// Step 2b: only called if step 2 returned need_password (account has 2FA).
export async function submitLoginPassword(phone: string, password: string): Promise<LoginResult> {
  const pending = pendingLogins.get(phone);
  if (!pending) throw new Error("Login expired, request a new code");
  const { client } = pending;

  const passwordInfo = await client.invoke(new Api.account.GetPassword());
  const srpCheck = await computeCheck(passwordInfo, password);
  await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));

  return finishLogin(phone, client);
}

async function finishLogin(phone: string, client: TelegramClient): Promise<LoginResult> {
  const me = (await client.getMe()) as Api.User;
  const userId = me.id.toString();
  const sessionString = client.session.save() as unknown as string;

  const existing = db.users.get(userId);
  if (existing) {
    existing.sessionString = encryptSession(sessionString);
    db.users.save(existing);
  } else {
    db.users.save({
      id: userId,
      phone,
      sessionString: encryptSession(sessionString),
      createdAt: Date.now(),
    });

    // Automatically check and restore database backup from Telegram
    let restored = false;
    try {
      const { restoreDbFromTelegram } = await import("../services/dbBackup");
      restored = await restoreDbFromTelegram(client);
    } catch (err: any) {
      console.warn("[Login] DB restore check notice:", err?.message);
    }

    // Only create empty root folder if no backup was found/restored
    if (!restored && !db.folders.get(`root_${userId}`)) {
      db.folders.create({
        id: `root_${userId}`,
        parentId: null,
        name: "My Files",
        createdAt: Date.now(),
        locked: false,
      });
    }

    // Auto-provision the TeleCloud Drive forum supergroup in Telegram
    getOrCreateForumSupergroup(client, userId).catch((err) => {
      console.warn("Notice: could not auto-provision forum supergroup at login (will retry on first folder upload):", err?.message);
    });
  }

  pendingLogins.delete(phone);
  activeClients.set(userId, client);
  startTelegramSyncListener(client, userId).catch(() => {});
  return { status: "ok", userId };
}

// Connected sync listeners per user
const activeListeners = new Set<string>();

export async function indexTelegramMessage(
  client: TelegramClient,
  userId: string,
  forumMod: StorageModule,
  msg: Api.Message,
  defaultFolderId?: string
): Promise<FileRecord | null> {
  if (!msg.media) return null;

  // 1. Ignore database backup messages and internal system artifacts
  if (
    msg.message &&
    (msg.message.includes("TELECLOUD_DB_BACKUP") || msg.message.includes("TELECLOUD_BACKUP"))
  ) {
    return null;
  }

  // Check if message is already indexed
  const allFiles = db.files.allRaw();
  const alreadyIndexed = allFiles.some(
    (f) => f.telegramMessageId === msg.id || f.chunks?.some((c) => c.messageId === msg.id)
  );
  if (alreadyIndexed) return null;

  let filename = `file_${msg.id}`;
  let size = 0;
  let mimeType = "application/octet-stream";

  if (msg.media instanceof Api.MessageMediaDocument || (msg.media as any)?.className === "MessageMediaDocument") {
    const doc = (msg.media as any).document;
    if (doc instanceof Api.Document || doc?.className === "Document") {
      size = (doc.size as any)?.toJSNumber ? (doc.size as any).toJSNumber() : Number(doc.size);
      mimeType = doc.mimeType || "application/octet-stream";
      const fnAttr = doc.attributes?.find(
        (a: any) => a.className === "DocumentAttributeFilename"
      ) as Api.DocumentAttributeFilename | undefined;
      filename = fnAttr?.fileName || msg.message || `file_${msg.id}`;
    }
  } else if (msg.media instanceof Api.MessageMediaPhoto || (msg.media as any)?.className === "MessageMediaPhoto") {
    mimeType = "image/jpeg";
    filename = msg.message ? `${msg.message}.jpg` : `photo_${msg.id}.jpg`;
    size = 1048576; // default 1MB if unknown
    const photo = (msg.media as any).photo;
    if ((photo instanceof Api.Photo || photo?.className === "Photo") && Array.isArray(photo.sizes)) {
      const largest = photo.sizes[photo.sizes.length - 1];
      if ((largest as any)?.size) {
        size = (largest as any).size;
      }
    }
  } else {
    return null;
  }

  // 2. Reject database backups, sqlite files, or system artifacts by filename or MIME
  const lowerName = filename.toLowerCase();
  if (
    lowerName === "db.sqlite" ||
    lowerName.endsWith(".sqlite") ||
    lowerName.endsWith(".sqlite-wal") ||
    lowerName.endsWith(".sqlite-shm") ||
    lowerName.startsWith("telecloud_backup_") ||
    mimeType === "application/x-sqlite3"
  ) {
    return null;
  }

  // 3. Determine target folder from forum topic ID
  const replyToMsgId =
    (msg.replyTo as any)?.replyToTopId || (msg.replyTo as any)?.replyToMsgId;

  let folderId = defaultFolderId || `root_${userId}`;

  if (replyToMsgId && replyToMsgId !== 1) {
    const allFolders = db.folders.allRaw();
    const matched = allFolders.find((f) => f.topicId === replyToMsgId);
    if (matched) {
      folderId = matched.id;
    } else {
      // Message was sent to a topic that is NOT a user folder
      // (e.g. "⚙️ System / Backups" topic, or an external/deleted topic).
      // DO NOT dump it into root folder or default folder. Skip it.
      return null;
    }
  } else {
    // Only messages sent without a topic or to the General topic (topicId 1) belong to root
    folderId = `root_${userId}`;
  }

  const record: FileRecord = {
    id: uuid(),
    folderId,
    name: filename,
    size,
    mimeType,
    chunks: [
      {
        chatId: forumMod.chatId,
        accessHash: forumMod.accessHash,
        messageId: msg.id,
        partIndex: 0,
        size,
      },
    ],
    encrypted: false,
    createdAt: (msg.date || Math.floor(Date.now() / 1000)) * 1000,
    telegramMessageId: msg.id,
  };

  db.files.create(record);
  console.log(`[TelegramSync] Indexed incoming file "${filename}" (${size} bytes) into folder ${folderId}`);
  return record;
}

export async function syncTopicMessages(
  client: TelegramClient,
  userId: string,
  folderId: string
): Promise<{ importedCount: number; files: FileRecord[] }> {
  // Purge any lingering system backup entries from db.files before returning files
  try {
    const { purgeSystemBackups } = await import("../db/sqlite");
    purgeSystemBackups();
  } catch {}

  const forumMod = await getOrCreateForumSupergroup(client, userId);
  const folder = db.folders.get(folderId);
  const peer = inputPeerFor(forumMod);

  const isRoot = !folder || !folder.parentId || folder.id === `root_${userId}`;

  const getParams: any = { limit: 100 };
  if (folder && folder.topicId) {
    getParams.replyTo = folder.topicId;
  }

  let messages: any[] = [];
  try {
    messages = await client.getMessages(peer, getParams);
  } catch (err: any) {
    if (/AUTH_KEY_DUPLICATED/i.test(err?.message || err?.errorMessage || "")) {
      evictClientForUser(userId);
      throw new Error("Telegram session is active on another instance (e.g. Local vs Render). Please stop other running instances and try again.");
    }
    throw err;
  }
  const imported: FileRecord[] = [];

  for (const msg of messages) {
    if (msg instanceof Api.Message && msg.media) {
      const msgTopicId =
        (msg.replyTo as any)?.replyToTopId || (msg.replyTo as any)?.replyToMsgId;

      // When syncing root folder:
      // Skip any message that was sent inside a specific subfolder topic or backup topic
      if (isRoot && msgTopicId && msgTopicId !== 1) {
        continue;
      }

      // When syncing a specific subfolder:
      // Skip any message that is not part of this subfolder's topic
      if (!isRoot && folder?.topicId && msgTopicId !== folder.topicId) {
        continue;
      }

      const rec = await indexTelegramMessage(client, userId, forumMod, msg, folderId);
      if (rec && rec.folderId === folderId) {
        imported.push(rec);
      }
    }
  }

  return { importedCount: imported.length, files: imported };
}

export async function startTelegramSyncListener(
  client: TelegramClient,
  userId: string
): Promise<void> {
  if (activeListeners.has(userId)) return;

  try {
    const forumMod = await getOrCreateForumSupergroup(client, userId);
    activeListeners.add(userId);

    client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const msg = event.message;
        if (!msg || !msg.media) return;
        await indexTelegramMessage(client, userId, forumMod, msg);
      } catch (err: any) {
        console.warn("[TelegramSync] Error handling incoming message:", err?.message);
      }
    }, new NewMessage({ chats: [bigInt(forumMod.chatId)] }));

    console.log(`[TelegramSync] Live message listener active for user ${userId} on forum supergroup ${forumMod.chatId}`);
  } catch (err: any) {
    console.warn(`[TelegramSync] Could not start listener for user ${userId}:`, err?.message);
  }
}

// Evict and disconnect an invalidated or revoked client
export function evictClientForUser(userId: string): void {
  const cached = activeClients.get(userId);
  if (cached) {
    try {
      cached.disconnect();
    } catch {}
    activeClients.delete(userId);
  }
  activeListeners.delete(userId);
}

// Get (or reconnect) the live client for an already-logged-in user.
export async function getClientForUser(userId: string): Promise<TelegramClient> {
  const cached = activeClients.get(userId);
  if (cached && cached.connected) {
    startTelegramSyncListener(cached, userId).catch(() => {});
    return cached;
  }

  const user = db.users.get(userId);
  if (!user) throw new Error("User not found");

  const client = newClient(decryptSession(user.sessionString));
  try {
    await client.connect();
  } catch (err: any) {
    if (
      /SESSION_REVOKED|AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED/i.test(err?.message || err?.errorMessage || "") ||
      err?.code === 406
    ) {
      console.warn(`[TelegramClient] Session for user ${userId} invalidated by Telegram:`, err?.message);
      evictClientForUser(userId);
      const authErr: any = new Error("Telegram session was invalidated by Telegram security (AUTH_KEY_DUPLICATED). Please log in again.");
      authErr.status = 401;
      authErr.code = "SESSION_EXPIRED";
      throw authErr;
    }
    throw err;
  }
  activeClients.set(userId, client);
  startTelegramSyncListener(client, userId).catch(() => {});
  return client;
}
