import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import { initDb, db } from "./db/db";
import { getClientForUser } from "./telegram/client";
import authRoutes from "./routes/auth";
import folderRoutes from "./routes/folders";
import fileRoutes from "./routes/files";
import trashRoutes from "./routes/trash";
import { sharesRouter, publicSharesRouter } from "./routes/shares";
import tunnelRoutes from "./routes/tunnel";
import { tunnelManager } from "./tunnel";
import {
  restoreDbFromTelegram,
  backupDbToTelegram,
  startPeriodicDbBackup,
  registerShutdownBackup,
  startPeriodicDbSyncCheck,
} from "./services/dbBackup";

// ── Process Resilience ──────────────────────────────────────────────
// GramJS update loop intermittently emits idle socket timeouts when Telegram
// resets background TCP streams. Catch these so Node.js NEVER exits or crashes.
process.on("unhandledRejection", (reason: any) => {
  const msg = reason?.message || String(reason);
  if (/TIMEOUT|connection closed|ECONNRESET|ETIMEDOUT|SOCKET/i.test(msg)) {
    console.warn("[Background] Handled transient socket timeout (process kept alive):", msg);
    return;
  }
  console.error("[Process] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err: any) => {
  const msg = err?.message || String(err);
  if (/TIMEOUT|connection closed|ECONNRESET|ETIMEDOUT|SOCKET/i.test(msg)) {
    console.warn("[Background] Handled transient socket exception (process kept alive):", msg);
    return;
  }
  console.error("[Process] Uncaught Exception:", err);
});

async function main() {
  // ── Step 1: Restore DB from Telegram if bootstrap session is set ──
  // This MUST happen before initDb() / any sqlite access (sqlite uses lazy open).
  const bootstrapSession = process.env.BOOTSTRAP_TELEGRAM_SESSION;
  if (bootstrapSession) {
    try {
      const { TelegramClient } = await import("telegram");
      const { StringSession } = await import("telegram/sessions");
      const { decryptSession, encryptSession } = await import("./utils/crypto");

      const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10);
      const apiHash = process.env.TELEGRAM_API_HASH || "";

      if (apiId && apiHash) {
        let sessionStr = bootstrapSession;
        try {
          sessionStr = decryptSession(bootstrapSession);
        } catch {
          // Already plain session string
        }
        const bootstrapClient = new TelegramClient(
          new StringSession(sessionStr),
          apiId,
          apiHash,
          { connectionRetries: 3 }
        );
        await bootstrapClient.connect();
        await restoreDbFromTelegram(bootstrapClient);
        try {
          const me = await bootstrapClient.getMe();
          if (me) {
            const { registerActiveClient } = await import("./telegram/client");
            registerActiveClient(String(me.id), bootstrapClient);
            console.log(`[Startup] Registered bootstrap client for user ${me.id} — preventing AUTH_KEY_DUPLICATED.`);

            // Ensure user exists in database even if no backup existed yet!
            const existingUser = db.users.get(String(me.id));
            if (!existingUser) {
              db.users.save({
                id: String(me.id),
                phone: (me as any).phone || "",
                sessionString: encryptSession(sessionStr),
                createdAt: Date.now(),
              });
              console.log(`[Startup] Auto-saved user ${me.id} in SQLite from bootstrap session.`);
              backupDbToTelegram(bootstrapClient).catch(() => {});
            }
          } else {
            await bootstrapClient.disconnect().catch(() => {});
          }
        } catch {
          await bootstrapClient.disconnect().catch(() => {});
        }
      } else {
        console.warn("[DB Backup] TELEGRAM_API_ID/HASH not set — skipping restore.");
      }
    } catch (err: any) {
      console.warn("[DB Backup] Startup restore error (continuing):", err?.message);
    }
  } else {
    console.log(
      "[DB Backup] No BOOTSTRAP_TELEGRAM_SESSION set — starting fresh. " +
        "Set this env var in Render to enable DB restore on restart."
    );
  }

  // ── Step 2: Initialize database (lazy sqlite opens here for the first time) ──
  await initDb();

  // ── Step 3: Auto-connect Telegram clients for logged-in users ──
  let firstClient: any = null;
  try {
    const allUsers = db.users.all();
    for (const u of allUsers) {
      getClientForUser(u.id)
        .then((client) => {
          // Use first connected client for periodic DB backup
          if (!firstClient) {
            firstClient = client;
            if (process.env.DB_BACKUP_DISABLED !== "true") {
              startPeriodicDbBackup(client);
              registerShutdownBackup(client);
              startPeriodicDbSyncCheck(client);
            }
          }
        })
        .catch((err) => {
          console.warn(
            `[Startup] Notice: could not auto-connect Telegram client for user ${u.id}:`,
            err?.message
          );
        });
    }
  } catch (err: any) {
    console.warn("[Startup] Failed to auto-connect users:", err?.message);
  }

  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization", "Range", "X-Requested-With"],
      exposedHeaders: [
        "Content-Range",
        "Accept-Ranges",
        "Content-Length",
        "Content-Disposition",
        "Content-Type",
      ],
    })
  );
  app.use(express.json());

  app.use("/api/auth", authRoutes);
  app.use("/api/folders", folderRoutes);
  app.use("/api/files", fileRoutes);
  app.use("/api/trash", trashRoutes);
  app.use("/api/shares", sharesRouter);
  app.use("/api/public/shares", publicSharesRouter);
  app.use("/api/tunnel", tunnelRoutes);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Force-trigger an immediate database backup to Telegram
  app.all("/api/sync/backup", async (_req, res) => {
    try {
      const allUsers = db.users.all();
      if (allUsers.length > 0) {
        const client = await getClientForUser(allUsers[0].id);
        await backupDbToTelegram(client);
        return res.json({ ok: true, backedUp: true });
      }
      return res.status(400).json({ error: "No user found to connect" });
    } catch (err: any) {
      if (/AUTH_KEY_DUPLICATED/i.test(err?.message || "")) {
        return res.status(409).json({
          error: "Telegram session is active in another server/tab (Local vs Render). Please stop other instances and try again."
        });
      }
      return res.status(500).json({ error: err?.message });
    }
  });

  // Force-trigger a restore from Telegram channel at any time
  app.all("/api/sync/restore", async (_req, res) => {
    try {
      const allUsers = db.users.all();
      if (allUsers.length > 0) {
        const client = await getClientForUser(allUsers[0].id);
        const restored = await restoreDbFromTelegram(client);
        return res.json({ ok: true, restored });
      }
      return res.status(400).json({ error: "No user found to connect" });
    } catch (err: any) {
      if (/AUTH_KEY_DUPLICATED/i.test(err?.message || "")) {
        return res.status(409).json({
          error: "Telegram session is active in another server/tab (Local vs Render). Please stop other instances and try again."
        });
      }
      return res.status(500).json({ error: err?.message });
    }
  });

  // Direct push of SQLite database snapshot (e.g. from local server to Render hosting)
  app.post("/api/sync/push-db", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.query.token as string);
    if (!token || token !== process.env.JWT_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const buffer = req.body as Buffer;
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: "Empty database buffer" });
    }

    try {
      const DATA_DIR = process.env.DATA_DIR || "./data";
      const DB_PATH = path.join(DATA_DIR, "db.sqlite");
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

      const { closeSqlite, reloadSqlite, purgeSystemBackups } = await import("./db/sqlite");
      closeSqlite();
      try { fs.unlinkSync(`${DB_PATH}-wal`); } catch {}
      try { fs.unlinkSync(`${DB_PATH}-shm`); } catch {}

      fs.writeFileSync(DB_PATH, buffer);
      reloadSqlite();
      console.log(`[DB Sync] ✅ Database snapshot pushed and applied successfully (${(buffer.length / 1024).toFixed(1)} KB).`);

      // Immediately upload this new database to Telegram so Telegram has this latest 1703-file backup!
      (async () => {
        try {
          const { db } = await import("./db/db");
          const { getClientForUser } = await import("./telegram/client");
          const { backupDbToTelegram } = await import("./services/dbBackup");
          const users = db.users.all();
          if (users.length > 0) {
            const client = await getClientForUser(users[0].id);
            if (client) {
              await backupDbToTelegram(client);
              console.log("[DB Sync] ✅ Uploaded latest pushed database directly to Telegram backup!");
            }
          }
        } catch (err: any) {
          console.warn("[DB Sync] Immediate Telegram backup notice:", err?.message);
        }
      })();

      return res.json({ ok: true, appliedBytes: buffer.length });
    } catch (err: any) {
      console.error("[DB Sync] Push DB error:", err);
      return res.status(500).json({ error: err?.message });
    }
  });

  // Explicitly trigger a Telegram backup of the current database (protected by JWT_SECRET)
  app.post("/api/sync/backup-now", async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.query.token as string);
    if (!token || token !== process.env.JWT_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { db } = await import("./db/db");
      const { getClientForUser } = await import("./telegram/client");
      const { backupDbToTelegram } = await import("./services/dbBackup");
      const users = db.users.all();
      if (users.length === 0) return res.status(400).json({ error: "No user found" });
      const client = await getClientForUser(users[0].id);
      if (!client) return res.status(500).json({ error: "Could not get Telegram client" });
      await backupDbToTelegram(client);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Export current SQLite database snapshot (protected by JWT_SECRET)
  app.get("/api/sync/export-db", async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (req.query.token as string);
    if (!token || token !== process.env.JWT_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const DATA_DIR = process.env.DATA_DIR || "./data";
    const DB_PATH = path.join(DATA_DIR, "db.sqlite");
    if (!fs.existsSync(DB_PATH)) {
      return res.status(404).json({ error: "db.sqlite not found" });
    }

    res.setHeader("Content-Type", "application/x-sqlite3");
    res.setHeader("Content-Disposition", 'attachment; filename="db.sqlite"');
    fs.createReadStream(DB_PATH).pipe(res);
  });

  // Serve frontend production build if available.
  // Local dev:  backend/../frontend/dist
  // Render:     backend/dist/frontend_dist  (copied by build command in render.yaml)
  const frontendDist =
    fs.existsSync(path.resolve(__dirname, "frontend_dist"))
      ? path.resolve(__dirname, "frontend_dist")
      : path.resolve(__dirname, "../../frontend/dist");

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  const port = parseInt(process.env.PORT || "4000", 10);
  app.listen(port, "0.0.0.0", () => {
    console.log(`TeleCloud backend listening on http://0.0.0.0:${port}`);

    if (process.env.AUTO_TUNNEL !== "false" && process.env.RENDER !== "true") {
      tunnelManager.startTunnel().catch((err) => {
        console.warn("[TeleCloud Tunnel] Auto-start warning:", err.message);
      });
    }
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
