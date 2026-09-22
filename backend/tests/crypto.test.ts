import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

// Ensure environment variable is set for tests
process.env.MASTER_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import {
  hashFolderPassword,
  verifyFolderPassword,
  deriveFolderFileKey,
  encryptBuffer,
  decryptBuffer,
  encryptSession,
  decryptSession,
  encryptWithMasterKey,
  decryptWithMasterKey,
} from "../src/utils/crypto";

describe("Cryptographic Utilities", () => {
  it("should hash and verify folder password correctly", () => {
    const password = "SecretPassword123!";
    const { hash, salt } = hashFolderPassword(password);

    assert.ok(hash, "Hash should be non-empty");
    assert.ok(salt, "Salt should be non-empty");
    assert.equal(typeof hash, "string");
    assert.equal(typeof salt, "string");

    // Correct password
    assert.equal(verifyFolderPassword(password, hash, salt), true, "Correct password must verify");

    // Wrong password
    assert.equal(verifyFolderPassword("WrongPassword", hash, salt), false, "Wrong password must fail");
    assert.equal(verifyFolderPassword("", hash, salt), false, "Empty password must fail");
  });

  it("should derive deterministic folder file keys", () => {
    const password = "FolderPass123";
    const salt = crypto.randomBytes(16).toString("hex");

    const key1 = deriveFolderFileKey(password, salt);
    const key2 = deriveFolderFileKey(password, salt);
    const keyDiff = deriveFolderFileKey("OtherPass", salt);

    assert.equal(key1.length, 32, "Derived key should be 32 bytes (256-bit)");
    assert.deepEqual(key1, key2, "Same password and salt must produce identical key");
    assert.notDeepEqual(key1, keyDiff, "Different password must produce different key");
  });

  it("should encrypt and decrypt buffers with AES-256-GCM", () => {
    const key = crypto.randomBytes(32);
    const plaintext = Buffer.from("Hello TeleCloud, this is a secret payload!");

    const { ciphertext, iv, tag } = encryptBuffer(plaintext, key);
    assert.notDeepEqual(ciphertext, plaintext);
    assert.equal(typeof iv, "string");
    assert.equal(tag.length, 16);

    const decrypted = decryptBuffer(ciphertext, key, iv, tag);
    assert.deepEqual(decrypted, plaintext);
    assert.equal(decrypted.toString("utf8"), "Hello TeleCloud, this is a secret payload!");
  });

  it("should encrypt and decrypt Telegram session strings at rest", () => {
    const sampleSession = "1BVtsOK0Bu7_sample_telegram_session_string_data_here_123456789";

    const encrypted = encryptSession(sampleSession);
    assert.ok(encrypted.includes(":"), "Stored session should have format iv:tag:data");
    assert.notEqual(encrypted, sampleSession);

    const decrypted = decryptSession(encrypted);
    assert.equal(decrypted, sampleSession);
  });

  it("should encrypt and decrypt with master key", () => {
    const data = Buffer.from("arbitrary-folder-key-bytes-1234");
    const enc = encryptWithMasterKey(data);
    const dec = decryptWithMasterKey(enc);

    assert.deepEqual(dec, data);
  });
});
