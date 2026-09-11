import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import fs from "fs";

// ---- Types -----------------------------------------------------------

export interface StorageModule {
  id: string;          // internal id, e.g. "mod_1"
  chatId: string;       // Telegram chat id used to store file chunks
  fileCount: number;    // how many chunks currently live here
  createdAt: number;
}

export interface FileChunk {
  chatId: string;        // which storage module this chunk lives in
  messageId: number;      // Telegram message id holding this chunk
  partIndex: number;      // 0-based order of this chunk within the file
  size: number;
}

export interface FileRecord {
  id: string;
  folderId: string;
  name: string;
  mimeType: string;
  size: number;            // total logical size across all chunks
  createdAt: number;
  chunks: FileChunk[];      // ordered list, reassembled on download
  encrypted: boolean;       // true if the parent folder is locked
  iv?: string;               // AES-GCM IV, only set when encrypted
}

export interface FolderRecord {
  id: string;
  parentId: string | null; // null = root
  name: string;
  createdAt: number;
  locked: boolean;
  passwordHash?: string;  // scrypt hash, only set when locked
  salt?: string;
}

export interface UserRecord {
  id: string;             // Telegram user id, as string
  phone: string;
  sessionString: string;  // encrypted GramJS session, see crypto.ts
  createdAt: number;
}

interface Schema {
  users: UserRecord[];
  folders: FolderRecord[];
  files: FileRecord[];
  modules: StorageModule[];
}

// ---- Setup -------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbFile = path.join(DATA_DIR, "db.json");
const adapter = new JSONFile<Schema>(dbFile);
export const db = new Low<Schema>(adapter, {
  users: [],
  folders: [],
  files: [],
  modules: [],
});

export async function initDb() {
  await db.read();
  db.data ||= { users: [], folders: [], files: [], modules: [] };

  // Every user gets an implicit root folder the first time they log in;
  // handled in auth route. Nothing to seed here.
  await db.write();
}
