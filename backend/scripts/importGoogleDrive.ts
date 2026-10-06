import "dotenv/config";
import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import * as path from "path";
import * as http from "http";
import * as readline from "readline";
import { v4 as uuid } from "uuid";
import { exec } from "child_process";

import { db, FolderRecord } from "../src/db/db";
import { getClientForUser } from "../src/telegram/client";
import { uploadFile } from "../src/telegram/fileService";

const CREDENTIALS_PATH = path.join(__dirname, "../gdrive_credentials.json");
const TOKEN_PATH = path.join(__dirname, "../gdrive_token.json");
const STATE_PATH = path.join(__dirname, "../.gdrive_migration_state.json");
const TMP_DIR = path.join(__dirname, "../data/tmp/gdrive_import");

interface GDriveCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri?: string;
}

interface GDriveToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

interface GDriveItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes / 1024;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(2)} ${units[idx]}`;
}

async function loadCredentials(): Promise<GDriveCredentials> {
  try {
    const data = await fs.readFile(CREDENTIALS_PATH, "utf8");
    const json = JSON.parse(data);
    const installed = json.installed || json.web || json;
    return {
      client_id: installed.client_id,
      client_secret: installed.client_secret,
      redirect_uri: "http://localhost:8585",
    };
  } catch {
    console.log("\n🔑 Google Drive API Credentials Setup:");
    console.log("No gdrive_credentials.json found. You can enter your credentials directly:\n");
    const client_id = await prompt("Enter Google OAuth Client ID: ");
    const client_secret = await prompt("Enter Google OAuth Client Secret: ");
    const creds: GDriveCredentials = {
      client_id,
      client_secret,
      redirect_uri: "http://localhost:8585",
    };
    await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
    return creds;
  }
}

async function getAccessToken(creds: GDriveCredentials, forceRefresh = false): Promise<string> {
  let tokenData: GDriveToken | null = null;
  try {
    const raw = await fs.readFile(TOKEN_PATH, "utf8");
    tokenData = JSON.parse(raw);
  } catch {}

  // Check if token is still valid (at least 2 minutes remaining)
  if (!forceRefresh && tokenData && tokenData.expires_at > Date.now() + 120000) {
    return tokenData.access_token;
  }

  // Refresh token if available
  if (tokenData?.refresh_token) {
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          refresh_token: tokenData.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const data = (await res.json()) as any;
      if (data.access_token) {
        tokenData.access_token = data.access_token;
        tokenData.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
        return tokenData.access_token;
      }
    } catch (e: any) {
      console.warn("Failed to refresh token, prompting re-authorization:", e?.message);
    }
  }

  // Perform OAuth 2.0 flow via local redirect server
  return new Promise(async (resolve, reject) => {
    const redirectUri = creds.redirect_uri || "http://localhost:8585";
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", creds.client_id);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive.readonly");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    console.log("\n=======================================================");
    console.log("👉 Please open this URL in your browser to sign in:");
    console.log(`\n${authUrl.toString()}\n`);
    console.log("Waiting for authentication callback on http://localhost:8585 ...");
    console.log("=======================================================\n");

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "", "http://localhost:8585");
        const code = reqUrl.searchParams.get("code");
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h2>✅ Google Drive Connected! You can close this tab and return to your terminal.</h2>");
          server.close();

          // Exchange code for tokens
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: creds.client_id,
              client_secret: creds.client_secret,
              code,
              grant_type: "authorization_code",
              redirect_uri: redirectUri,
            }),
          });
          const tokens = (await tokenRes.json()) as any;
          if (!tokens.access_token) {
            throw new Error(`Token exchange failed: ${JSON.stringify(tokens)}`);
          }

          const newToken: GDriveToken = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
          };
          await fs.writeFile(TOKEN_PATH, JSON.stringify(newToken, null, 2));
          console.log("✅ Successfully authenticated with Google Drive!");
          resolve(newToken.access_token);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing code");
        }
      } catch (err: any) {
        reject(err);
      }
    });

    server.listen(8585, () => {
      // Try to automatically open browser on macOS
      try {
        exec(`open "${authUrl.toString()}"`);
      } catch {}
    });
  });
}

// Map Google Docs / Sheets / Slides to standard export format
const EXPORT_MAP: Record<string, { ext: string; exportMime: string }> = {
  "application/vnd.google-apps.document": {
    ext: ".docx",
    exportMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  "application/vnd.google-apps.spreadsheet": {
    ext: ".xlsx",
    exportMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  "application/vnd.google-apps.presentation": {
    ext: ".pptx",
    exportMime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  "application/vnd.google-apps.drawing": {
    ext: ".png",
    exportMime: "image/png",
  },
};

async function fetchAllDriveItems(accessToken: string): Promise<GDriveItem[]> {
  const items: GDriveItem[] = [];
  let pageToken: string | undefined = undefined;

  console.log("🔍 Scanning Google Drive files and folders...");
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("fields", "nextPageToken, files(id, name, mimeType, size, parents, trashed)");
    url.searchParams.set("q", "trashed = false");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive API error (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as any;
    if (data.files) {
      items.push(...data.files);
    }
    pageToken = data.nextPageToken;
    process.stdout.write(`\r   Discovered ${items.length} items so far...`);
  } while (pageToken);

  console.log(`\n✅ Scan complete! Found ${items.length} total items in Google Drive.\n`);
  return items;
}

async function loadMigrationState(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const arr = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

async function saveMigrationState(migratedIds: Set<string>) {
  await fs.writeFile(STATE_PATH, JSON.stringify(Array.from(migratedIds), null, 2));
}

async function main() {
  console.log("=================================================");
  console.log("   🚀 TeleCloud Google Drive Auto-Migrator");
  console.log("=================================================");

  // 1. Select TeleCloud user
  const users = db.users.all();
  if (users.length === 0) {
    console.error("❌ No registered TeleCloud users found in database. Please log into TeleCloud first.");
    process.exit(1);
  }

  let selectedUser = users[0];
  if (users.length > 1) {
    console.log("Select TeleCloud user account to import into:");
    users.forEach((u, idx) => console.log(`  [${idx + 1}] Phone: ${u.phone} (ID: ${u.id})`));
    const choice = await prompt(`Choose user [1-${users.length}]: `);
    const chosenIdx = parseInt(choice, 10) - 1;
    if (users[chosenIdx]) selectedUser = users[chosenIdx];
  }
  console.log(`\n👤 Importing into TeleCloud User: ${selectedUser.phone} (${selectedUser.id})`);

  // 2. Authenticate Telegram Client
  console.log("Connecting to Telegram MTProto storage...");
  const client = await getClientForUser(selectedUser.id);
  console.log("✅ Telegram client connected!");

  // 3. Connect to Google Drive
  const creds = await loadCredentials();
  const accessToken = await getAccessToken(creds);

  // 4. Fetch all Drive items
  const allItems = await fetchAllDriveItems(accessToken);
  const folders = allItems.filter((i) => i.mimeType === "application/vnd.google-apps.folder");
  const files = allItems.filter((i) => i.mimeType !== "application/vnd.google-apps.folder");

  // 5. Select or create root import folder
  const userRootId = `root_${selectedUser.id}`;
  let userRoot = db.folders.get(userRootId);
  if (!userRoot) {
    const newRoot: FolderRecord = {
      id: userRootId,
      parentId: null,
      name: "My Files",
      createdAt: Date.now(),
      locked: false,
    };
    db.folders.create(newRoot);
  }

  const folderNameChoice = await prompt("\nEnter destination folder name in TeleCloud [Press Enter for 'Google Drive']: ");
  const rootFolderName = folderNameChoice || "Google Drive";

  let rootFolder = db.folders.subfolders(userRootId).find((f) => f.name.toLowerCase() === rootFolderName.toLowerCase());
  if (!rootFolder) {
    const newDest: FolderRecord = {
      id: uuid(),
      parentId: userRootId,
      name: rootFolderName,
      createdAt: Date.now(),
      locked: false,
    };
    db.folders.create(newDest);
    rootFolder = newDest;
    console.log(`📁 Created root folder "${rootFolderName}" in TeleCloud`);
  } else {
    console.log(`📁 Using existing root folder "${rootFolderName}" in TeleCloud`);
  }

  // 6. Map Google Drive folder hierarchy to TeleCloud
  const gdriveToTelecloudFolder = new Map<string, string>();
  console.log("📁 Rebuilding folder structure in TeleCloud...");
  const folderById = new Map<string, GDriveItem>();
  folders.forEach((f) => folderById.set(f.id, f));

  function getTelecloudParentId(gdriveFolder: GDriveItem): string {
    const parentGdriveId = gdriveFolder.parents?.[0];
    if (!parentGdriveId || !folderById.has(parentGdriveId)) {
      return rootFolder!.id;
    }
    if (gdriveToTelecloudFolder.has(parentGdriveId)) {
      return gdriveToTelecloudFolder.get(parentGdriveId)!;
    }
    // Parent folder not created yet; create it first
    const parentFolder = folderById.get(parentGdriveId)!;
    const grandparentTelecloudId = getTelecloudParentId(parentFolder);

    // Check if folder exists
    let existing = db.folders.subfolders(grandparentTelecloudId).find((f) => f.name === parentFolder.name);
    if (!existing) {
      const created: FolderRecord = {
        id: uuid(),
        parentId: grandparentTelecloudId,
        name: parentFolder.name,
        createdAt: Date.now(),
        locked: false,
      };
      db.folders.create(created);
      existing = created;
    }
    gdriveToTelecloudFolder.set(parentGdriveId, existing.id);
    return existing.id;
  }

  for (const folder of folders) {
    if (!gdriveToTelecloudFolder.has(folder.id)) {
      const parentId = getTelecloudParentId(folder);
      let existing = db.folders.subfolders(parentId).find((f) => f.name === folder.name);
      if (!existing) {
        const created: FolderRecord = {
          id: uuid(),
          parentId,
          name: folder.name,
          createdAt: Date.now(),
          locked: false,
        };
        db.folders.create(created);
        existing = created;
      }
      gdriveToTelecloudFolder.set(folder.id, existing.id);
    }
  }
  console.log(`✅ Created ${folders.length} folders in TeleCloud!`);

  // 7. Load migration state to resume cleanly
  const migratedState = await loadMigrationState();
  const pendingFiles = files.filter((f) => !migratedState.has(f.id));
  console.log(`\n📊 Migration Plan:`);
  console.log(`   Total files in Google Drive: ${files.length}`);
  console.log(`   Already migrated:           ${files.length - pendingFiles.length}`);
  console.log(`   Remaining to transfer:      ${pendingFiles.length}`);

  if (pendingFiles.length === 0) {
    console.log("\n🎉 All files are already migrated! You're up to date.");
    process.exit(0);
  }

  const proceed = await prompt("\nStart file transfer now? (y/n) [y]: ");
  if (proceed && proceed.toLowerCase() !== "y") {
    console.log("Migration cancelled.");
    process.exit(0);
  }

  await fs.mkdir(TMP_DIR, { recursive: true });

  let successCount = 0;
  let failCount = 0;

  for (let idx = 0; idx < pendingFiles.length; idx++) {
    const file = pendingFiles[idx];
    const isDoc = EXPORT_MAP[file.mimeType];
    const finalName = isDoc ? `${file.name}${isDoc.ext}` : file.name;
    const finalMime = isDoc ? isDoc.exportMime : file.mimeType;
    const targetFolderId =
      file.parents?.[0] && gdriveToTelecloudFolder.has(file.parents[0])
        ? gdriveToTelecloudFolder.get(file.parents[0])!
        : rootFolder!.id;

    console.log(`\n[${idx + 1}/${pendingFiles.length}] Transferring: "${finalName}"...`);

    const tempFilePath = path.join(TMP_DIR, `${file.id}_${Date.now()}`);

    try {
      // Ensure we always have an active, non-expired access token
      let token = await getAccessToken(creds);

      // Download from Google Drive
      let downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
      if (isDoc) {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(
          isDoc.exportMime
        )}`;
      }

      let res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // If token expired right at request time, auto-refresh and retry once
      if (res.status === 401) {
        console.log("   🔄 Google access token expired. Refreshing token and retrying download...");
        token = await getAccessToken(creds, true);
        res = await fetch(downloadUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      if (!res.ok) {
        throw new Error(`Google download failed (${res.status}): ${await res.text()}`);
      }

      if (!res.body) {
        throw new Error("No response body received from Google Drive");
      }

      const nodeStream = Readable.fromWeb(res.body as any);
      const writeStream = createWriteStream(tempFilePath);
      await pipeline(nodeStream, writeStream);

      const fileStat = await fs.stat(tempFilePath);
      console.log(`   Downloaded ${formatBytes(fileStat.size)} from Google Drive. Uploading to Telegram...`);

      // Upload into TeleCloud Telegram storage
      await uploadFile(client, {
        userId: selectedUser.id,
        folderId: targetFolderId,
        filename: finalName,
        mimeType: finalMime,
        filePath: tempFilePath,
        size: fileStat.size,
      });

      migratedState.add(file.id);
      await saveMigrationState(migratedState);
      successCount++;
      console.log(`   ✅ "${finalName}" successfully stored in TeleCloud!`);
    } catch (err: any) {
      failCount++;
      console.error(`   ❌ Failed to transfer "${finalName}":`, err?.message || err);
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }

    // Pacing to avoid Telegram / Google API bursts
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("\n=================================================");
  console.log(`🎉 Migration Finished!`);
  console.log(`   Successfully transferred: ${successCount}`);
  console.log(`   Failed:                   ${failCount}`);
  console.log("=================================================\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal migration error:", err);
  process.exit(1);
});
