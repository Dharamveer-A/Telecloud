import { useState } from "react";
import { transferStore, useTransfers } from "../lib/transfers";

function formatBytes(n: number) {
  if (n < 1024) return `${n.toFixed(0)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
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
  const [minimized, setMinimized] = useState(false);

  if (transfers.length === 0) return null;

  const active = transfers.filter(t => t.status === "active");
  const done = transfers.filter(t => t.status === "done");
  const failed = transfers.filter(t => t.status === "error" || t.status === "cancelled");

  let headerText = "";
  if (active.length > 0) headerText = `Uploading ${active.length} item${active.length > 1 ? "s" : ""}...`;
  else if (failed.length > 0) headerText = `${failed.length} upload${failed.length > 1 ? "s" : ""} failed`;
  else headerText = `${done.length} upload${done.length > 1 ? "s" : ""} complete`;

  return (
    <div className="fixed bottom-0 right-6 z-40 w-80 max-w-[90vw] bg-surface border border-line rounded-t-lg shadow-2xl flex flex-col">
      <div 
        className="px-4 py-3 bg-surface2 rounded-t-lg flex items-center justify-between cursor-pointer hover:bg-surface"
        onClick={() => setMinimized(!minimized)}
      >
        <span className="text-sm font-medium">{headerText}</span>
        <button className="text-dim hover:text-paper text-lg px-2">
          {minimized ? "▴" : "▾"}
        </button>
      </div>

      {!minimized && (
        <div className="max-h-[60vh] overflow-y-auto">
          {transfers.slice().reverse().map((t) => {
            const pct = t.total ? Math.min(100, Math.round((t.loaded / t.total) * 100)) : 0;
            return (
              <div key={t.id} className="px-4 py-3 border-t border-line group">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs truncate flex-1" title={t.name}>{t.kind === "upload" ? "⬆" : "⬇"} {t.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-dim">
                      {t.status === "done" ? "✓" : t.status === "error" ? "Failed" : t.status === "cancelled" ? "Cancelled" : `${pct}%`}
                    </span>
                    {t.status === "active" && (
                      <button onClick={() => transferStore.cancel(t.id)} className="text-dim hover:text-danger w-5 h-5 flex items-center justify-center rounded hover:bg-surface2 transition-colors">✕</button>
                    )}
                  </div>
                </div>
                {t.status === "active" && (
                  <>
                    <div className="h-1 bg-surface2 rounded mt-1.5 overflow-hidden">
                      <div className="h-full bg-teal transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-dim">
                      <span>{formatBytes(t.bytesPerSecond)}/s</span>
                      <span>{formatEta(t.etaSeconds)}</span>
                    </div>
                  </>
                )}
                {t.status === "error" && <p className="text-danger text-[10px] mt-1">{t.error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
