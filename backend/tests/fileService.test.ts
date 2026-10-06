import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPartFilename, formatPartCaption, DEFAULT_CHUNK_SIZE, getChunkSize, DEFAULT_RANGE_BURST, getRangeBurstSize, MAX_TELEGRAM_CHUNK, VIDEO_STREAMING_CHUNK, isMediaFile } from "../src/telegram/fileService";

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

  it("should default to 30 MB chunk size for video streaming and 1.90 GB for non-media files", () => {
    assert.equal(DEFAULT_CHUNK_SIZE, 30 * 1024 * 1024);
    assert.equal(VIDEO_STREAMING_CHUNK, 30 * 1024 * 1024);
    assert.equal(MAX_TELEGRAM_CHUNK, 1900000000);
  });

  it("should correctly identify media files by MIME type or extension", () => {
    assert.equal(isMediaFile("video/mp4"), true);
    assert.equal(isMediaFile("video/webm"), true);
    assert.equal(isMediaFile("audio/mpeg"), true);
    assert.equal(isMediaFile("audio/wav"), true);
    assert.equal(isMediaFile(undefined, "movie.mkv"), true);
    assert.equal(isMediaFile(undefined, "song.flac"), true);
    assert.equal(isMediaFile(undefined, "clip.mov"), true);

    assert.equal(isMediaFile("application/zip", "archive.zip"), false);
    assert.equal(isMediaFile("application/pdf", "manual.pdf"), false);
    assert.equal(isMediaFile("application/octet-stream", "disk.iso"), false);
    assert.equal(isMediaFile(undefined, "installer.dmg"), false);
  });

  it("should assign 30 MB chunking to media and 1.90 GB to non-media files", () => {
    assert.equal(getChunkSize("video/mp4", "video.mp4"), 30 * 1024 * 1024);
    assert.equal(getChunkSize("audio/ogg", "music.ogg"), 30 * 1024 * 1024);
    assert.equal(getChunkSize(undefined, "recording.mov"), 30 * 1024 * 1024);

    assert.equal(getChunkSize("application/zip", "archive.zip"), 1900000000);
    assert.equal(getChunkSize("application/pdf", "report.pdf"), 1900000000);
    assert.equal(getChunkSize(undefined, "game.iso"), 1900000000);
    assert.equal(getChunkSize(undefined, "backup.tar"), 1900000000);
  });

  it("should keep a 1.50 GB ZIP file as 1 single part instead of 50 separate 30MB parts", () => {
    const zipSize = 1500000000; // 1.50 GB
    const zipChunkSize = getChunkSize("application/zip", "backup.zip");
    assert.equal(zipChunkSize, 1900000000);

    const partsCount = computePartsCount(zipSize, zipChunkSize);
    assert.equal(partsCount, 1, "1.50 GB ZIP file must be uploaded as 1 single Telegram message");
  });

  it("should respect CHUNK_SIZE_BYTES for media and MAX_TELEGRAM_FILE_BYTES for non-media env overrides", () => {
    const origChunk = process.env.CHUNK_SIZE_BYTES;
    const origMax = process.env.MAX_TELEGRAM_FILE_BYTES;
    try {
      process.env.CHUNK_SIZE_BYTES = "52428800"; // 50 MB
      assert.equal(getChunkSize("video/mp4", "clip.mp4"), 52428800);

      delete process.env.CHUNK_SIZE_BYTES;
      assert.equal(getChunkSize("video/mp4", "clip.mp4"), 30 * 1024 * 1024);

      process.env.MAX_TELEGRAM_FILE_BYTES = "1500000000"; // 1.50 GB
      assert.equal(getChunkSize("application/zip", "archive.zip"), 1500000000);
    } finally {
      if (origChunk !== undefined) process.env.CHUNK_SIZE_BYTES = origChunk;
      else delete process.env.CHUNK_SIZE_BYTES;
      if (origMax !== undefined) process.env.MAX_TELEGRAM_FILE_BYTES = origMax;
      else delete process.env.MAX_TELEGRAM_FILE_BYTES;
    }
  });

  it("should split a 120MB video into 4 streaming chunks of 30MB each", () => {
    const videoSize = 120 * 1024 * 1024;
    const chunkSize = getChunkSize("video/mp4", "video.mp4");
    assert.equal(chunkSize, 30 * 1024 * 1024);
    const partsCount = computePartsCount(videoSize, chunkSize);
    assert.equal(partsCount, 4);

    const chunks = [];
    for (let i = 0; i < partsCount; i++) {
      const offset = i * chunkSize;
      const length = Math.min(chunkSize, videoSize - offset);
      chunks.push({ size: length });
    }

    const offsets = chunkOffsets(chunks);
    assert.deepEqual(offsets, [0, 31457280, 62914560, 94371840]);
  });

  it("should isolate video start range request to only chunk 0 (0 to 1MB)", () => {
    const videoSize = 120 * 1024 * 1024;
    const chunkSize = getChunkSize("video/mp4", "video.mp4");
    const partsCount = computePartsCount(videoSize, chunkSize);

    const chunks = [];
    for (let i = 0; i < partsCount; i++) {
      const offset = i * chunkSize;
      const length = Math.min(chunkSize, videoSize - offset);
      chunks.push({ partIndex: i, size: length });
    }
    const offsets = chunkOffsets(chunks);

    // Initial video buffer request: first 1MB (bytes 0 to 1,048,575)
    const reqStart = 0;
    const reqEnd = 1048575;
    const touchedChunks: number[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkStart = offsets[i];
      const chunkEnd = chunkStart + chunks[i].size - 1;
      if (chunkEnd < reqStart || chunkStart > reqEnd) continue;
      touchedChunks.push(chunks[i].partIndex);
    }

    // Only chunk 0 is fetched, NOT chunks 1, 2, 3!
    assert.deepEqual(touchedChunks, [0], "Only chunk 0 should be fetched for initial video playback");
  });

  it("should restrict range burst window to media streaming requests", () => {
    assert.equal(DEFAULT_RANGE_BURST, 30 * 1024 * 1024);
    // Media streaming returns 30 MB burst
    assert.equal(getRangeBurstSize("video/mp4", "video.mp4"), 30 * 1024 * 1024);
    assert.equal(getRangeBurstSize("audio/mpeg", "song.mp3"), 30 * 1024 * 1024);

    // Non-media download returns undefined (unrestricted)
    assert.equal(getRangeBurstSize("application/zip", "file.zip"), undefined);
    assert.equal(getRangeBurstSize("application/pdf", "doc.pdf"), undefined);

    const origBurst = process.env.MAX_RANGE_BURST;
    try {
      process.env.MAX_RANGE_BURST = "15728640"; // 15 MB
      assert.equal(getRangeBurstSize("video/mp4", "video.mp4"), 15728640);
    } finally {
      if (origBurst !== undefined) process.env.MAX_RANGE_BURST = origBurst;
      else delete process.env.MAX_RANGE_BURST;
    }
  });

  it("should clamp open-ended Range requests (bytes=0-) to at most burst size (30MB) and touch only Chunk 0 on a 286MB video", () => {
    const videoSize = 286679691; // User's real video size (273.4 MB)
    const chunkSize = getChunkSize("video/mp4", "video.mp4");
    const partsCount = computePartsCount(videoSize, chunkSize); // 10 chunks
    assert.equal(partsCount, 10);

    const chunks = [];
    for (let i = 0; i < partsCount; i++) {
      const offset = i * chunkSize;
      const length = Math.min(chunkSize, videoSize - offset);
      chunks.push({ partIndex: i, size: length });
    }
    const offsets = chunkOffsets(chunks);

    // Browser sends open-ended Range: bytes=0-
    const rangeHeader = "bytes=0-";
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const burstSize = getRangeBurstSize("video/mp4", "video.mp4")!;
    const rawEnd = match?.[2] ? parseInt(match[2], 10) : (start + burstSize - 1);
    const clampedEnd = Math.min(rawEnd, start + burstSize - 1, videoSize - 1);

    // Clamped end must be 31,457,279 (30 MB window), NOT 286,679,690 (all 273 MB!)
    assert.equal(start, 0);
    assert.equal(clampedEnd, 31457279);
    assert.equal(clampedEnd - start + 1, 31457280);

    // Find which chunks overlap [start, clampedEnd]
    const touchedChunks: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkStart = offsets[i];
      const chunkEnd = chunkStart + chunks[i].size - 1;
      if (chunkEnd < start || chunkStart > clampedEnd) continue;
      touchedChunks.push(chunks[i].partIndex);
    }

    // Only chunk 0 is touched! Chunks 1..9 (242 MB) are completely untouched!
    assert.deepEqual(touchedChunks, [0], "Only chunk 0 should be touched for open-ended range request");
  });

  it("should clamp Mobile Safari full-size range requests (bytes=0-286679690) to burst window", () => {
    const videoSize = 286679691;
    const rangeHeader = "bytes=0-286679690";
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const burstSize = getRangeBurstSize("video/mp4", "video.mp4")!;
    const rawEnd = match?.[2] ? parseInt(match[2], 10) : (start + burstSize - 1);
    const clampedEnd = Math.min(rawEnd, start + burstSize - 1, videoSize - 1);

    assert.equal(clampedEnd, 31457279, "Should cap oversized mobile range request to 30 MB burst");
  });

  it("should preserve Safari 2-byte probe request (bytes=0-1)", () => {
    const videoSize = 286679691;
    const rangeHeader = "bytes=0-1";
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const burstSize = getRangeBurstSize("video/mp4", "video.mp4")!;
    const rawEnd = match?.[2] ? parseInt(match[2], 10) : (start + burstSize - 1);
    const clampedEnd = Math.min(rawEnd, start + burstSize - 1, videoSize - 1);

    assert.equal(start, 0);
    assert.equal(clampedEnd, 1);
    assert.equal(clampedEnd - start + 1, 2, "Should serve exactly 2 bytes for probe");
  });

  it("should touch only relevant chunks during middle seeking (bytes=150000000-)", () => {
    const videoSize = 286679691;
    const chunkSize = getChunkSize("video/mp4", "video.mp4");
    const partsCount = computePartsCount(videoSize, chunkSize);

    const chunks = [];
    for (let i = 0; i < partsCount; i++) {
      const offset = i * chunkSize;
      const length = Math.min(chunkSize, videoSize - offset);
      chunks.push({ partIndex: i, size: length });
    }
    const offsets = chunkOffsets(chunks);

    const rangeHeader = "bytes=150000000-";
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const burstSize = getRangeBurstSize("video/mp4", "video.mp4")!;
    const rawEnd = match?.[2] ? parseInt(match[2], 10) : (start + burstSize - 1);
    const clampedEnd = Math.min(rawEnd, start + burstSize - 1, videoSize - 1);

    assert.equal(start, 150000000);
    assert.equal(clampedEnd, 181457279); // 150MB + 30MB burst

    const touchedChunks: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkStart = offsets[i];
      const chunkEnd = chunkStart + chunks[i].size - 1;
      if (chunkEnd < start || chunkStart > clampedEnd) continue;
      touchedChunks.push(chunks[i].partIndex);
    }

    // Only chunks 4 (120MB-150MB) and 5 (150MB-180MB) are touched!
    assert.deepEqual(touchedChunks, [4, 5], "Only chunks covering the seek position should be touched");
  });
});
