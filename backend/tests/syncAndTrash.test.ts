import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Isolated temporary test database
const TEST_DATA_DIR = path.join(__dirname, "../data_test_sync_" + Date.now());
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.MASTER_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Telegram Mobile Sync & Trash Channel", async () => {
  const { db } = await import("../src/db/db");
  const { sqlite } = await import("../src/db/sqlite");
  const { indexTelegramMessage } = await import("../src/telegram/client");

  test.after(() => {
    try {
      sqlite.close();
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {}
  });

  it("should index a document uploaded to a forum topic", async () => {
    const userId = "sync_user_1";
    db.users.save({ id: userId, phone: "+1000000000", sessionString: "enc_session", createdAt: Date.now() });
    
    // Create folder with topicId = 99
    db.folders.create({
      id: "folder_topic_99",
      parentId: `root_${userId}`,
      name: "Invoices",
      createdAt: Date.now(),
      locked: false,
      topicId: 99,
    });

    const mockForumMod = {
      id: `u${userId}_forum_12345`,
      chatId: "12345",
      accessHash: "67890",
      fileCount: 0,
      createdAt: Date.now(),
    };

    // Fake Telegram Api.Message
    const mockMessage: any = {
      id: 501,
      date: Math.floor(Date.now() / 1000),
      message: "Quarterly Invoice",
      replyTo: {
        replyToMsgId: 99,
      },
      media: {
        className: "MessageMediaDocument",
        document: {
          className: "Document",
          size: 204800,
          mimeType: "application/pdf",
          attributes: [
            {
              className: "DocumentAttributeFilename",
              fileName: "Q3_Invoice_2026.pdf",
            },
          ],
        },
      },
    };

    // Mock Telegram client
    const mockClient: any = {};

    const record = await indexTelegramMessage(mockClient, userId, mockForumMod, mockMessage);
    assert.ok(record, "Should create a FileRecord");
    assert.equal(record.name, "Q3_Invoice_2026.pdf");
    assert.equal(record.folderId, "folder_topic_99", "File should be placed into folder with topicId 99");
    assert.equal(record.size, 204800);
    assert.equal(record.mimeType, "application/pdf");
    assert.equal(record.telegramMessageId, 501);
    assert.equal(record.chunks[0].messageId, 501);
    assert.equal(record.chunks[0].chatId, "12345");

    // Verify it exists in SQLite
    const inDb = db.files.get(record.id);
    assert.ok(inDb);
    assert.equal(inDb.name, "Q3_Invoice_2026.pdf");

    // Test deduplication: indexing the same message again should return null and not create duplicate
    const dupe = await indexTelegramMessage(mockClient, userId, mockForumMod, mockMessage);
    assert.equal(dupe, null, "Duplicate message must not be indexed again");
  });

  it("should index messages sent without topic into root folder", async () => {
    const userId = "sync_user_2";
    db.users.save({ id: userId, phone: "+1000000001", sessionString: "enc_session", createdAt: Date.now() });

    const mockForumMod = {
      id: `u${userId}_forum_55555`,
      chatId: "55555",
      accessHash: "77777",
      fileCount: 0,
      createdAt: Date.now(),
    };

    const mockMessage: any = {
      id: 602,
      date: Math.floor(Date.now() / 1000),
      message: "Direct Photo",
      media: {
        className: "MessageMediaPhoto",
        photo: {
          className: "Photo",
          sizes: [{ className: "PhotoSize", size: 102400 }],
        },
      },
    };

    const mockClient: any = {};
    const record = await indexTelegramMessage(mockClient, userId, mockForumMod, mockMessage);
    assert.ok(record);
    assert.equal(record.folderId, `root_${userId}`, "Files without topic should go to root folder");
    assert.equal(record.mimeType, "image/jpeg");
    assert.equal(record.name, "Direct Photo.jpg");
  });
});
