import "dotenv/config";
import express from "express";
import cors from "cors";
import { initDb } from "./db/db";
import authRoutes from "./routes/auth";
import folderRoutes from "./routes/folders";
import fileRoutes from "./routes/files";
import trashRoutes from "./routes/trash";
import { sharesRouter, publicSharesRouter } from "./routes/shares";
import tunnelRoutes from "./routes/tunnel";
import { tunnelManager } from "./tunnel";

async function main() {
  await initDb();

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

  const port = parseInt(process.env.PORT || "4000", 10);
  app.listen(port, () => {
    console.log(`TeleCloud backend listening on :${port}`);

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
