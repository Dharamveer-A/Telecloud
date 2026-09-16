import { useEffect, useRef, useState } from "react";

export interface ContextMenuAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export default function ContextMenu({ actions }: { actions: ContextMenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface2 text-dim hover:text-paper"
        aria-label="More options"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[140px] bg-surface2 border border-line rounded shadow-lg z-30 text-sm overflow-hidden py-1">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => { setOpen(false); a.onClick(); }}
              className={`w-full text-left px-3 py-1.5 hover:bg-surface ${a.danger ? "text-danger" : "text-paper"}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
