import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

test("HEIC Preview Conversion", async (t) => {
  await t.test("heic-convert converts iPhone HEIC into high-res JPEG buffer", async () => {
    const convert = require("heic-convert");
    assert.equal(typeof convert, "function");

    if (fs.existsSync("/tmp/img_1350.heic")) {
      const rawBuf = fs.readFileSync("/tmp/img_1350.heic");
      assert.ok(rawBuf.length > 0, "HEIC file should not be empty");

      const jpegBuf = await convert({
        buffer: rawBuf,
        format: "JPEG",
        quality: 0.88,
      });

      assert.ok(Buffer.isBuffer(jpegBuf), "Should return a Buffer");
      assert.ok(jpegBuf.length > 50000, "JPEG should be substantial size");
      // Check JPEG Magic Bytes: 0xFF, 0xD8
      assert.equal(jpegBuf[0], 0xff);
      assert.equal(jpegBuf[1], 0xd8);
      // Check JPEG End of Image Marker: 0xFF, 0xD9
      assert.equal(jpegBuf[jpegBuf.length - 2], 0xff);
      assert.equal(jpegBuf[jpegBuf.length - 1], 0xd9);
    }
  });

  await t.test("HEIC filename and mimeType detection", () => {
    const isHeic = (name: string, mime?: string) =>
      /\.(heic|heif)$/i.test(name) || mime?.includes("heic") || mime?.includes("heif");

    assert.equal(isHeic("IMG_1350.HEIC", "image/heif"), true);
    assert.equal(isHeic("photo.heif", "application/octet-stream"), true);
    assert.equal(isHeic("2026_09_28_14_10_23_IMG_1350.heic", "image/heic"), true);
    assert.equal(isHeic("standard.jpg", "image/jpeg"), false);
    assert.equal(isHeic("movie.mp4", "video/mp4"), false);
  });
});
