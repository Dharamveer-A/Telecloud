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
  startPeriodicDbBackup,
  registerShutdownBackup,
} from "./services/dbBackup";

async function main() {
  // ── Step 1: Restore DB from Telegram if running on Render (no persistent disk) ──
  // This MUST happen before initDb() / any sqlite access (sqlite uses lazy open).
  if (process.env.RENDER === "true" || process.env.DB_BACKUP_ENABLED === "true") {
    try {
      // We need a bootstrap Telegram client using the first logged-in user's session.
      // We read the session directly from the DB file if it already exists locally,
      // or skip restore if this is a completely fresh deploy with no backup yet.
      const DATA_DIR = process.env.DATA_DIR || "./data";
      const dbPath = path.join(DATA_DIR, "db.sqlite");
      const hasLocalDb = fs.existsSync(dbPath);

      if (!hasLocalDb) {
        // No local DB — try to restore from Telegram using env-provided session
        const bootstrapSession = process.env.BOOTSTRAP_TELEGRAM_SESSION;
        if (bootstrapSession) {
          const { TelegramClient } = await import("telegram");
          const { StringSession } = await import("telegram/sessions");
          const { decryptSession } = await import("./utils/crypto");

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
            await bootstrapClient.disconnect();
          } else {
            console.warn("[DB Backup] TELEGRAM_API_ID/HASH not set — skipping restore.");
          }
        } else {
          console.log(
            "[DB Backup] No BOOTSTRAP_TELEGRAM_SESSION set — starting fresh. " +
              "Set this env var in Render to enable DB restore on restart."
          );
        }
      } else {
        console.log("[DB Backup] Local db.sqlite found — skipping restore (using local copy).");
      }
    } catch (err: any) {
      console.warn("[DB Backup] Startup restore error (continuing):", err?.message);
    }
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
            if (process.env.RENDER === "true" || process.env.DB_BACKUP_ENABLED === "true") {
              startPeriodicDbBackup(client);
              registerShutdownBackup(client);
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
  app.use(cors());
  app.use(express.json());

  app.use("/api/auth", authRoutes);
  app.use("/api/folders", folderRoutes);
  app.use("/api/files", fileRoutes);
  app.use("/api/trash", trashRoutes);
  app.use("/api/shares", sharesRouter);
  app.use("/api/public/shares", publicSharesRouter);
  app.use("/api/tunnel", tunnelRoutes);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

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

    if (process.env.AUTO_TUNNEL !== "false") {
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
