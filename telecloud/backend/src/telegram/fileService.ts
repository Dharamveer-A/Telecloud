import { TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { v4 as uuid } from "uuid";
import { db, FileRecord, FileChunk } from "../db/db";
import { getWritableModule, recordChunkStored } from "./storageManager";
import { encryptBuffer, decryptBuffer } from "../utils/crypto";

const MAX_CHUNK = parseInt(process.env.MAX_TELEGRAM_FILE_BYTES || "2000000000", 10);

export interface UploadOptions {
  userId: string;
  folderId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  fileKey?: Buffer; // present only if the target folder is locked
}

export async function uploadFile(client: TelegramClient, opts: UploadOptions): Promise<FileRecord> {
  const { userId, folderId, filename, mimeType, fileKey } = opts;
  let { data } = opts;
  let iv: string | undefined;

  if (fileKey) {
    const enc = encryptBuffer(data, fileKey);
    // store the GCM tag appended to the ciphertext so we only need one
    // buffer per chunk; split it back off on decrypt.
    data = Buffer.concat([enc.ciphertext, enc.tag]);
    iv = enc.iv;
  }

  const parts: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK) {
    parts.push(data.subarray(offset, offset + MAX_CHUNK));
  }
  if (parts.length === 0) parts.push(Buffer.alloc(0)); // empty file edge case

  const chunks: FileChunk[] = [];
  for (let i = 0; i < parts.length; i++) {
    const mod = await getWritableModule(client, userId);
    const part = parts[i];

    const customFile = new CustomFile(
      `${filename}.part${i}`,
      part.length,
      "",
      part
    );

    const sent = await client.sendFile(mod.chatId, {
      file: customFile,
      forceDocument: true,
      caption: parts.length > 1 ? `${filename} (part ${i + 1}/${parts.length})` : filename,
    });

    chunks.push({
      chatId: mod.chatId,
      messageId: (sent as any).id,
      partIndex: i,
      size: part.length,
    });
    await recordChunkStored(mod.id);
  }

  const record: FileRecord = {
    id: uuid(),
    folderId,
    name: filename,
    mimeType,
    size: opts.data.length, // original, unencrypted size for display
    createdAt: Date.now(),
    chunks,
    encrypted: !!fileKey,
    iv,
  };

  await db.read();
  db.data!.files.push(record);
  await db.write();
  return record;
}

export async function downloadFile(client: TelegramClient, file: FileRecord, fileKey?: Buffer): Promise<Buffer> {
  const ordered = [...file.chunks].sort((a, b) => a.partIndex - b.partIndex);
  const buffers: Buffer[] = [];

  // Chunks can live in different chat modules, so fetch per-chat in
  // batches to minimize round trips, then stitch back together in order.
  const byChat = new Map<string, FileChunk[]>();
  for (const c of ordered) {
    if (!byChat.has(c.chatId)) byChat.set(c.chatId, []);
    byChat.get(c.chatId)!.push(c);
  }

  const partBuffers = new Map<number, Buffer>();
  for (const [chatId, chunkList] of byChat) {
    const ids = chunkList.map((c) => c.messageId);
    const messages = await client.getMessages(chatId, { ids });
    for (const msg of messages) {
      const chunkMeta = chunkList.find((c) => c.messageId === (msg as any).id)!;
      const buf = (await client.downloadMedia(msg)) as Buffer;
      partBuffers.set(chunkMeta.partIndex, buf);
    }
  }

  for (let i = 0; i < ordered.length; i++) {
    const buf = partBuffers.get(i);
    if (!buf) throw new Error(`Missing chunk ${i} for file ${file.id}`);
    buffers.push(buf);
  }

  let full = Buffer.concat(buffers);

  if (file.encrypted) {
    if (!fileKey || !file.iv) throw new Error("Password required to decrypt this file");
    const tag = full.subarray(full.length - 16);
    const ciphertext = full.subarray(0, full.length - 16);
    full = decryptBuffer(ciphertext, fileKey, file.iv, tag);
  }

  return full;
}
