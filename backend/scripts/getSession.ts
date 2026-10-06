#!/usr/bin/env tsx
/**
 * getSession.ts — Extract your Telegram session string for Render deployment.
 *
 * This script reads the encrypted session from your local db.sqlite and
 * prints the value you need to paste as BOOTSTRAP_TELEGRAM_SESSION in Render.
 *
 * Run: cd backend && npx tsx scripts/getSession.ts
 */

import "dotenv/config";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR || "./data";
const dbPath = path.join(DATA_DIR, "db.sqlite");

if (!fs.existsSync(dbPath)) {
  console.error("❌ db.sqlite not found at:", dbPath);
  console.error("   Make sure you're running this from the backend/ directory.");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const users = db.prepare("SELECT id, phone, sessionString FROM users").all() as any[];

if (users.length === 0) {
  console.error("❌ No users found in database. Please log in first.");
  process.exit(1);
}

console.log("\n✅ Found user(s) in database:\n");
for (const user of users) {
  console.log(`📱 Phone: ${user.phone}`);
  console.log(`🆔 User ID: ${user.id}`);
  console.log(`\n🔑 BOOTSTRAP_TELEGRAM_SESSION value:`);
  console.log(`\n${user.sessionString}\n`);
  console.log("─".repeat(60));
  console.log("📋 Copy the value above and paste it into Render Dashboard:");
  console.log("   Render → Your Service → Environment → BOOTSTRAP_TELEGRAM_SESSION");
  console.log("─".repeat(60));
}

db.close();
