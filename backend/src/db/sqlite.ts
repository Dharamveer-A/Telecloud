import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { UserRecord, FolderRecord, FileRecord, StorageModule, FileChunk, ShareRecord } from "./db";

const DATA_DIR = process.env.DATA_DIR || "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "db.sqlite");
export const sqlite = new Database(dbPath);

// Enable WAL mode for high concurrency
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = OFF");

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT,
    sessionString TEXT,
    createdAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    parentId TEXT,
    name TEXT,
    createdAt INTEGER,
    locked INTEGER DEFAULT 0,
    passwordHash TEXT,
    salt TEXT,
    deletedAt INTEGER DEFAULT NULL,
    topicId INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    folderId TEXT,
    name TEXT,
    mimeType TEXT,
    size INTEGER,
    createdAt INTEGER,
    encrypted INTEGER DEFAULT 0,
    iv TEXT,
    chunks TEXT,
    deletedAt INTEGER DEFAULT NULL,
    sha256 TEXT
  );

  CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    chatId TEXT,
    accessHash TEXT,
    fileCount INTEGER,
    createdAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    userId TEXT NOT NULL,
    targetType TEXT NOT NULL,
    targetId TEXT NOT NULL,
    passwordHash TEXT,
    salt TEXT,
    expiresAt INTEGER,
    createdAt INTEGER NOT NULL,
    downloadsCount INTEGER NOT NULL DEFAULT 0,
    folderKey TEXT,
    shareMode TEXT DEFAULT 'preview_and_zip'
  );
`);

// Run column migrations on existing tables that may lack newer columns
try {
  sqlite.exec("ALTER TABLE shares ADD COLUMN folderKey TEXT");
} catch {}

try {
  sqlite.exec("ALTER TABLE shares ADD COLUMN shareMode TEXT DEFAULT 'preview_and_zip'");
} catch {}

try {
  sqlite.exec("ALTER TABLE folders ADD COLUMN topicId INTEGER DEFAULT NULL");
} catch {}

try {
  sqlite.exec("ALTER TABLE files ADD COLUMN sha256 TEXT");
} catch {}

// Initialize indexes after ensuring all columns exist
sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_folders_parentId ON folders(parentId);
  CREATE INDEX IF NOT EXISTS idx_folders_deletedAt ON folders(deletedAt);
  CREATE INDEX IF NOT EXISTS idx_files_folderId ON files(folderId);
  CREATE INDEX IF NOT EXISTS idx_files_deletedAt ON files(deletedAt);
  CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
  CREATE INDEX IF NOT EXISTS idx_modules_chatId ON modules(chatId);
  CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
  CREATE INDEX IF NOT EXISTS idx_shares_userId ON shares(userId);
  CREATE INDEX IF NOT EXISTS idx_shares_target ON shares(targetId);
`);

// Check and perform automatic migration from db.json if database is empty
export function migrateFromLowDbIfEmpty() {
  const userCount = (sqlite.prepare("SELECT COUNT(*) as count FROM users").get() as any).count;
  const jsonPath = path.join(DATA_DIR, "db.json");

  if (userCount === 0 && fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, "utf-8");
      const data = JSON.parse(raw);

      const insertUser = sqlite.prepare(
        "INSERT OR REPLACE INTO users (id, phone, sessionString, createdAt) VALUES (@id, @phone, @sessionString, @createdAt)"
      );
      const insertFolder = sqlite.prepare(
        "INSERT OR REPLACE INTO folders (id, parentId, name, createdAt, locked, passwordHash, salt, deletedAt) VALUES (@id, @parentId, @name, @createdAt, @locked, @passwordHash, @salt, @deletedAt)"
      );
      const insertFile = sqlite.prepare(
        "INSERT OR REPLACE INTO files (id, folderId, name, mimeType, size, createdAt, encrypted, iv, chunks, deletedAt) VALUES (@id, @folderId, @name, @mimeType, @size, @createdAt, @encrypted, @iv, @chunks, @deletedAt)"
      );
      const insertModule = sqlite.prepare(
        "INSERT OR REPLACE INTO modules (id, chatId, accessHash, fileCount, createdAt) VALUES (@id, @chatId, @accessHash, @fileCount, @createdAt)"
      );

      const migrationTx = sqlite.transaction(() => {
        if (Array.isArray(data.users)) {
          for (const u of data.users) {
            insertUser.run({
              id: String(u.id),
              phone: String(u.phone || ""),
              sessionString: String(u.sessionString || ""),
              createdAt: Number(u.createdAt) || Date.now(),
            });
          }
        }

        if (Array.isArray(data.folders)) {
          for (const f of data.folders) {
            insertFolder.run({
              id: String(f.id),
              parentId: f.parentId ? String(f.parentId) : null,
              name: String(f.name || "Untitled"),
              createdAt: Number(f.createdAt) || Date.now(),
              locked: f.locked ? 1 : 0,
              passwordHash: f.passwordHash || null,
              salt: f.salt || null,
              deletedAt: f.deletedAt ? Number(f.deletedAt) : null,
            });
          }
        }

        if (Array.isArray(data.files)) {
          for (const f of data.files) {
            insertFile.run({
              id: String(f.id),
              folderId: String(f.folderId),
              name: String(f.name || "Untitled"),
              mimeType: String(f.mimeType || "application/octet-stream"),
              size: Number(f.size) || 0,
              createdAt: Number(f.createdAt) || Date.now(),
              encrypted: f.encrypted ? 1 : 0,
              iv: f.iv || null,
              chunks: JSON.stringify(f.chunks || []),
              deletedAt: f.deletedAt ? Number(f.deletedAt) : null,
            });
          }
        }

        if (Array.isArray(data.modules)) {
          for (const m of data.modules) {
            insertModule.run({
              id: String(m.id),
              chatId: String(m.chatId),
              accessHash: String(m.accessHash),
              fileCount: Number(m.fileCount) || 0,
              createdAt: Number(m.createdAt) || Date.now(),
            });
          }
        }
      });

      migrationTx();

      // Create backup of db.json
      fs.copyFileSync(jsonPath, path.join(DATA_DIR, "db.json.bak"));
      console.log("[telecloud-sqlite] Successfully migrated all data from db.json to db.sqlite! (Backup saved to db.json.bak)");
    } catch (err) {
      console.error("[telecloud-sqlite] Failed to migrate db.json to SQLite:", err);
    }
  }
}

// Helpers to map SQLite rows to typed records
function mapFolder(row: any): FolderRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    createdAt: Number(row.createdAt),
    locked: Boolean(row.locked),
    passwordHash: row.passwordHash || undefined,
    salt: row.salt || undefined,
    deletedAt: row.deletedAt ? Number(row.deletedAt) : null,
    topicId: row.topicId !== null && row.topicId !== undefined ? Number(row.topicId) : undefined,
  };
}

function mapFile(row: any): FileRecord {
  let chunks: FileChunk[] = [];
  try {
    chunks = JSON.parse(row.chunks || "[]");
  } catch {}

  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    mimeType: row.mimeType,
    size: Number(row.size),
    createdAt: Number(row.createdAt),
    chunks,
    encrypted: Boolean(row.encrypted),
    iv: row.iv || undefined,
    deletedAt: row.deletedAt ? Number(row.deletedAt) : null,
    telegramMessageId: chunks[0]?.messageId,
    sha256: row.sha256 || undefined,
  };
}

function mapShare(row: any): ShareRecord {
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    targetType: row.targetType,
    targetId: row.targetId,
    passwordHash: row.passwordHash || undefined,
    salt: row.salt || undefined,
    expiresAt: row.expiresAt ? Number(row.expiresAt) : null,
    createdAt: Number(row.createdAt),
    downloadsCount: Number(row.downloadsCount || 0),
    folderKey: row.folderKey || undefined,
    shareMode: (row.shareMode as any) || "preview_and_zip",
  };
}

// Prepared statements for high-speed queries
const stmts = {
  // Users
  getUser: sqlite.prepare("SELECT * FROM users WHERE id = ?"),
  getAllUsers: sqlite.prepare("SELECT * FROM users"),
  saveUser: sqlite.prepare(
    "INSERT OR REPLACE INTO users (id, phone, sessionString, createdAt) VALUES (@id, @phone, @sessionString, @createdAt)"
  ),

  // Folders
  getFolder: sqlite.prepare("SELECT * FROM folders WHERE id = ?"),
  getSubfolders: sqlite.prepare(
    "SELECT * FROM folders WHERE parentId = ? AND deletedAt IS NULL ORDER BY createdAt ASC"
  ),
  getAllFolders: sqlite.prepare("SELECT * FROM folders WHERE deletedAt IS NULL ORDER BY createdAt ASC"),
  getAllFoldersRaw: sqlite.prepare("SELECT * FROM folders"),
  createFolder: sqlite.prepare(
    "INSERT INTO folders (id, parentId, name, createdAt, locked, passwordHash, salt, deletedAt, topicId) VALUES (@id, @parentId, @name, @createdAt, @locked, @passwordHash, @salt, @deletedAt, @topicId)"
  ),
  deleteFolderPermanent: sqlite.prepare("DELETE FROM folders WHERE id = ?"),
  countSubfolders: sqlite.prepare(
    "SELECT COUNT(*) as count FROM folders WHERE parentId = ? AND deletedAt IS NULL"
  ),

  // Files
  getFile: sqlite.prepare("SELECT * FROM files WHERE id = ?"),
  getFilesInFolder: sqlite.prepare(
    "SELECT * FROM files WHERE folderId = ? AND deletedAt IS NULL ORDER BY createdAt ASC"
  ),
  countFilesInFolder: sqlite.prepare(
    "SELECT COUNT(*) as count FROM files WHERE folderId = ? AND deletedAt IS NULL"
  ),
  getAllFilesRaw: sqlite.prepare("SELECT * FROM files"),
  createFile: sqlite.prepare(
    "INSERT INTO files (id, folderId, name, mimeType, size, createdAt, encrypted, iv, chunks, deletedAt, sha256) VALUES (@id, @folderId, @name, @mimeType, @size, @createdAt, @encrypted, @iv, @chunks, @deletedAt, @sha256)"
  ),
  deleteFilePermanent: sqlite.prepare("DELETE FROM files WHERE id = ?"),

  // Modules
  getModule: sqlite.prepare("SELECT * FROM modules WHERE id = ?"),
  getModuleByChatId: sqlite.prepare("SELECT * FROM modules WHERE chatId = ?"),
  getUserModules: sqlite.prepare("SELECT * FROM modules WHERE id LIKE ? ORDER BY createdAt ASC"),
  getAllModules: sqlite.prepare("SELECT * FROM modules"),
  createModule: sqlite.prepare(
    "INSERT INTO modules (id, chatId, accessHash, fileCount, createdAt) VALUES (@id, @chatId, @accessHash, @fileCount, @createdAt)"
  ),
  updateModuleCount: sqlite.prepare("UPDATE modules SET fileCount = fileCount + 1 WHERE id = ?"),
  setModuleCount: sqlite.prepare("UPDATE modules SET fileCount = ? WHERE id = ?"),
  setModuleAccessHash: sqlite.prepare("UPDATE modules SET accessHash = ? WHERE id = ?"),

  // Shares
  getAllShares: sqlite.prepare("SELECT * FROM shares"),
  getShareByToken: sqlite.prepare("SELECT * FROM shares WHERE token = ?"),
  getShareById: sqlite.prepare("SELECT * FROM shares WHERE id = ?"),
  getSharesByUser: sqlite.prepare("SELECT * FROM shares WHERE userId = ? ORDER BY createdAt DESC"),
  getShareByTarget: sqlite.prepare("SELECT * FROM shares WHERE targetId = ? AND userId = ?"),
  createShare: sqlite.prepare(
    "INSERT INTO shares (id, token, userId, targetType, targetId, passwordHash, salt, expiresAt, createdAt, downloadsCount, folderKey, shareMode) VALUES (@id, @token, @userId, @targetType, @targetId, @passwordHash, @salt, @expiresAt, @createdAt, @downloadsCount, @folderKey, @shareMode)"
  ),
  deleteShare: sqlite.prepare("DELETE FROM shares WHERE id = ? AND userId = ?"),
  deleteSharesByTarget: sqlite.prepare("DELETE FROM shares WHERE targetId = ?"),
  incrementShareDownloads: sqlite.prepare("UPDATE shares SET downloadsCount = downloadsCount + 1 WHERE id = ?"),

  // Trash
  getDeletedFiles: sqlite.prepare(
    "SELECT f.*, p.name as originalFolderName FROM files f LEFT JOIN folders p ON f.folderId = p.id WHERE f.deletedAt IS NOT NULL ORDER BY f.deletedAt DESC"
  ),
  getDeletedFolders: sqlite.prepare(
    "SELECT f.*, p.name as originalFolderName FROM folders f LEFT JOIN folders p ON f.parentId = p.id WHERE f.deletedAt IS NOT NULL ORDER BY f.deletedAt DESC"
  ),

  // Search
  searchFiles: sqlite.prepare(
    "SELECT id, folderId, name, mimeType, size, createdAt, encrypted FROM files WHERE deletedAt IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY createdAt DESC LIMIT 200"
  ),
  searchFolders: sqlite.prepare(
    "SELECT id, parentId, name, createdAt, locked FROM folders WHERE deletedAt IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY createdAt DESC LIMIT 100"
  ),
};

export const sqliteDb = {
  // Users
  getUser(id: string): UserRecord | undefined {
    const row = stmts.getUser.get(id);
    return row ? (row as UserRecord) : undefined;
  },
  getAllUsers(): UserRecord[] {
    return stmts.getAllUsers.all() as UserRecord[];
  },
  saveUser(user: UserRecord): void {
    stmts.saveUser.run({
      id: user.id,
      phone: user.phone,
      sessionString: user.sessionString,
      createdAt: user.createdAt,
    });
  },

  // Folders
  getFolder(id: string): FolderRecord | undefined {
    const row = stmts.getFolder.get(id);
    return row ? mapFolder(row) : undefined;
  },
  getSubfolders(parentId: string | null): FolderRecord[] {
    const rows = stmts.getSubfolders.all(parentId) as any[];
    return rows.map(mapFolder);
  },
  countSubfolders(parentId: string | null): number {
    const row = stmts.countSubfolders.get(parentId) as any;
    return row ? Number(row.count) : 0;
  },
  getAllFolders(): FolderRecord[] {
    const rows = stmts.getAllFolders.all() as any[];
    return rows.map(mapFolder);
  },
  getAllFoldersRaw(): FolderRecord[] {
    const rows = stmts.getAllFoldersRaw.all() as any[];
    return rows.map(mapFolder);
  },
  createFolder(folder: FolderRecord): void {
    stmts.createFolder.run({
      id: folder.id,
      parentId: folder.parentId,
      name: folder.name,
      createdAt: folder.createdAt,
      locked: folder.locked ? 1 : 0,
      passwordHash: folder.passwordHash || null,
      salt: folder.salt || null,
      deletedAt: folder.deletedAt || null,
      topicId: folder.topicId || null,
    });
  },
  updateFolder(id: string, updates: Partial<FolderRecord>): void {
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    const params: any = { id, ...updates };
    if ("locked" in updates) params.locked = updates.locked ? 1 : 0;
    const stmt = sqlite.prepare(
      `UPDATE folders SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`
    );
    stmt.run(params);
  },
  softDeleteFolder(id: string): void {
    const now = Date.now();
    // Recursively collect all subfolder IDs
    const toDelete = new Set<string>([id]);
    const queue = [id];
    const allFolders = sqliteDb.getAllFolders();
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const f of allFolders) {
        if (f.parentId === curr && !toDelete.has(f.id)) {
          toDelete.add(f.id);
          queue.push(f.id);
        }
      }
    }

    const deleteFolderStmt = sqlite.prepare("UPDATE folders SET deletedAt = ? WHERE id = ?");
    const deleteFileStmt = sqlite.prepare("UPDATE files SET deletedAt = ? WHERE folderId = ?");

    const tx = sqlite.transaction(() => {
      for (const fId of toDelete) {
        deleteFolderStmt.run(now, fId);
        deleteFileStmt.run(now, fId);
      }
    });
    tx();
  },
  restoreFolder(id: string, rootFolderId: string): void {
    const folder = sqliteDb.getFolder(id);
    if (!folder) return;

    let targetParentId = folder.parentId;
    if (targetParentId) {
      const parent = sqliteDb.getFolder(targetParentId);
      if (!parent || parent.deletedAt) {
        targetParentId = rootFolderId;
      }
    } else {
      targetParentId = rootFolderId;
    }

    // Recursively collect all descendant folder IDs that were deleted at the same time
    const toRestore = new Set<string>([id]);
    const queue = [id];
    const allFoldersRaw = sqliteDb.getAllFoldersRaw();
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const f of allFoldersRaw) {
        if (f.parentId === curr && f.deletedAt && !toRestore.has(f.id)) {
          toRestore.add(f.id);
          queue.push(f.id);
        }
      }
    }

    const restoreFolderStmt = sqlite.prepare("UPDATE folders SET deletedAt = NULL WHERE id = ?");
    const restoreFileStmt = sqlite.prepare("UPDATE files SET deletedAt = NULL WHERE folderId = ?");
    const updateParentStmt = sqlite.prepare("UPDATE folders SET parentId = ? WHERE id = ?");

    const tx = sqlite.transaction(() => {
      updateParentStmt.run(targetParentId, id);
      for (const fId of toRestore) {
        restoreFolderStmt.run(fId);
        restoreFileStmt.run(fId);
      }
    });
    tx();
  },
  deleteFolderPermanent(id: string): void {
    const toDelete = new Set<string>([id]);
    const queue = [id];
    const allFoldersRaw = sqliteDb.getAllFoldersRaw();
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const f of allFoldersRaw) {
        if (f.parentId === curr && !toDelete.has(f.id)) {
          toDelete.add(f.id);
          queue.push(f.id);
        }
      }
    }

    const delFolder = sqlite.prepare("DELETE FROM folders WHERE id = ?");
    const delFiles = sqlite.prepare("DELETE FROM files WHERE folderId = ?");

    const tx = sqlite.transaction(() => {
      for (const fId of toDelete) {
        delFiles.run(fId);
        delFolder.run(fId);
        stmts.deleteSharesByTarget.run(fId);
      }
    });
    tx();
  },

  // Files
  getFile(id: string): FileRecord | undefined {
    const row = stmts.getFile.get(id);
    return row ? mapFile(row) : undefined;
  },
  getFilesInFolder(folderId: string): FileRecord[] {
    const rows = stmts.getFilesInFolder.all(folderId) as any[];
    return rows.map(mapFile);
  },
  countFilesInFolder(folderId: string): number {
    const row = stmts.countFilesInFolder.get(folderId) as any;
    return row ? Number(row.count) : 0;
  },
  getAllFilesRaw(): FileRecord[] {
    const rows = stmts.getAllFilesRaw.all() as any[];
    return rows.map(mapFile);
  },
  createFile(file: FileRecord): void {
    stmts.createFile.run({
      id: file.id,
      folderId: file.folderId,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      encrypted: file.encrypted ? 1 : 0,
      iv: file.iv || null,
      chunks: JSON.stringify(file.chunks || []),
      deletedAt: file.deletedAt || null,
      sha256: file.sha256 || null,
    });
  },
  getFileByHash(userId: string, sha256: string, size: number): FileRecord | undefined {
    const stmt = sqlite.prepare(`
      SELECT f.* FROM files f
      WHERE f.sha256 = ? AND f.size = ? AND f.encrypted = 0 AND f.deletedAt IS NULL
      LIMIT 1
    `);
    const row = stmt.get(sha256, size) as any;
    return row ? mapFile(row) : undefined;
  },
  updateFile(id: string, updates: Partial<FileRecord>): void {
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    const params: any = { id, ...updates };
    if ("encrypted" in updates) params.encrypted = updates.encrypted ? 1 : 0;
    if ("chunks" in updates) params.chunks = JSON.stringify(updates.chunks || []);
    const stmt = sqlite.prepare(
      `UPDATE files SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`
    );
    stmt.run(params);
  },
  softDeleteFile(id: string): void {
    sqlite.prepare("UPDATE files SET deletedAt = ? WHERE id = ?").run(Date.now(), id);
  },
  restoreFile(id: string, rootFolderId: string): void {
    const file = sqliteDb.getFile(id);
    if (!file) return;

    let targetFolderId = file.folderId;
    const folder = sqliteDb.getFolder(targetFolderId);
    if (!folder || folder.deletedAt) {
      targetFolderId = rootFolderId;
    }

    sqlite
      .prepare("UPDATE files SET deletedAt = NULL, folderId = ? WHERE id = ?")
      .run(targetFolderId, id);
  },
  deleteFilePermanent(id: string): void {
    stmts.deleteFilePermanent.run(id);
    stmts.deleteSharesByTarget.run(id);
  },

  // Modules
  getModule(id: string): StorageModule | undefined {
    const row = stmts.getModule.get(id);
    return row ? (row as StorageModule) : undefined;
  },
  getModuleByChatId(chatId: string): StorageModule | undefined {
    const row = stmts.getModuleByChatId.get(chatId);
    return row ? (row as StorageModule) : undefined;
  },
  getUserModules(userId: string): StorageModule[] {
    return stmts.getUserModules.all(`u${userId}_%`) as StorageModule[];
  },
  getAllModules(): StorageModule[] {
    return stmts.getAllModules.all() as StorageModule[];
  },
  createModule(mod: StorageModule): void {
    stmts.createModule.run({
      id: mod.id,
      chatId: mod.chatId,
      accessHash: mod.accessHash,
      fileCount: mod.fileCount,
      createdAt: mod.createdAt,
    });
  },
  updateModuleCount(id: string): void {
    stmts.updateModuleCount.run(id);
  },
  setModuleCount(id: string, count: number): void {
    stmts.setModuleCount.run(count, id);
  },
  setModuleAccessHash(id: string, accessHash: string): void {
    stmts.setModuleAccessHash.run(accessHash, id);
  },

  // Shares
  getAllShares(): ShareRecord[] {
    const rows = stmts.getAllShares.all() as any[];
    return rows.map(mapShare);
  },
  createShare(share: ShareRecord): ShareRecord {
    stmts.createShare.run({
      id: share.id,
      token: share.token,
      userId: share.userId,
      targetType: share.targetType,
      targetId: share.targetId,
      passwordHash: share.passwordHash || null,
      salt: share.salt || null,
      expiresAt: share.expiresAt || null,
      createdAt: share.createdAt,
      downloadsCount: share.downloadsCount || 0,
      folderKey: share.folderKey || null,
      shareMode: share.shareMode || "preview_and_zip",
    });
    return share;
  },
  getShareByToken(token: string): ShareRecord | undefined {
    const row = stmts.getShareByToken.get(token) as any;
    return row ? mapShare(row) : undefined;
  },
  getShareById(id: string): ShareRecord | undefined {
    const row = stmts.getShareById.get(id) as any;
    return row ? mapShare(row) : undefined;
  },
  getSharesByUser(userId: string): ShareRecord[] {
    const rows = stmts.getSharesByUser.all(userId) as any[];
    return rows.map(mapShare);
  },
  getShareByTarget(targetId: string, userId: string): ShareRecord | undefined {
    const row = stmts.getShareByTarget.get(targetId, userId) as any;
    return row ? mapShare(row) : undefined;
  },
  deleteShare(id: string, userId: string): void {
    stmts.deleteShare.run(id, userId);
  },
  deleteSharesByTarget(targetId: string): void {
    stmts.deleteSharesByTarget.run(targetId);
  },
  incrementShareDownloads(id: string): void {
    stmts.incrementShareDownloads.run(id);
  },

  // Trash
  getTrash(userId: string): { files: any[]; folders: any[] } {
    const rootId = `root_${userId}`;
    const userFolders = sqliteDb.getAllFoldersRaw();
    const userFolderIds = new Set<string>();
    for (const f of userFolders) {
      let walk: string | null = f.id;
      let reachesUser = false;
      while (walk) {
        if (walk === rootId) {
          reachesUser = true;
          break;
        }
        const p = userFolders.find((x) => x.id === walk);
        walk = p?.parentId ?? null;
      }
      if (reachesUser) userFolderIds.add(f.id);
    }
    userFolderIds.add(rootId);

    const deletedFiles = (stmts.getDeletedFiles.all() as any[])
      .filter((f) => userFolderIds.has(f.folderId))
      .map((row) => ({
        id: row.id,
        name: row.name,
        type: "file" as const,
        size: Number(row.size),
        mimeType: row.mimeType,
        deletedAt: Number(row.deletedAt),
        originalFolderName: row.originalFolderName || "My Files",
        folderId: row.folderId,
      }));

    const allDeletedFolders = (stmts.getDeletedFolders.all() as any[]).filter((f) =>
      userFolderIds.has(f.id)
    );
    const deletedFolderIdSet = new Set(allDeletedFolders.map((f) => f.id));

    const topLevelDeletedFolders = allDeletedFolders
      .filter((f) => !f.parentId || !deletedFolderIdSet.has(f.parentId))
      .map((row) => {
        const childFilesCount = (
          sqlite.prepare("SELECT COUNT(*) as c FROM files WHERE folderId = ?").get(row.id) as any
        ).c;
        const childFoldersCount = (
          sqlite.prepare("SELECT COUNT(*) as c FROM folders WHERE parentId = ?").get(row.id) as any
        ).c;
        return {
          id: row.id,
          name: row.name,
          type: "folder" as const,
          itemCount: childFilesCount + childFoldersCount,
          deletedAt: Number(row.deletedAt),
          originalFolderName: row.originalFolderName || "My Files",
          locked: Boolean(row.locked),
        };
      });

    return {
      files: deletedFiles,
      folders: topLevelDeletedFolders,
    };
  },

  emptyTrash(userId: string): void {
    const trash = sqliteDb.getTrash(userId);
    const tx = sqlite.transaction(() => {
      for (const f of trash.files) {
        sqliteDb.deleteFilePermanent(f.id);
      }
      for (const f of trash.folders) {
        sqliteDb.deleteFolderPermanent(f.id);
      }
    });
    tx();
  },

  searchFilesAndFolders(
    userId: string,
    query: string
  ): {
    files: Array<{
      id: string;
      name: string;
      type: "file";
      size: number;
      mimeType: string;
      createdAt: number;
      encrypted: boolean;
      folderId: string;
      parentFolderName: string;
      path: Array<{ id: string; name: string; locked: boolean }>;
    }>;
    folders: Array<{
      id: string;
      name: string;
      type: "folder";
      locked: boolean;
      createdAt: number;
      itemCount: number;
      parentId: string | null;
      parentFolderName: string;
      path: Array<{ id: string; name: string; locked: boolean }>;
    }>;
    totalMatches: number;
  } {
    const trimmed = query.trim();
    if (!trimmed) {
      return { files: [], folders: [], totalMatches: 0 };
    }

    const rootId = `root_${userId}`;
    const allActiveFolders = sqliteDb.getAllFolders();
    const folderMap = new Map<string, FolderRecord>(allActiveFolders.map((f) => [f.id, f]));

    function getPathForFolder(
      folderId: string
    ): Array<{ id: string; name: string; locked: boolean }> | null {
      const path: Array<{ id: string; name: string; locked: boolean }> = [];
      let currId: string | null = folderId;
      const visited = new Set<string>();

      while (currId) {
        if (visited.has(currId)) return null;
        visited.add(currId);

        if (currId === rootId) {
          path.unshift({ id: rootId, name: "My Files", locked: false });
          return path;
        }

        const f = folderMap.get(currId);
        if (!f) return null;
        path.unshift({ id: f.id, name: f.name, locked: !!f.locked });
        currId = f.parentId;
      }
      return null;
    }

    const escaped = trimmed.replace(/([%_\\])/g, "\\$1");
    const pattern = `%${escaped}%`;

    const rawFiles = stmts.searchFiles.all(pattern) as any[];
    const rawFolders = stmts.searchFolders.all(pattern) as any[];

    const files: any[] = [];
    for (const f of rawFiles) {
      const parentPath = getPathForFolder(f.folderId);
      if (!parentPath) continue; // Not belonging to user or in a deleted folder

      files.push({
        id: f.id,
        name: f.name,
        type: "file" as const,
        size: Number(f.size),
        mimeType: f.mimeType,
        createdAt: Number(f.createdAt),
        encrypted: Boolean(f.encrypted),
        folderId: f.folderId,
        parentFolderName: parentPath[parentPath.length - 1]?.name || "My Files",
        path: parentPath,
      });
    }

    const folders: any[] = [];
    for (const f of rawFolders) {
      if (f.id === rootId) continue;
      const folderPath = getPathForFolder(f.id);
      if (!folderPath) continue; // Not belonging to user or deleted

      const childFilesCount = (
        sqlite.prepare("SELECT COUNT(*) as c FROM files WHERE folderId = ? AND deletedAt IS NULL").get(f.id) as any
      ).c;
      const childFoldersCount = (
        sqlite.prepare("SELECT COUNT(*) as c FROM folders WHERE parentId = ? AND deletedAt IS NULL").get(f.id) as any
      ).c;

      folders.push({
        id: f.id,
        name: f.name,
        type: "folder" as const,
        locked: Boolean(f.locked),
        createdAt: Number(f.createdAt),
        itemCount: childFilesCount + childFoldersCount,
        parentId: f.parentId,
        parentFolderName: folderPath[folderPath.length - 2]?.name || "My Files",
        path: folderPath.slice(0, -1),
      });
    }

    return {
      files,
      folders,
      totalMatches: files.length + folders.length,
    };
  },
};
