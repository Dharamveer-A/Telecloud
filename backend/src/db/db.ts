import path from "path";
import fs from "fs";
import { sqliteDb, migrateFromLowDbIfEmpty } from "./sqlite";

// ---- Types -----------------------------------------------------------

export interface StorageModule {
  id: string;          // internal id, e.g. "mod_1"
  chatId: string;       // Telegram chat id used to store file chunks
  accessHash: string;   // required alongside chatId to reliably address
  fileCount: number;    // how many chunks currently live here
  createdAt: number;
}

export interface FileChunk {
  chatId: string;        // which storage module this chunk lives in
  accessHash: string;     // access hash for that same channel
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
  deletedAt?: number | null; // NULL if active, timestamp if in Trash
  telegramMessageId?: number; // Main message ID in Telegram
  sha256?: string;           // SHA-256 content hash for instant deduplication
}

export interface FolderRecord {
  id: string;
  parentId: string | null; // null = root
  name: string;
  createdAt: number;
  locked: boolean;
  passwordHash?: string;  // scrypt hash, only set when locked
  salt?: string;
  deletedAt?: number | null; // NULL if active, timestamp if in Trash
  topicId?: number | null;   // Telegram forum topic ID
}

export interface UserRecord {
  id: string;             // Telegram user id, as string
  phone: string;
  sessionString: string;  // encrypted GramJS session, see crypto.ts
  createdAt: number;
}

export interface ShareRecord {
  id: string;
  token: string;
  userId: string;
  targetType: "file" | "folder";
  targetId: string;
  passwordHash?: string | null;
  salt?: string | null;
  expiresAt?: number | null; // null = never expires
  createdAt: number;
  downloadsCount: number;
  folderKey?: string | null; // encrypted with masterKey() if target was locked/encrypted
  shareMode?: "preview_and_zip" | "zip_only" | null;
}

export interface Schema {
  users: UserRecord[];
  folders: FolderRecord[];
  files: FileRecord[];
  modules: StorageModule[];
  shares: ShareRecord[];
}

// ---- Database Interface -----------------------------------------------

class DataProxy {
  get users(): UserRecord[] {
    return sqliteDb.getAllUsers();
  }
  get folders(): FolderRecord[] {
    return sqliteDb.getAllFoldersRaw();
  }
  get files(): FileRecord[] {
    return sqliteDb.getAllFilesRaw();
  }
  get modules(): StorageModule[] {
    return sqliteDb.getAllModules();
  }
  get shares(): ShareRecord[] {
    return sqliteDb.getAllShares();
  }
}

const dataProxy = new DataProxy();

export const db = {
  read: async () => {},
  write: async () => {},
  get data() {
    return dataProxy;
  },
  users: {
    get: sqliteDb.getUser,
    all: sqliteDb.getAllUsers,
    save: sqliteDb.saveUser,
  },
  folders: {
    get: sqliteDb.getFolder,
    subfolders: sqliteDb.getSubfolders,
    countSubfolders: sqliteDb.countSubfolders,
    all: sqliteDb.getAllFolders,
    allRaw: sqliteDb.getAllFoldersRaw,
    create: sqliteDb.createFolder,
    update: sqliteDb.updateFolder,
    softDelete: sqliteDb.softDeleteFolder,
    restore: sqliteDb.restoreFolder,
    deletePermanent: sqliteDb.deleteFolderPermanent,
  },
  files: {
    get: sqliteDb.getFile,
    byFolder: sqliteDb.getFilesInFolder,
    countByFolder: sqliteDb.countFilesInFolder,
    allRaw: sqliteDb.getAllFilesRaw,
    create: sqliteDb.createFile,
    update: sqliteDb.updateFile,
    softDelete: sqliteDb.softDeleteFile,
    restore: sqliteDb.restoreFile,
    deletePermanent: sqliteDb.deleteFilePermanent,
    byHash: sqliteDb.getFileByHash,
  },
  modules: {
    get: sqliteDb.getModule,
    byChatId: sqliteDb.getModuleByChatId,
    byUser: sqliteDb.getUserModules,
    all: sqliteDb.getAllModules,
    create: sqliteDb.createModule,
    incrementCount: sqliteDb.updateModuleCount,
    setCount: sqliteDb.setModuleCount,
    setAccessHash: sqliteDb.setModuleAccessHash,
  },
  shares: {
    create: sqliteDb.createShare,
    getByToken: sqliteDb.getShareByToken,
    getById: sqliteDb.getShareById,
    byUser: sqliteDb.getSharesByUser,
    byTarget: sqliteDb.getShareByTarget,
    delete: sqliteDb.deleteShare,
    deleteByTarget: sqliteDb.deleteSharesByTarget,
    incrementDownloads: sqliteDb.incrementShareDownloads,
  },
  trash: {
    get: sqliteDb.getTrash,
    empty: sqliteDb.emptyTrash,
  },
  search: sqliteDb.searchFilesAndFolders,
};

export async function initDb() {
  migrateFromLowDbIfEmpty();
}
