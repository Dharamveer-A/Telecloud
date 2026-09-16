import { useTransfers } from "../lib/transfers";

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
  if (transfers.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-30 w-80 max-w-[90vw] space-y-2 max-h-[80vh] overflow-y-auto">
      {transfers.map((t) => {
        const pct = t.total ? Math.min(100, Math.round((t.loaded / t.total) * 100)) : 0;
        return (
          <div key={t.id} className="bg-surface border border-line rounded-lg px-3 py-2.5 shadow-lg group">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs truncate flex-1" title={t.name}>{t.kind === "upload" ? "⬆" : "⬇"} {t.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-dim">
                  {t.status === "done" ? "Done" : t.status === "error" ? "Failed" : t.status === "cancelled" ? "Cancelled" : `${pct}%`}
                </span>
                {t.status === "active" && (
                  <button onClick={() => transferStore.cancel(t.id)} className="text-dim hover:text-danger px-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
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
                  <span>{formatBytes(t.loaded)} / {formatBytes(t.total)}</span>
                  <span>{formatEta(t.etaSeconds)}</span>
                </div>
              </>
            )}
            {t.status === "error" && <p className="text-danger text-[10px] mt-1">{t.error}</p>}
          </div>
        );
      })}
    </div>
  );
}
