import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Use isolated temporary database directory
const TEST_DATA_DIR = path.join(__dirname, "../data_test_dedup_" + Date.now());
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.MASTER_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Content Hash Deduplication", async () => {
  const { db } = await import("../src/db/db");
  const { sqlite } = await import("../src/db/sqlite");

  test.after(() => {
    try {
      sqlite.close();
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {}
  });

  const userId = "user_dedup_1";
  db.users.save({ id: userId, phone: "+1234567899", sessionString: "enc_sess", createdAt: Date.now() });

  const rootFolder = {
    id: `root_${userId}`,
    parentId: null,
    name: "My Files",
    createdAt: Date.now(),
    locked: false,
  };
  db.folders.create(rootFolder);

  const folderA = {
    id: "folder_a",
    parentId: `root_${userId}`,
    name: "Folder A",
    createdAt: Date.now(),
    locked: false,
  };
  db.folders.create(folderA);

  const folderB = {
    id: "folder_b",
    parentId: `root_${userId}`,
    name: "Folder B",
    createdAt: Date.now(),
    locked: false,
  };
  db.folders.create(folderB);

  const lockedFolder = {
    id: "folder_locked",
    parentId: `root_${userId}`,
    name: "Vault",
    createdAt: Date.now(),
    locked: true,
    passwordHash: "dummyHash",
    salt: "dummySalt",
  };
  db.folders.create(lockedFolder);

  // Content 1: 100KB of test data
  const content1 = Buffer.alloc(102400, "A");
  const hash1 = crypto.createHash("sha256").update(content1).digest("hex");

  // Content 2: 100KB of different data
  const content2 = Buffer.alloc(102400, "B");
  const hash2 = crypto.createHash("sha256").update(content2).digest("hex");

  it("should index and find file by sha256 hash and size", () => {
    const originalFile = {
      id: "file_orig_1",
      folderId: "folder_a",
      name: "presentation.pdf",
      size: 102400,
      mimeType: "application/pdf",
      chunks: [
        {
          chatId: "123456",
          accessHash: "7891011",
          messageId: 42,
          partIndex: 0,
          size: 102400,
        },
      ],
      encrypted: false,
      createdAt: Date.now(),
      telegramMessageId: 42,
      sha256: hash1,
    };
    db.files.create(originalFile);

    const match = db.files.byHash(userId, hash1, 102400);
    assert.ok(match, "Should find file by exact sha256 and size");
    assert.equal(match.id, "file_orig_1");
    assert.equal(match.sha256, hash1);
    assert.equal(match.name, "presentation.pdf");
    assert.equal(match.chunks[0].messageId, 42);
  });

  it("should match identical content with a DIFFERENT filename", () => {
    // Looking up hash1 with size 102400 (even though filename is different)
    const match = db.files.byHash(userId, hash1, 102400);
    assert.ok(match);
    assert.equal(match.sha256, hash1);
  });

  it("should NOT match different content even with the same size", () => {
    const match = db.files.byHash(userId, hash2, 102400);
    assert.equal(match, undefined, "Different hash must not match");
  });

  it("should NOT match if file is soft-deleted in trash", () => {
    db.files.softDelete("file_orig_1");
    const match = db.files.byHash(userId, hash1, 102400);
    assert.equal(match, undefined, "Soft-deleted files must not be matched for deduplication");

    // Restore for subsequent tests
    db.files.restore("file_orig_1", `root_${userId}`);
    const restoredMatch = db.files.byHash(userId, hash1, 102400);
    assert.ok(restoredMatch, "Restored file should be matchable again");
  });

  it("should NOT match encrypted files", () => {
    const encFile = {
      id: "file_enc_1",
      folderId: "folder_locked",
      name: "secret.pdf",
      size: 102400,
      mimeType: "application/pdf",
      chunks: [
        {
          chatId: "123456",
          accessHash: "7891011",
          messageId: 99,
          partIndex: 0,
          size: 102400,
        },
      ],
      encrypted: true,
      iv: "1234567890abcdef",
      createdAt: Date.now(),
      telegramMessageId: 99,
      sha256: hash1,
    };
    db.files.create(encFile);

    // byHash query specifies encrypted = 0
    const match = db.files.byHash(userId, hash1, 102400);
    assert.equal(match?.encrypted, false, "Encrypted files must never be returned by deduplication");
  });
});
