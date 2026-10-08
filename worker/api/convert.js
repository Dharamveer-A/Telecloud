const convert = require("heic-convert");

module.exports = async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).end();
  }

  // Health check endpoint for easy browser/curl verification
  if (req.method === "GET") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      status: "ok",
      service: "telecloud-media-worker",
      version: "1.0.0",
      memory: "1024MB",
      features: ["heic-to-jpeg"]
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBuf = Buffer.concat(chunks);

    if (!rawBuf || rawBuf.length === 0) {
      return res.status(400).json({ error: "Empty image buffer provided" });
    }

    // Convert HEIC to JPEG with high quality in 1GB RAM container
    const jpegBuf = await convert({
      buffer: rawBuf,
      format: "JPEG",
      quality: 0.88,
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", jpegBuf.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(jpegBuf);
  } catch (err) {
    console.error("[Worker] Conversion failed:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({
      error: "Conversion failed on worker",
      message: err.message || String(err),
    });
  }
};
