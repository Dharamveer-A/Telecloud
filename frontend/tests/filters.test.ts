import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesBuiltin, matchesCustom, CustomFilter } from "../src/lib/filters";

describe("Frontend Filters", () => {
  describe("matchesBuiltin", () => {
    it("should match image mime types", () => {
      assert.equal(matchesBuiltin("images", { name: "photo.jpg", mimeType: "image/jpeg" }), true);
      assert.equal(matchesBuiltin("images", { name: "graphic.png", mimeType: "image/png" }), true);
      assert.equal(matchesBuiltin("images", { name: "video.mp4", mimeType: "video/mp4" }), false);
    });

    it("should match video mime types", () => {
      assert.equal(matchesBuiltin("videos", { name: "clip.mp4", mimeType: "video/mp4" }), true);
      assert.equal(matchesBuiltin("videos", { name: "movie.mkv", mimeType: "video/x-matroska" }), true);
      assert.equal(matchesBuiltin("videos", { name: "song.mp3", mimeType: "audio/mpeg" }), false);
    });

    it("should match audio mime types", () => {
      assert.equal(matchesBuiltin("audio", { name: "song.mp3", mimeType: "audio/mpeg" }), true);
      assert.equal(matchesBuiltin("audio", { name: "audio.wav", mimeType: "audio/wav" }), true);
      assert.equal(matchesBuiltin("audio", { name: "doc.pdf", mimeType: "application/pdf" }), false);
    });

    it("should match document mime types", () => {
      assert.equal(matchesBuiltin("documents", { name: "doc.pdf", mimeType: "application/pdf" }), true);
      assert.equal(matchesBuiltin("documents", { name: "sheet.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), true);
      assert.equal(matchesBuiltin("documents", { name: "read.txt", mimeType: "text/plain" }), true);
      assert.equal(matchesBuiltin("documents", { name: "photo.jpg", mimeType: "image/jpeg" }), false);
    });
  });

  describe("matchesCustom", () => {
    it("should filter by name substring case-insensitively", () => {
      const filter: CustomFilter = { id: "1", label: "Invoices", nameContains: "invoice" };

      assert.equal(matchesCustom(filter, { name: "Invoice_2026_09.pdf", size: 1024 }), true);
      assert.equal(matchesCustom(filter, { name: "my-INVOICE.docx", size: 1024 }), true);
      assert.equal(matchesCustom(filter, { name: "receipt_september.pdf", size: 1024 }), false);
    });

    it("should filter by allowed extensions", () => {
      const filter: CustomFilter = { id: "2", label: "Archives", extensions: ["zip", "rar", "7z"] };

      assert.equal(matchesCustom(filter, { name: "backup.zip", size: 1024 }), true);
      assert.equal(matchesCustom(filter, { name: "files.RAR", size: 1024 }), true);
      assert.equal(matchesCustom(filter, { name: "archive.7z", size: 1024 }), true);
      assert.equal(matchesCustom(filter, { name: "document.pdf", size: 1024 }), false);
    });

    it("should filter by file size in MB", () => {
      const filter: CustomFilter = {
        id: "3",
        label: "Large Files",
        minSizeMB: 10,
        maxSizeMB: 100,
      };

      const fiveMB = 5 * 1024 * 1024;
      const fiftyMB = 50 * 1024 * 1024;
      const twoHundredMB = 200 * 1024 * 1024;

      assert.equal(matchesCustom(filter, { name: "small.dat", size: fiveMB }), false);
      assert.equal(matchesCustom(filter, { name: "medium.dat", size: fiftyMB }), true);
      assert.equal(matchesCustom(filter, { name: "huge.dat", size: twoHundredMB }), false);
    });
  });
});
