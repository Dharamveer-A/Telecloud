import { Router } from "express";
import { tunnelManager } from "../tunnel";

const router = Router();

// Get tunnel status
router.get("/", (_req, res) => {
  res.json({
    active: tunnelManager.isTunnelActive(),
    url: tunnelManager.getTunnelUrl(),
  });
});

// Start or restart tunnel
router.post("/start", async (_req, res) => {
  try {
    const url = await tunnelManager.startTunnel();
    res.json({ active: true, url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to start tunnel" });
  }
});

// Stop tunnel
router.post("/stop", (_req, res) => {
  tunnelManager.stopTunnel();
  res.json({ active: false, url: null });
});

export default router;
