import { TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { v4 as uuid } from "uuid";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import crypto from "crypto";
import { db, FileRecord, FileChunk } from "../db/db";
import { getWritableModule, recordChunkStored, inputPeerFor, getInputPeerForChatId, invalidateModule, getOrCreateForumSupergroup, createFolderTopic } from "./storageManager";
import { encryptBuffer, decryptBuffer, encryptFile, decryptStream } from "../utils/crypto";

// Telegram maximum file size ceiling for general non-media files (ZIP, ISO, documents, installers).
// 1.90 GB leaves a safe ~247 MB buffer below Telegram's strict 2.00 GB ceiling for metadata & encryption.
export const MAX_TELEGRAM_CHUNK = 1900000000; // 1.90 GB

// Default chunk size for video/audio streaming and uploading: 30 MB (31,457,280 bytes).
// Splitting media files into 10MB–50MB chunks enables instant video/audio playback (<800ms),
// fast seeking via HTTP Range requests, and strictly bounded RAM usage.
export const VIDEO_STREAMING_CHUNK = 30 * 1024 * 1024; // 30 MB
export const DEFAULT_CHUNK_SIZE = VIDEO_STREAMING_CHUNK;

export function isMediaFile(mimeType?: string, filename?: string): boolean {
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    if (lower.startsWith("video/") || lower.startsWith("audio/")) return true;
  }
  if (filename) {
    const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
    const mediaExts = new Set([
      "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "3gp", "ts",
      "mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "wma"
    ]);
    if (mediaExts.has(ext)) return true;
  }
  return false;
}

export function getChunkSize(mimeType?: string, filename?: string): number {
  const isMedia = isMediaFile(mimeType, filename);
  if (isMedia) {
    if (process.env.CHUNK_SIZE_BYTES) {
      const parsed = parseInt(process.env.CHUNK_SIZE_BYTES, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return VIDEO_STREAMING_CHUNK;
  }

  // Non-media files (archives, ISOs, documents): use Telegram large chunk ceiling (1.90 GB)
  if (process.env.MAX_TELEGRAM_FILE_BYTES) {
    const parsed = parseInt(process.env.MAX_TELEGRAM_FILE_BYTES, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return MAX_TELEGRAM_CHUNK;
}

// Default max range burst for video streaming HTTP Range requests: matches chunk size (30MB)
export const DEFAULT_RANGE_BURST = 30 * 1024 * 1024; // 30 MB

export function getRangeBurstSize(mimeType?: string, filename?: string): number | undefined {
  if (process.env.MAX_RANGE_BURST) {
    const parsed = parseInt(process.env.MAX_RANGE_BURST, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  // Clamp only media streaming requests; non-media file downloads are not restricted to burst windows
  if (isMediaFile(mimeType, filename)) {
    return DEFAULT_RANGE_BURST;
  }
  return undefined;
}

const TMP_DIR = path.join(process.env.DATA_DIR || "./data", "tmp");
async function ensureTmpDir() {
  await fs.mkdir(TMP_DIR, { recursive: true });
}



export interface UploadOptions {
  userId: string;
  folderId: string;
  filename: string;
  mimeType: string;
  filePath: string;
  size: number;
  fileKey?: Buffer; // present only if the target folder is locked
  progressCallback?: (progress: number) => void;
}

import { pipeline } from "stream/promises";

async function extractChunk(sourcePath: string, start: number, length: number, outPath: string) {
  // If the file is 0 bytes, creating a stream with start=0, end=-1 throws an error.
  if (length === 0) {
    await fs.writeFile(outPath, "");
    return;
  }
  const rs = createReadStream(sourcePath, { start, end: start + length - 1 });
  const ws = createWriteStream(outPath);
  await pipeline(rs, ws);
}

export function formatPartFilename(filename: string, partIndex: number, totalParts: number): string {
  if (totalParts <= 1) return filename;
  const padWidth = Math.max(3, String(totalParts).length);
  const partNumber = String(partIndex + 1).padStart(padWidth, "0");
  return `${filename}.part${partNumber}`;
}

export function formatPartCaption(filename: string, partIndex: number, totalParts: number): string {
  if (totalParts <= 1) return filename;
  const padWidth = Math.max(3, String(totalParts).length);
  const partNumber = String(partIndex + 1).padStart(padWidth, "0");
  const totalPartsStr = String(totalParts).padStart(padWidth, "0");
  return `${filename} (part ${partNumber}/${totalPartsStr})`;
}

export async function uploadFile(client: TelegramClient, opts: UploadOptions): Promise<FileRecord> {
  const { userId, folderId, filename, mimeType, fileKey, size } = opts;
  let { filePath } = opts;
  let iv: string | undefined;
  let encPath: string | undefined;

  let totalSize = size;
  
  if (fileKey) {
    encPath = filePath + ".enc";
    const res = await encryptFile(filePath, encPath, fileKey);
    iv = res.iv;
    filePath = encPath;
    totalSize = (await fs.stat(filePath)).size;
  }

  const folder = db.folders.get(folderId);
  let forumMod: any;
  try {
    forumMod = await getOrCreateForumSupergroup(client, userId);
    if (folder && folder.parentId && !folder.topicId) {
      const topicId = await createFolderTopic(client, forumMod, folder.name);
      if (topicId) {
        db.folders.update(folder.id, { topicId });
        folder.topicId = topicId;
      }
    }
  } catch (err) {
    console.error("Failed to setup forum supergroup or topic for upload:", err);
  }

  try {
    const chunkSize = getChunkSize(mimeType, filename);
    const partsCount = Math.max(1, Math.ceil(totalSize / chunkSize));
    const chunks: FileChunk[] = [];
    
    for (let i = 0; i < partsCount; i++) {
      const offset = i * chunkSize;
      const length = Math.min(chunkSize, totalSize - offset);
      
      await ensureTmpDir();
      const chunkPath = path.join(TMP_DIR, `${uuid()}.part`);
      await extractChunk(filePath, offset, length, chunkPath);

      let targetMod = forumMod || (await getWritableModule(client, userId));
      let sent;
      try {
        const partFilename = formatPartFilename(filename, i, partsCount);
        const partCaption = formatPartCaption(filename, i, partsCount);
        const customFile = new CustomFile(partFilename, length, chunkPath);
        const sendParams: any = {
          file: customFile,
          forceDocument: true,
          caption: partCaption,
          workers: 4,
          progressCallback: opts.progressCallback ? (p: number) => {
            const overall = (i + p) / partsCount;
            opts.progressCallback!(overall);
          } : undefined,
        };

        if (folder?.topicId) {
          sendParams.replyTo = folder.topicId;
        }

        const sendWithFloodRetry = async (peer: any, params: any) => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              return await client.sendFile(peer, params);
            } catch (err: any) {
              const waitMatch = (err?.errorMessage || err?.message || "").match(/FLOOD_WAIT_(\d+)/i);
              const waitSeconds = waitMatch ? parseInt(waitMatch[1], 10) : err?.seconds;
              if (waitSeconds && waitSeconds <= 60 && attempt < 2) {
                console.warn(`[Upload] Telegram FloodWait encountered: waiting ${waitSeconds}s before retrying part ${i + 1}/${partsCount}...`);
                await new Promise((r) => setTimeout(r, (waitSeconds + 1) * 1000));
                continue;
              }
              throw err;
            }
          }
        };

        try {
          sent = await sendWithFloodRetry(inputPeerFor(targetMod), sendParams);
        } catch (err: any) {
          if (targetMod === forumMod) {
            console.warn("Forum send failed, falling back to standard storage module:", err?.message);
            targetMod = await getWritableModule(client, userId);
            sent = await sendWithFloodRetry(inputPeerFor(targetMod), { ...sendParams, replyTo: undefined });
          } else if (err?.errorMessage === "CHANNEL_INVALID" || /CHANNEL_INVALID/i.test(err?.message || "")) {
            await invalidateModule(targetMod.id);
            targetMod = await getWritableModule(client, userId);
            sent = await sendWithFloodRetry(inputPeerFor(targetMod), sendParams);
          } else {
            throw err;
          }
        }
      } finally {
        await fs.unlink(chunkPath).catch(() => {});
      }

      chunks.push({
        chatId: targetMod.chatId,
        accessHash: targetMod.accessHash,
        messageId: (sent as any).id,
        partIndex: i,
        size: length,
      });
      await recordChunkStored(targetMod.id);

      // Light pacing between multi-part uploads to avoid Telegram rate-limit bursts
      if (i < partsCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const record: FileRecord = {
      id: uuid(),
      folderId,
      name: filename,
      mimeType,
      size: size, // original, unencrypted size for display
      createdAt: Date.now(),
      chunks,
      encrypted: !!fileKey,
      iv,
    };

    db.files.create(record);
    return record;
  } finally {
    if (encPath) {
      await fs.unlink(encPath).catch(() => {});
    }
  }
}

// In-memory LRU cache of chunk buffers (e.g. for media streaming & scrubbing).
// Bounded to chunks <= 64MB and at most 8 items to strictly bound heap usage (~250MB RAM).
const MAX_CACHEABLE_BYTES = 64 * 1024 * 1024;
const CHUNK_CACHE_LIMIT = 8;
const chunkCache = new Map<string, Buffer>();

function cacheGet(key: string): Buffer | undefined {
  const val = chunkCache.get(key);
  if (val) {
    chunkCache.delete(key);
    chunkCache.set(key, val); // refresh recency
  }
  return val;
}
function cacheSet(key: string, val: Buffer) {
  if (val.length > MAX_CACHEABLE_BYTES) return; // do not cache giant chunks in RAM
  chunkCache.set(key, val);
  if (chunkCache.size > CHUNK_CACHE_LIMIT) {
    const oldest = chunkCache.keys().next().value;
    if (oldest) chunkCache.delete(oldest);
  }
}

async function fetchChunkBuffer(client: TelegramClient, chunk: FileChunk): Promise<Buffer> {
  const cacheKey = `${chunk.chatId}:${chunk.messageId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const peer = chunk.accessHash
    ? inputPeerFor({ chatId: chunk.chatId, accessHash: chunk.accessHash } as any)
    : await getInputPeerForChatId(client, chunk.chatId);
  const [msg] = await client.getMessages(peer, { ids: [chunk.messageId] });
  const buf = (await client.downloadMedia(msg)) as Buffer;
  cacheSet(cacheKey, buf);
  return buf;
}

async function fetchChunkToStream(client: TelegramClient, chunk: FileChunk, writable: import("stream").Writable): Promise<void> {
  const peer = chunk.accessHash
    ? inputPeerFor({ chatId: chunk.chatId, accessHash: chunk.accessHash } as any)
    : await getInputPeerForChatId(client, chunk.chatId);
  const [msg] = await client.getMessages(peer, { ids: [chunk.messageId] });
  
  // Custom class for streaming Telegram output directly to our Writable
  class WritableStreamOutput {
    stream: import("stream").Writable;
    constructor(stream: import("stream").Writable) {
      this.stream = stream;
    }
    async write(buffer: Buffer) {
      if (!this.stream.write(buffer)) {
        await new Promise(r => this.stream.once('drain', r));
      }
    }
    async close() {}
  }
  
  await client.downloadMedia(msg, {
    outputFile: new WritableStreamOutput(writable) as any
  });
}

// Cumulative byte offset (in the reconstructed, still-possibly-encrypted
// stream) at which each ordered chunk begins.
function chunkOffsets(ordered: FileChunk[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const c of ordered) {
    offsets.push(acc);
    acc += c.size;
  }
  return offsets;
}

async function fetchAndStreamChunkRange(
  client: TelegramClient,
  chunk: FileChunk,
  chunkStart: number,
  reqStart: number,
  reqEnd: number,
  res: any
): Promise<void> {
  const cacheKey = `${chunk.chatId}:${chunk.messageId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    const sliceStart = Math.max(0, reqStart - chunkStart);
    const sliceEnd = Math.min(cached.length, reqEnd - chunkStart + 1);
    const slice = cached.subarray(sliceStart, sliceEnd);
    if (slice.length > 0 && !res.writableEnded) {
      res.write(slice);
    }
    return;
  }

  const peer = chunk.accessHash
    ? inputPeerFor({ chatId: chunk.chatId, accessHash: chunk.accessHash } as any)
    : await getInputPeerForChatId(client, chunk.chatId);
  const [msg] = await client.getMessages(peer, { ids: [chunk.messageId] });
  if (!msg) return;

  const collected: Buffer[] = [];
  let currentOffset = chunkStart;

  class StreamingRangeWriter {
    async write(part: Buffer) {
      if (res.destroyed) {
        throw new Error("Client closed stream");
      }

      collected.push(part);

      const partStart = currentOffset;
      const partEnd = currentOffset + part.length - 1;
      currentOffset += part.length;

      // Check if this incoming part overlaps the requested [reqStart, reqEnd]
      if (partEnd >= reqStart && partStart <= reqEnd) {
        const sliceStart = Math.max(0, reqStart - partStart);
        const sliceEnd = Math.min(part.length, reqEnd - partStart + 1);
        const slice = part.subarray(sliceStart, sliceEnd);
        if (slice.length > 0 && !res.writableEnded && !res.destroyed) {
          if (!res.write(slice)) {
            await new Promise<void>((resolve) => {
              const onDrain = () => { cleanup(); resolve(); };
              const onClose = () => { cleanup(); resolve(); };
              const cleanup = () => {
                res.removeListener("drain", onDrain);
                res.removeListener("close", onClose);
              };
              res.once("drain", onDrain);
              res.once("close", onClose);
            });
          }
        }
      }
    }
    async close() {}
  }

  try {
    await client.downloadMedia(msg, {
      outputFile: new StreamingRangeWriter() as any,
    });
  } catch (err: any) {
    if (res.writableEnded || res.destroyed || /closed|aborted|destroyed/i.test(err?.message || "")) {
      return;
    }
    throw err;
  }

  if (collected.length > 0) {
    const full = Buffer.concat(collected);
    // Only cache in RAM if the chunk was completely downloaded
    if (full.length === chunk.size) {
      cacheSet(cacheKey, full);
    }
  }
}

// Fetches only the chunk(s) covering [start, end] (inclusive byte range)
// and returns exactly those bytes. Only safe for UNENCRYPTED files -
// AES-GCM requires the whole ciphertext to verify its auth tag, so
// encrypted files always fall back to downloadFile() + slicing in memory.
export async function streamFileRangeToResponse(
  client: TelegramClient,
  file: FileRecord,
  res: any,
  start: number,
  end: number
): Promise<void> {
  const ordered = [...file.chunks].sort((a, b) => a.partIndex - b.partIndex);
  const offsets = chunkOffsets(ordered);

  for (let i = 0; i < ordered.length; i++) {
    if (res.writableEnded || res.destroyed) break;
    const chunkStart = offsets[i];
    const chunkEnd = chunkStart + ordered[i].size - 1;
    if (chunkEnd < start || chunkStart > end) continue;

    await fetchAndStreamChunkRange(client, ordered[i], chunkStart, start, end, res);
    // If this chunk covered the end of the requested range, stop processing further chunks
    if (chunkEnd >= end) break;
  }
  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
}

export async function downloadFileRange(
  client: TelegramClient,
  file: FileRecord,
  start: number,
  end: number
): Promise<Buffer> {
  const ordered = [...file.chunks].sort((a, b) => a.partIndex - b.partIndex);
  const offsets = chunkOffsets(ordered);

  const pieces: Buffer[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const chunkStart = offsets[i];
    const chunkEnd = chunkStart + ordered[i].size - 1;
    if (chunkEnd < start || chunkStart > end) continue; // no overlap with requested range

    const buf = await fetchChunkBuffer(client, ordered[i]);
    const sliceStart = Math.max(0, start - chunkStart);
    const sliceEnd = Math.min(buf.length, end - chunkStart + 1);
    pieces.push(buf.subarray(sliceStart, sliceEnd));
  }
  return Buffer.concat(pieces);
}

export async function streamFileToResponse(client: TelegramClient, file: FileRecord, res: any, fileKey?: Buffer): Promise<void> {
  const ordered = [...file.chunks].sort((a, b) => a.partIndex - b.partIndex);
  
  if (file.encrypted) {
    if (!fileKey || !file.iv) throw new Error("Password required to decrypt this file");
    
    const { GCMTagExtractor } = require("../utils/crypto");
    const extractor = new GCMTagExtractor();
    const iv = Buffer.from(file.iv, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", fileKey, iv);
    
    extractor.on("data", (chunk: Buffer) => decipher.write(chunk));
    extractor.on("end", () => {
      if (extractor.tag) decipher.setAuthTag(extractor.tag);
      decipher.end();
    });
    
    decipher.pipe(res);
    
    for (const chunk of ordered) {
      await fetchChunkToStream(client, chunk, extractor);
    }
    extractor.end();
  } else {
    for (const chunk of ordered) {
      await fetchChunkToStream(client, chunk, res);
    }
    res.end();
  }
}

export async function downloadFile(client: TelegramClient, file: FileRecord, fileKey?: Buffer): Promise<Buffer> {
  const ordered = [...file.chunks].sort((a, b) => a.partIndex - b.partIndex);
  const buffers: Buffer[] = [];
  for (const chunk of ordered) {
    buffers.push(await fetchChunkBuffer(client, chunk));
  }

  let full: Buffer = Buffer.concat(buffers);

  if (file.encrypted) {
    if (!fileKey || !file.iv) throw new Error("Password required to decrypt this file");
    const tag = Buffer.from(full.subarray(full.length - 16));
    const ciphertext = Buffer.from(full.subarray(0, full.length - 16));
    full = decryptBuffer(ciphertext, fileKey, file.iv, tag);
  }

  return full;
}
