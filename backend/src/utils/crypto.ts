import crypto from "crypto";

function masterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY must be set in .env as a 32-byte hex string. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

// --- Generic AES-256-GCM helpers ----------------------------------------

export function encryptBuffer(data: Buffer, key: Buffer): { ciphertext: Buffer; iv: string; tag: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv: iv.toString("hex"), tag };
}

export function decryptBuffer(ciphertext: Buffer, key: Buffer, ivHex: string, tag: Buffer): Buffer {
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// --- Telegram session string (stored at rest) ---------------------------
// We never store the raw GramJS session string on disk; it's encrypted
// with the server's master key so a leaked db.json alone isn't enough
// to hijack the Telegram account.

export function encryptSession(sessionString: string): string {
  const { ciphertext, iv, tag } = encryptBuffer(Buffer.from(sessionString, "utf8"), masterKey());
  return [iv, tag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function decryptSession(stored: string): string {
  const [iv, tagHex, dataHex] = stored.split(":");
  const plain = decryptBuffer(Buffer.from(dataHex, "hex"), masterKey(), iv, Buffer.from(tagHex, "hex"));
  return plain.toString("utf8");
}

// --- Folder passwords -----------------------------------------------------
// scrypt hash for verifying a folder password, PLUS a derived AES key
// (mixing the folder password with the server master key) used to
// encrypt/decrypt file bytes in that folder. Losing db.json alone does
// not expose locked-folder contents; the master key never leaves the
// server env.

export function hashFolderPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyFolderPassword(password: string, hash: string, salt: string): boolean {
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(check, "hex"), Buffer.from(hash, "hex"));
}

// Derives the actual file-encryption key for a locked folder. Requires the
// plaintext password (checked against hashFolderPassword first) plus the
// server master key, so both are needed to decrypt file contents.
export function deriveFolderFileKey(password: string, salt: string): Buffer {
  const mixed = Buffer.concat([masterKey(), Buffer.from(password, "utf8")]);
  return crypto.scryptSync(mixed, salt, 32);
}
