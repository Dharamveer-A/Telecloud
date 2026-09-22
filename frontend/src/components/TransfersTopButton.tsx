import { useRef, useEffect } from "react";
import { useTransfers, useTransferViewMode, transferStore } from "../lib/transfers";

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

export default function TransfersTopButton() {
  const transfers = useTransfers();
  const viewMode = useTransferViewMode();
  const containerRef = useRef<HTMLDivElement>(null);

  const showDropdown = viewMode === "top";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        if (transferStore.getViewMode() === "top") {
          transferStore.setViewMode("minimized");
        }
      }
    }
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDropdown]);

  if (transfers.length === 0) return null;

  const active = transfers.filter((t) => t.status === "active");
  const queued = transfers.filter((t) => t.status === "queued");
  const paused = transfers.filter((t) => t.status === "paused");
  const done = transfers.filter((t) => t.status === "done");
  const failed = transfers.filter((t) => t.status === "error" || t.status === "cancelled");

  const totalBytes = transfers.reduce((acc, t) => acc + (t.total || 0), 0);
  const loadedBytes = transfers.reduce((acc, t) => acc + (t.loaded || 0), 0);
  const overallPct = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;

  const hasActive = active.length > 0;
  const hasPending = active.length > 0 || queued.length > 0 || paused.length > 0;
  const isAllPaused = hasPending && active.length === 0 && paused.length > 0;

  // SVG Circular progress params
  const size = 32;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (overallPct / 100) * circumference;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {
          if (viewMode === "top") {
            transferStore.setViewMode("minimized");
          } else {
            transferStore.setViewMode("top");
          }
        }}
        title={`Transfers: ${overallPct}% (${active.length} active, ${paused.length} paused, ${done.length} complete)`}
        className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
          showDropdown ? "bg-surface2 ring-2 ring-teal" : "hover:bg-surface2"
        }`}
      >
        {/* SVG Progress Ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox={`0 0 ${size} ${size}`}>
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-line"
          />
          {/* Progress fill */}
          {hasPending && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className={`transition-all duration-300 ${
                isAllPaused ? "text-amber-400" : "text-teal"
              }`}
            />
          )}
          {!hasPending && done.length > 0 && failed.length === 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={0}
              className="text-teal"
            />
          )}
        </svg>

        {/* Center Icon */}
        <div className="relative z-10 flex items-center justify-center text-xs">
          {isAllPaused ? (
            <span className="text-amber-400 text-[10px] font-bold">⏸</span>
          ) : hasActive ? (
            <span className="text-teal text-[11px] animate-pulse font-bold">↑</span>
          ) : failed.length > 0 ? (
            <span className="text-danger text-[10px] font-bold">✕</span>
          ) : (
            <span className="text-teal text-[10px] font-bold">✓</span>
          )}
        </div>

        {/* Badge counter if pending */}
        {hasPending && (
          <span className="absolute -bottom-1 -right-1 bg-teal text-ink text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow">
            {active.length + queued.length + paused.length}
          </span>
        )}
      </button>

      {/* Brave-style Dropdown Popover */}
      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm bg-surface border border-line rounded-lg shadow-2xl z-50 overflow-hidden text-sm animate-in fade-in slide-in-from-top-2">
          {/* Header */}
          <div className="px-4 py-2.5 bg-surface2 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-1.5 truncate mr-2">
              <span className="font-medium text-xs text-paper truncate">
                {hasPending
                  ? `${overallPct}% • ${active.length + queued.length + paused.length} transferring`
                  : `${done.length} item(s) complete`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {hasPending && (
                <button
                  onClick={() => {
                    if (isAllPaused) {
                      transferStore.resumeAll();
                    } else {
                      transferStore.pauseAll();
                    }
                  }}
                  className="text-xs text-dim hover:text-paper px-2 py-0.5 rounded bg-surface hover:bg-surface2 border border-line font-medium transition-colors"
                >
                  {isAllPaused ? "▶ Resume All" : "⏸ Pause All"}
                </button>
              )}
              {hasPending ? (
                <button
                  onClick={() => transferStore.cancelAll()}
                  className="text-xs text-dim hover:text-danger px-2 py-0.5 rounded bg-surface hover:bg-surface2 border border-line font-medium transition-colors"
                >
                  Cancel All
                </button>
              ) : (
                <button
                  onClick={() => transferStore.clearAll()}
                  className="text-xs text-dim hover:text-paper px-2 py-0.5 rounded hover:bg-surface transition-colors"
                >
                  Clear
                </button>
              )}
              {/* Undock to bottom button */}
              <button
                onClick={() => {
                  transferStore.setViewMode("bottom");
                }}
                className="text-dim hover:text-paper text-xs px-1.5 py-0.5 rounded hover:bg-surface transition-colors"
                title="Pop out into bottom panel"
              >
                ⤢
              </button>
            </div>
          </div>

          {/* Transfer Items */}
          <div className="max-h-80 overflow-y-auto divide-y divide-line">
            {transfers.map((t) => {
              const pct = t.total ? Math.min(100, Math.round((t.loaded / t.total) * 100)) : 0;
              return (
                <div key={t.id} className="px-4 py-2.5 hover:bg-surface2/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs truncate flex-1 text-paper font-medium" title={t.name}>
                      {t.kind === "upload" ? "↑" : "↓"} {t.name}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-dim">
                        {t.status === "done"
                          ? "✓ Done"
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

                      {/* Pause / Resume button */}
                      {t.status === "active" && (
                        <button
                          onClick={() => transferStore.pause(t.id)}
                          className="text-dim hover:text-amber-400 w-5 h-5 flex items-center justify-center rounded hover:bg-surface transition-colors text-[10px]"
                          title="Pause"
                        >
                          ⏸
                        </button>
                      )}
                      {t.status === "paused" && (
                        <button
                          onClick={() => transferStore.resume(t.id)}
                          className="text-amber-400 hover:text-teal w-5 h-5 flex items-center justify-center rounded hover:bg-surface transition-colors text-[10px]"
                          title="Resume"
                        >
                          ▶
                        </button>
                      )}
                      {t.status === "queued" && (
                        <button
                          onClick={() => transferStore.pause(t.id)}
                          className="text-dim hover:text-amber-400 w-5 h-5 flex items-center justify-center rounded hover:bg-surface transition-colors text-[10px]"
                          title="Pause"
                        >
                          ⏸
                        </button>
                      )}

                      {/* Cancel button */}
                      {(t.status === "active" || t.status === "queued" || t.status === "paused") && (
                        <button
                          onClick={() => transferStore.cancel(t.id)}
                          className="text-dim hover:text-danger w-5 h-5 flex items-center justify-center rounded hover:bg-surface transition-colors text-xs"
                          title="Cancel"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
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
        </div>
      )}
    </div>
  );
}
