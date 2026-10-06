#!/usr/bin/env tsx
/**
 * syncDbToTelegram.ts — Upload current local SQLite database to Telegram Saved Messages.
 *
 * Run this anytime you want to push your local database state to Telegram so that
 * your cloud instance (e.g. on Render) will have all your latest files immediately.
 *
 * Run: cd backend && npx tsx scripts/syncDbToTelegram.ts
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import Database from "better-sqlite3";
import { decryptSession } from "../src/utils/crypto";
import { backupDbToTelegram } from "../src/services/dbBackup";

async function main() {
  const DATA_DIR = process.env.DATA_DIR || "./data";
  const dbPath = path.join(DATA_DIR, "db.sqlite");

  if (!fs.existsSync(dbPath)) {
    console.error("❌ db.sqlite not found at:", dbPath);
    process.exit(1);
  }

  // Read the user session directly from local SQLite
  const db = new Database(dbPath, { readonly: true });
  const user = db.prepare("SELECT id, phone, sessionString FROM users LIMIT 1").get() as any;
  const fileCount = (db.prepare("SELECT count(*) as cnt FROM files WHERE deletedAt IS NULL").get() as any).cnt;
  const folderCount = (db.prepare("SELECT count(*) as cnt FROM folders WHERE deletedAt IS NULL").get() as any).cnt;
  db.close();

  if (!user) {
    console.error("❌ No logged in user found in database. Please log in first.");
    process.exit(1);
  }

  console.log(`\n=================================================`);
  console.log(`📦 TeleCloud Database Snapshot Sync`);
  console.log(`=================================================`);
  console.log(`👤 User:    ${user.phone} (${user.id})`);
  console.log(`📁 Folders: ${folderCount}`);
  console.log(`📄 Files:   ${fileCount}`);
  console.log(`💾 Size:    ${(fs.statSync(dbPath).size / 1024).toFixed(1)} KB`);
  console.log(`\nConnecting to Telegram...`);

  const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";

  if (!apiId || !apiHash) {
    console.error("❌ TELEGRAM_API_ID / TELEGRAM_API_HASH not set in .env");
    process.exit(1);
  }

  const sessionStr = decryptSession(user.sessionString);
  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 3,
  });

  await client.connect();
  console.log("✅ Connected to Telegram!");
  console.log("Uploading latest db.sqlite snapshot to Saved Messages...");

  await backupDbToTelegram(client);

  console.log(`\n🎉 Success! Your complete database is now saved in Telegram.`);
  console.log(`   When your Render instance boots or restarts, it will`);
  console.log(`   automatically restore all ${fileCount} files and ${folderCount} folders!\n`);

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
