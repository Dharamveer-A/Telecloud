import { useState } from "react";
import { transferStore, useTransfers } from "../lib/transfers";

function formatBytes(n: number) {
  if (n < 1024) return `${n.toFixed(0)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatEta(s: number | null) {
  if (s === null || !isFinite(s)) return "";
  if (s < 60) return `${Math.ceil(s)}s left`;
  const m = Math.floor(s / 60);
  const rem = Math.ceil(s % 60);
  return `${m}m ${rem}s left`;
}

export default function TransfersPanel() {
  const transfers = useTransfers();
  const [collapsed, setCollapsed] = useState(false);

  // If no transfers or docked into top-right toolbar, don't show the bottom floating panel
  if (transfers.length === 0 || transferStore.isDocked()) return null;

  const active = transfers.filter((t) => t.status === "active");
  const queued = transfers.filter((t) => t.status === "queued");
  const paused = transfers.filter((t) => t.status === "paused");
  const done = transfers.filter((t) => t.status === "done");
  const failed = transfers.filter((t) => t.status === "error" || t.status === "cancelled");

  const hasPending = active.length > 0 || queued.length > 0 || paused.length > 0;
  const isAllPaused = hasPending && active.length === 0 && paused.length > 0;

  let headerText = "";
  if (hasPending) {
    const pendingCount = active.length + queued.length + paused.length;
    if (isAllPaused) {
      headerText = `All ${pendingCount} upload${pendingCount > 1 ? "s" : ""} paused`;
    } else {
      headerText = `Uploading ${pendingCount} item${pendingCount > 1 ? "s" : ""}...`;
    }
  } else if (failed.length > 0) {
    headerText = `${failed.length} upload${failed.length > 1 ? "s" : ""} failed / cancelled`;
  } else {
    headerText = `${done.length} upload${done.length > 1 ? "s" : ""} complete`;
  }

  return (
    <div
      className={`fixed bottom-0 right-6 z-40 w-80 sm:w-96 max-w-[90vw] bg-surface border border-line rounded-t-lg shadow-2xl flex flex-col transition-[height] duration-200 ${
        collapsed ? "h-12" : "h-80"
      }`}
    >
      <div
        className="h-12 px-4 py-2.5 bg-surface2 rounded-t-lg flex items-center justify-between cursor-pointer hover:bg-surface border-b border-line shrink-0 select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-sm font-medium truncate mr-2 text-paper" title={headerText}>
          {headerText}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasPending && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isAllPaused) {
                  transferStore.resumeAll();
                } else {
                  transferStore.pauseAll();
                }
              }}
              className="text-xs text-dim hover:text-paper px-2 py-1 rounded bg-surface hover:bg-surface2 transition-colors border border-line whitespace-nowrap font-medium"
              title={isAllPaused ? "Resume all transfers" : "Pause all transfers"}
            >
              {isAllPaused ? "▶ Resume All" : "⏸ Pause All"}
            </button>
          )}

          {hasPending ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                transferStore.cancelAll();
              }}
              className="text-xs text-dim hover:text-danger px-2 py-1 rounded bg-surface hover:bg-surface2 transition-colors border border-line whitespace-nowrap font-medium"
            >
              Cancel All
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                transferStore.clearAll();
              }}
              className="text-xs text-dim hover:text-paper px-2 py-1 rounded hover:bg-surface transition-colors"
            >
              Clear
            </button>
          )}

          {/* Minimize button: docks to top-right corner */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              transferStore.setDocked(true);
            }}
            className="text-dim hover:text-paper text-sm px-1.5 py-0.5 rounded hover:bg-surface2 transition-colors flex items-center justify-center font-bold"
            title="Minimize to top right toolbar (Brave-style)"
          >
            —
          </button>

          {/* Collapse/expand bottom bar */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
            className="text-dim hover:text-paper text-lg px-1 flex items-center justify-center"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▴" : "▾"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto divide-y divide-line">
          {transfers.map((t) => {
            const pct = t.total ? Math.min(100, Math.round((t.loaded / t.total) * 100)) : 0;
            return (
              <div key={t.id} className="px-4 py-3 group">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1 text-paper" title={t.name}>
                    {t.kind === "upload" ? "⬆" : "⬇"} {t.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-dim">
                      {t.status === "done"
                        ? "✓"
                        : t.status === "error"
                        ? "Failed"
                        : t.status === "cancelled"
                        ? "Cancelled"
                        : t.status === "paused"
                        ? "Paused"
                        : t.status === "queued"
                        ? "Queued"
                        : `${pct}%`}
                    </span>

                    {/* Individual Pause / Resume */}
                    {t.status === "active" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          transferStore.pause(t.id);
                        }}
                        className="text-dim hover:text-amber-400 w-5 h-5 flex items-center justify-center rounded hover:bg-surface2 transition-colors text-[10px]"
                        title="Pause"
                      >
                        ⏸
                      </button>
                    )}
                    {t.status === "paused" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          transferStore.resume(t.id);
                        }}
                        className="text-amber-400 hover:text-teal w-5 h-5 flex items-center justify-center rounded hover:bg-surface2 transition-colors text-[10px]"
                        title="Resume"
                      >
                        ▶
                      </button>
                    )}
                    {t.status === "queued" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          transferStore.pause(t.id);
                        }}
                        className="text-dim hover:text-amber-400 w-5 h-5 flex items-center justify-center rounded hover:bg-surface2 transition-colors text-[10px]"
                        title="Pause"
                      >
                        ⏸
                      </button>
                    )}

                    {/* Cancel */}
                    {(t.status === "active" || t.status === "queued" || t.status === "paused") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          transferStore.cancel(t.id);
                        }}
                        className="text-dim hover:text-danger w-5 h-5 flex items-center justify-center rounded hover:bg-surface2 transition-colors text-xs"
                        title="Cancel this transfer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {(t.status === "active" || t.status === "paused") && (
                  <>
                    <div className="h-1 bg-surface2 rounded mt-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          t.status === "paused" ? "bg-amber-400" : "bg-teal"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-dim">
                      <span>
                        {t.status === "paused"
                          ? "Paused"
                          : `${formatBytes(t.bytesPerSecond)}/s`}
                      </span>
                      <span>{t.status === "paused" ? "" : formatEta(t.etaSeconds)}</span>
                    </div>
                  </>
                )}
                {t.status === "error" && <p className="text-danger text-[10px] mt-1">{t.error}</p>}
                {t.status === "cancelled" && <p className="text-dim text-[10px] mt-1 italic">Cancelled</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
