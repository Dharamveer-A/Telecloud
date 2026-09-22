import test, { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { transferStore } from "../src/lib/transfers";

describe("Frontend Transfer Store", () => {
  beforeEach(() => {
    transferStore.clearAll();
    transferStore.setViewMode("bottom");
  });

  it("should queue a single transfer", () => {
    transferStore.queue("test-1", "file1.txt", "upload", 1000);
    const item = transferStore.get("test-1");
    assert.ok(item);
    assert.equal(item.name, "file1.txt");
    assert.equal(item.kind, "upload");
    assert.equal(item.total, 1000);
    assert.equal(item.status, "queued");
  });

  it("should queue a batch of transfers", () => {
    transferStore.queueBatch([
      { id: "batch-1", name: "doc1.pdf", kind: "upload", total: 500 },
      { id: "batch-2", name: "doc2.pdf", kind: "upload", total: 800 },
    ]);
    const items = transferStore.getSnapshot();
    assert.equal(items.length, 2);
    assert.equal(transferStore.get("batch-1")?.status, "queued");
    assert.equal(transferStore.get("batch-2")?.status, "queued");
  });

  it("should start and update a transfer", () => {
    let aborted = false;
    transferStore.start("t-1", "image.png", "download", 2000, () => {
      aborted = true;
    });

    let item = transferStore.get("t-1");
    assert.ok(item);
    assert.equal(item.status, "active");

    transferStore.update("t-1", {
      loaded: 1000,
      total: 2000,
      bytesPerSecond: 500,
      etaSeconds: 2,
    });

    item = transferStore.get("t-1");
    assert.equal(item?.loaded, 1000);
    assert.equal(item?.bytesPerSecond, 500);
    assert.equal(item?.etaSeconds, 2);

    // Test pause abort trigger
    transferStore.pause("t-1");
    assert.equal(aborted, true);
    assert.equal(transferStore.isPaused("t-1"), true);

    // Test resume
    transferStore.resume("t-1");
    assert.equal(transferStore.get("t-1")?.status, "queued");
  });

  it("should handle pauseAll and resumeAll", () => {
    transferStore.queue("t-1", "f1.dat", "upload", 100);
    transferStore.queue("t-2", "f2.dat", "upload", 200);

    transferStore.pauseAll();
    assert.equal(transferStore.isAllPaused(), true);
    assert.equal(transferStore.get("t-1")?.status, "paused");
    assert.equal(transferStore.get("t-2")?.status, "paused");

    transferStore.resumeAll();
    assert.equal(transferStore.isAllPaused(), false);
    assert.equal(transferStore.get("t-1")?.status, "queued");
    assert.equal(transferStore.get("t-2")?.status, "queued");
  });

  it("should finish and fail transfers", () => {
    transferStore.queue("t-finish", "f1.dat", "download", 100);
    transferStore.finish("t-finish");
    assert.equal(transferStore.get("t-finish")?.status, "done");
    assert.equal(transferStore.get("t-finish")?.loaded, 100);

    transferStore.queue("t-fail", "f2.dat", "download", 100);
    transferStore.fail("t-fail", "Network disconnect");
    assert.equal(transferStore.get("t-fail")?.status, "error");
    assert.equal(transferStore.get("t-fail")?.error, "Network disconnect");
  });

  it("should cancel and remove transfers", () => {
    transferStore.queue("t-cancel", "f.dat", "upload", 100);
    transferStore.cancel("t-cancel");
    assert.equal(transferStore.isCancelled("t-cancel"), true);
    assert.equal(transferStore.get("t-cancel")?.status, "cancelled");

    transferStore.remove("t-cancel");
    assert.equal(transferStore.get("t-cancel"), undefined);
  });

  it("should manage viewMode and docked status", () => {
    assert.equal(transferStore.getViewMode(), "bottom");
    assert.equal(transferStore.isDocked(), false);

    transferStore.setViewMode("minimized");
    assert.equal(transferStore.getViewMode(), "minimized");
    assert.equal(transferStore.isDocked(), true);

    transferStore.setDocked(false);
    assert.equal(transferStore.getViewMode(), "bottom");
    assert.equal(transferStore.isDocked(), false);

    transferStore.toggleDocked();
    assert.equal(transferStore.getViewMode(), "minimized");
    assert.equal(transferStore.isDocked(), true);
  });
});
