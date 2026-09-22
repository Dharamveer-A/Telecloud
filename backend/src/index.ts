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

async function main() {
  await initDb();

  // Auto-connect Telegram clients and activate live sync listeners for logged-in users
  try {
    const allUsers = db.users.all();
    for (const u of allUsers) {
      getClientForUser(u.id).catch((err) => {
        console.warn(`[Startup] Notice: could not auto-connect Telegram client for user ${u.id}:`, err?.message);
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

  // Serve frontend production build if available
  const frontendDist = path.resolve(__dirname, "../../frontend/dist");
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
