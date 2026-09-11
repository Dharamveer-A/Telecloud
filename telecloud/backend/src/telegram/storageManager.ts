import { TelegramClient, Api } from "telegram";
import { db, StorageModule } from "../db/db";

const ROTATE_AFTER = parseInt(process.env.MODULE_ROTATE_AFTER_FILES || "2000", 10);

// Every user's files live across one or more private Telegram channels
// ("modules") that this app creates and manages automatically. The user
// never sees or picks these - the folder view in the UI is built purely
// from the metadata DB, which just happens to point at pieces spread
// across whichever modules had room when each chunk was uploaded.

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
  const chatId = channel.id.toString();

  const mod: StorageModule = {
    id: `u${userId}_${chatId}`,
    chatId,
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
