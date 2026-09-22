import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPartFilename, formatPartCaption } from "../src/telegram/fileService";

describe("File Chunking & Calculations", () => {
  const MAX_CHUNK = 1900000000; // 1.90 GB

  function computePartsCount(totalSize: number, maxChunk: number): number {
    return Math.max(1, Math.ceil(totalSize / maxChunk));
  }

  function chunkOffsets(chunks: { size: number }[]): number[] {
    const offsets: number[] = [];
    let acc = 0;
    for (const c of chunks) {
      offsets.push(acc);
      acc += c.size;
    }
    return offsets;
  }

  it("should calculate single part for files under 1.90 GB", () => {
    assert.equal(computePartsCount(0, MAX_CHUNK), 1, "0-byte file should have 1 part");
    assert.equal(computePartsCount(1024, MAX_CHUNK), 1, "1KB file should have 1 part");
    assert.equal(computePartsCount(500 * 1024 * 1024, MAX_CHUNK), 1, "500MB file should have 1 part");
    assert.equal(computePartsCount(1900000000, MAX_CHUNK), 1, "Exactly 1.90 GB file should have 1 part");
  });

  it("should calculate correct parts for files exceeding 1.90 GB", () => {
    // 1.90 GB + 1 byte -> 2 parts
    assert.equal(computePartsCount(1900000001, MAX_CHUNK), 2);

    // 3.80 GB -> 2 parts
    assert.equal(computePartsCount(3800000000, MAX_CHUNK), 2);

    // 7.50 GB (~8,053,063,680 bytes) -> 5 parts
    const sevenPointFiveGB = 7500000000;
    assert.equal(computePartsCount(sevenPointFiveGB, MAX_CHUNK), 4);
  });

  it("should calculate accurate chunk offsets", () => {
    const chunks = [
      { size: 1900000000 },
      { size: 1900000000 },
      { size: 500000000 },
    ];

    const offsets = chunkOffsets(chunks);
    assert.deepEqual(offsets, [0, 1900000000, 3800000000]);
  });

  it("should verify 1.90 GB safety margin below Telegram 2.00 GB ceiling", () => {
    const TELEGRAM_STRICT_LIMIT = 2 * 1024 * 1024 * 1024; // 2,147,483,648 bytes
    const SAFETY_BUFFER = TELEGRAM_STRICT_LIMIT - MAX_CHUNK;

    assert.ok(SAFETY_BUFFER > 200 * 1024 * 1024, "Buffer must exceed 200 MiB for metadata and GCM tags");
    assert.equal(SAFETY_BUFFER, 247483648, "Buffer is ~247 MB below 2 GB limit");
  });

  it("should retain original filename without .part suffix for single-part files", () => {
    assert.equal(formatPartFilename("photo.jpg", 0, 1), "photo.jpg");
    assert.equal(formatPartFilename("document.pdf", 0, 1), "document.pdf");
    assert.equal(formatPartCaption("photo.jpg", 0, 1), "photo.jpg");
  });

  it("should use zero-padded part filenames and captions for multi-part files", () => {
    // 3 parts: minimum 3-digit padding (001, 002, 003)
    assert.equal(formatPartFilename("backup.tar", 0, 3), "backup.tar.part001");
    assert.equal(formatPartFilename("backup.tar", 1, 3), "backup.tar.part002");
    assert.equal(formatPartFilename("backup.tar", 2, 3), "backup.tar.part003");

    assert.equal(formatPartCaption("backup.tar", 0, 3), "backup.tar (part 001/003)");
    assert.equal(formatPartCaption("backup.tar", 1, 3), "backup.tar (part 002/003)");
    assert.equal(formatPartCaption("backup.tar", 2, 3), "backup.tar (part 003/003)");
  });

  it("should prevent lexicographical sorting errors with zero padding across 10+ parts", () => {
    const totalParts = 12;
    const generated: string[] = [];
    for (let i = 0; i < totalParts; i++) {
      generated.push(formatPartFilename("archive.zip", i, totalParts));
    }

    // Unsorted array
    const shuffled = [generated[9], generated[0], generated[11], generated[1], generated[8]];
    shuffled.sort();

    // With zero padding: part001, part002, part009, part010, part012
    // Without zero padding: part1, part10, part12, part2, part9 (lexicographical error)
    assert.deepEqual(shuffled, [
      "archive.zip.part001",
      "archive.zip.part002",
      "archive.zip.part009",
      "archive.zip.part010",
      "archive.zip.part012",
    ]);
  });
});
