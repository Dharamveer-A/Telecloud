import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";

test("Media Worker Offload & Fallback", async (t) => {
  const heicExists = fs.existsSync("/tmp/img_1350.heic");

  await t.test("Worker mock server receives raw bytes and returns converted JPEG", async () => {
    if (!heicExists) return;
    const rawHeic = fs.readFileSync("/tmp/img_1350.heic");

    // Spawn a temporary mock worker HTTP server
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/convert") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          assert.equal(body.length, rawHeic.length);
          // Return a mock JPEG response
          res.writeHead(200, { "Content-Type": "image/jpeg" });
          res.end(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9]));
        });
      } else {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as any;
    const workerUrl = `http://127.0.0.1:${address.port}`;

    try {
      const res = await fetch(`${workerUrl}/api/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: rawHeic,
      });

      assert.equal(res.ok, true);
      assert.equal(res.status, 200);
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      assert.equal(buf[0], 0xff);
      assert.equal(buf[1], 0xd8);
    } finally {
      server.close();
    }
  });

  await t.test("Safe fallback to local converter when worker fails or returns error", async () => {
    if (!heicExists) return;
    const rawHeic = fs.readFileSync("/tmp/img_1350.heic");

    // Worker that returns 500 error
    const brokenServer = http.createServer((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Worker out of memory" }));
    });

    await new Promise<void>((resolve) => brokenServer.listen(0, "127.0.0.1", () => resolve()));
    const address = brokenServer.address() as any;
    const workerUrl = `http://127.0.0.1:${address.port}`;

    let jpegBuf: Buffer | null = null;
    try {
      const workerRes = await fetch(`${workerUrl}/api/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: rawHeic,
      });
      if (workerRes.ok) {
        jpegBuf = Buffer.from(await workerRes.arrayBuffer());
      }
    } catch {
      // Ignored
    }

    // Should have failed on worker
    assert.equal(jpegBuf, null);

    // Fallback locally
    const convert = require("heic-convert");
    jpegBuf = await convert({
      buffer: rawHeic,
      format: "JPEG",
      quality: 0.88,
    });

    assert.ok(Buffer.isBuffer(jpegBuf));
    assert.equal(jpegBuf[0], 0xff);
    assert.equal(jpegBuf[1], 0xd8);
    brokenServer.close();
  });
});
