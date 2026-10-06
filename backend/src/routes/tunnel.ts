import { Router } from "express";
import { tunnelManager } from "../tunnel";

const router = Router();

const isHostedEnv = () =>
  process.env.RENDER === "true" ||
  process.env.AUTO_TUNNEL === "false" ||
  process.env.NODE_ENV === "production";

// Get tunnel status
router.get("/", (_req, res) => {
  const isHosted = isHostedEnv();
  res.json({
    active: isHosted ? true : tunnelManager.isTunnelActive(),
    url: isHosted ? null : tunnelManager.getTunnelUrl(),
    isHosted,
  });
});

// Start or restart tunnel
router.post("/start", async (_req, res) => {
  const isHosted = isHostedEnv();
  if (isHosted) {
    return res.json({
      active: true,
      url: null,
      isHosted: true,
      message: "Hosted environment is already accessible worldwide via public domain.",
    });
  }
  try {
    const url = await tunnelManager.startTunnel();
    res.json({ active: true, url, isHosted: false });
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
