import { TelegramClient, Api } from "telegram";
import bigInt from "big-integer";
import { db, StorageModule } from "../db/db";

const ROTATE_AFTER = parseInt(process.env.MODULE_ROTATE_AFTER_FILES || "2000", 10);

// Every user's files live across one or more private Telegram channels
// ("modules") that this app creates and manages automatically. The user
// never sees or picks these - the folder view in the UI is built purely
// from the metadata DB, which just happens to point at pieces spread
// across whichever modules had room when each chunk was uploaded.
//
// IMPORTANT: GramJS (like Telethon) needs an entity's *access hash*, not
// just its numeric ID, to reliably send/fetch messages once the client's
// in-memory entity cache is empty (e.g. after any server restart, since
// StringSession does not persist that cache). Passing a bare chat ID
// works only while the process that created the channel is still running
// - the moment you restart, you'd hit:
//   "Could not find the input entity for ... PeerUser/PeerChannel"
// So every module stores its accessHash, and callers always go through
// getInputPeer()/getInputPeerForChatId() below rather than passing
// mod.chatId directly to client methods.

export function inputPeerFor(mod: StorageModule): Api.InputPeerChannel {
  return new Api.InputPeerChannel({
    channelId: bigInt(mod.chatId),
    accessHash: bigInt(mod.accessHash),
  });
}

// Looks a chatId up in the local modules table to rebuild its InputPeer.
// If an older record is missing accessHash (e.g. from before this fix),
// falls back to asking Telegram to resolve it once, then persists the
// hash so this never has to happen again for that module.
export async function getInputPeerForChatId(client: TelegramClient, chatId: string): Promise<Api.InputPeerChannel> {
  await db.read();
  const mod = db.data!.modules.find((m) => m.chatId === chatId);
  if (!mod) throw new Error(`Unknown storage module for chat ${chatId}`);

  if (mod.accessHash) return inputPeerFor(mod);

  const entity = (await client.getEntity(chatId)) as Api.Channel;
  mod.accessHash = entity.accessHash!.toString();
  await db.write();
  return inputPeerFor(mod);
}

export async function getWritableModule(client: TelegramClient, userId: string): Promise<StorageModule> {
  await db.read();
  const userModules = db.data!.modules.filter((m) => m.id.startsWith(`u${userId}_`));

  const withRoom = userModules
    .sort((a, b) => a.createdAt - b.createdAt)
    .find((m) => m.fileCount < ROTATE_AFTER);

  if (withRoom) return withRoom;

  return createModule(client, userId, userModules.length + 1);
}

async function createModule(client: TelegramClient, userId: string, index: number): Promise<StorageModule> {
  const result = await client.invoke(
    new Api.channels.CreateChannel({
      title: `TeleCloud Storage ${index}`,
      about: "Managed by TeleCloud - do not delete. Deleting this loses files stored here.",
      megagroup: false,
      broadcast: true,
    })
  );

  // CreateChannel returns an Updates object; pull the new channel out of it.
  const chats = (result as any).chats as Api.Channel[];
  const channel = chats[0];

  const mod: StorageModule = {
    id: `u${userId}_${channel.id.toString()}`,
    chatId: channel.id.toString(),
    accessHash: channel.accessHash!.toString(),
    fileCount: 0,
    createdAt: Date.now(),
  };

  await db.read();
  db.data!.modules.push(mod);
  await db.write();
  return mod;
}

export async function recordChunkStored(moduleId: string) {
  await db.read();
  const mod = db.data!.modules.find((m) => m.id === moduleId);
  if (mod) {
    mod.fileCount += 1;
    await db.write();
  }
}

// Marks a module as unusable (e.g. Telegram rejected it with
// CHANNEL_INVALID - deleted, or created under old buggy data) by pinning
// its fileCount at the rotation ceiling so getWritableModule() never
// selects it again. Left in place rather than deleted so existing files
// that still point at it are not silently orphaned from the index.
export async function invalidateModule(moduleId: string) {
  await db.read();
  const mod = db.data!.modules.find((m) => m.id === moduleId);
  if (mod) {
    mod.fileCount = ROTATE_AFTER;
    await db.write();
  }
}
