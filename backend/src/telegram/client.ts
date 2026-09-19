import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import { encryptSession, decryptSession } from "../utils/crypto";
import { db } from "../db/db";
import { getOrCreateForumSupergroup } from "./storageManager";

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
const apiHash = process.env.TELEGRAM_API_HASH || "";

if (!apiId || !apiHash) {
  console.warn(
    "[telecloud] TELEGRAM_API_ID / TELEGRAM_API_HASH are not set. " +
      "Get free ones from https://my.telegram.org before logging in."
  );
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
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
  });
}

// Step 1: user submits their phone number.
export async function requestLoginCode(phone: string): Promise<void> {
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
    // give every new user a root folder
    db.folders.create({
      id: `root_${userId}`,
      parentId: null,
      name: "My Files",
      createdAt: Date.now(),
      locked: false,
    });
    // Auto-provision the TeleCloud Drive forum supergroup in Telegram
    getOrCreateForumSupergroup(client, userId).catch((err) => {
      console.warn("Notice: could not auto-provision forum supergroup at login (will retry on first folder upload):", err?.message);
    });
  }

  pendingLogins.delete(phone);
  activeClients.set(userId, client);
  return { status: "ok", userId };
}

// Get (or reconnect) the live client for an already-logged-in user.
export async function getClientForUser(userId: string): Promise<TelegramClient> {
  const cached = activeClients.get(userId);
  if (cached && cached.connected) return cached;

  const user = db.users.get(userId);
  if (!user) throw new Error("User not found");

  const client = newClient(decryptSession(user.sessionString));
  await client.connect();
  activeClients.set(userId, client);
  return client;
}
