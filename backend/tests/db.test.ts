import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Use an isolated temporary database directory
const TEST_DATA_DIR = path.join(__dirname, "../data_test_" + Date.now());
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.MASTER_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Database Operations & Schema", async () => {
  // Dynamically import db and sqlite so process.env.DATA_DIR takes effect
  const { db } = await import("../src/db/db");
  const { sqlite } = await import("../src/db/sqlite");

  test.after(() => {
    try {
      sqlite.close();
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {}
  });

  it("should create and retrieve users", () => {
    const user = {
      id: "user_test_1",
      phone: "+1234567890",
      sessionString: "encrypted_session_data",
      createdAt: Date.now(),
    };

    db.users.save(user);
    const retrieved = db.users.get("user_test_1");

    assert.ok(retrieved);
    assert.equal(retrieved.id, "user_test_1");
    assert.equal(retrieved.phone, "+1234567890");
    assert.equal(retrieved.sessionString, "encrypted_session_data");
  });

  it("should manage folder hierarchies and subfolders", () => {
    const rootFolder = {
      id: "root_user_test_1",
      parentId: null,
      name: "My Files",
      createdAt: Date.now(),
      locked: false,
    };
    db.folders.create(rootFolder);

    const sub1 = {
      id: "sub_1",
      parentId: "root_user_test_1",
      name: "Documents",
      createdAt: Date.now(),
      locked: false,
      topicId: 42,
    };
    db.folders.create(sub1);

    const sub2 = {
      id: "sub_2",
      parentId: "root_user_test_1",
      name: "Photos",
      createdAt: Date.now(),
      locked: false,
    };
    db.folders.create(sub2);

    const subfolders = db.folders.subfolders("root_user_test_1");
    assert.equal(subfolders.length, 2);

    const count = db.folders.countSubfolders("root_user_test_1");
    assert.equal(count, 2);

    const fetchedSub1 = db.folders.get("sub_1");
    assert.ok(fetchedSub1);
    assert.equal(fetchedSub1.topicId, 42);
  });

  it("should create, query, and count files by folder", () => {
    const file1 = {
      id: "file_1",
      folderId: "sub_1",
      name: "report.pdf",
      size: 1048576,
      mimeType: "application/pdf",
      encrypted: false,
      telegramMessageId: 1001,
      createdAt: Date.now(),
    };

    const file2 = {
      id: "file_2",
      folderId: "sub_1",
      name: "secret.docx",
      size: 2048576,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      encrypted: true,
      iv: "abcdef123456",
      telegramMessageId: 1002,
      createdAt: Date.now(),
    };

    db.files.create(file1);
    db.files.create(file2);

    const filesInSub1 = db.files.byFolder("sub_1");
    assert.equal(filesInSub1.length, 2);

    const count = db.files.countByFolder("sub_1");
    assert.equal(count, 2);

    const retrieved = db.files.get("file_2");
    assert.ok(retrieved);
    assert.equal(retrieved.encrypted, true);
    assert.equal(retrieved.iv, "abcdef123456");
  });

  it("should handle trash soft delete and restore", () => {
    db.files.softDelete("file_1");
    const active = db.files.byFolder("sub_1");
    assert.equal(active.length, 1, "Deleted file must not show in active folder");

    const trash = db.trash.get("user_test_1");
    assert.ok(trash.files.some((f) => f.id === "file_1"), "File should appear in trash");

    db.files.restore("file_1");
    const restored = db.files.byFolder("sub_1");
    assert.equal(restored.length, 2, "Restored file should be back in folder");
  });

  it("should create and manage share links with preview_and_zip and zip_only modes", () => {
    const share1 = {
      id: "share_1",
      token: "tok_preview_123",
      userId: "user_test_1",
      targetType: "folder" as const,
      targetId: "sub_1",
      createdAt: Date.now(),
      shareMode: "preview_and_zip" as const,
    };
    db.shares.create(share1);

    const share2 = {
      id: "share_2",
      token: "tok_zip_456",
      userId: "user_test_1",
      targetType: "folder" as const,
      targetId: "sub_1",
      createdAt: Date.now(),
      shareMode: "zip_only" as const,
    };
    db.shares.create(share2);

    const s1 = db.shares.getByToken("tok_preview_123");
    assert.ok(s1);
    assert.equal(s1.shareMode, "preview_and_zip");

    const s2 = db.shares.getByToken("tok_zip_456");
    assert.ok(s2);
    assert.equal(s2.shareMode, "zip_only");

    // Increment downloads
    db.shares.incrementDownloads(s1.id);
    const updated = db.shares.getByToken("tok_preview_123");
    assert.equal(updated?.downloadsCount, 1);
  });
});
