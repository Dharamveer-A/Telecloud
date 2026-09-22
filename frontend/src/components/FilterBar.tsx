import { useState } from "react";
import { ActiveFilter, BuiltinFilterKey, CustomFilter } from "../lib/filters";

const BUILTINS: { key: BuiltinFilterKey; label: string }[] = [
  { key: "images", label: "Images" },
  { key: "videos", label: "Videos" },
  { key: "audio", label: "Audio" },
  { key: "documents", label: "Documents" },
];

export default function FilterBar({
  active,
  onChange,
  customFilters,
  onAddCustom,
  onRemoveCustom,
}: {
  active: ActiveFilter;
  onChange: (f: ActiveFilter) => void;
  customFilters: CustomFilter[];
  onAddCustom: (f: CustomFilter) => void;
  onRemoveCustom: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [nameContains, setNameContains] = useState("");
  const [extensions, setExtensions] = useState("");
  const [minSizeMB, setMinSizeMB] = useState("");
  const [maxSizeMB, setMaxSizeMB] = useState("");

  function reset() {
    setLabel(""); setNameContains(""); setExtensions(""); setMinSizeMB(""); setMaxSizeMB("");
    setShowForm(false);
  }

  function submit() {
    if (!label.trim()) return;
    onAddCustom({
      id: crypto.randomUUID(),
      label: label.trim(),
      nameContains: nameContains.trim() || undefined,
      extensions: extensions.trim() ? extensions.split(",").map((e) => e.trim().replace(/^\./, "").toLowerCase()).filter(Boolean) : undefined,
      minSizeMB: minSizeMB ? parseFloat(minSizeMB) : undefined,
      maxSizeMB: maxSizeMB ? parseFloat(maxSizeMB) : undefined,
    });
    reset();
  }

  const chipClass = (isActive: boolean) =>
    `px-2.5 py-1 rounded-full text-xs border whitespace-nowrap shrink-0 transition-colors ${isActive ? "bg-teal text-ink border-teal font-medium" : "border-line text-dim hover:text-paper"}`;

  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-4 sm:px-6 py-2 border-b border-line flex-nowrap">
      <button onClick={() => onChange(null)} className={chipClass(active === null)}>All</button>
      {BUILTINS.map((b) => (
        <button key={b.key} onClick={() => onChange({ type: "builtin", key: b.key })} className={chipClass(active?.type === "builtin" && active.key === b.key)}>
          {b.label}
        </button>
      ))}
      {customFilters.map((f) => (
        <span key={f.id} className={`${chipClass(active?.type === "custom" && active.id === f.id)} flex items-center gap-1.5`}>
          <button onClick={() => onChange({ type: "custom", id: f.id })}>{f.label}</button>
          <button onClick={() => onRemoveCustom(f.id)} className="opacity-60 hover:opacity-100">✕</button>
        </span>
      ))}
      <button onClick={() => setShowForm(true)} className="px-2.5 py-1 rounded-full text-xs border border-dashed border-line text-dim hover:text-paper whitespace-nowrap shrink-0">
        + Custom filter
      </button>

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 sm:p-6" onClick={reset}>
          <div className="bg-surface border border-line rounded-lg w-full max-w-sm p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg mb-4 text-paper">New custom filter</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-dim">Filter name</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Screenshots" className="w-full bg-surface2 border border-line rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-teal" />
              </div>
              <div>
                <label className="text-xs text-dim">Name contains (optional)</label>
                <input value={nameContains} onChange={(e) => setNameContains(e.target.value)} placeholder="e.g. invoice" className="w-full bg-surface2 border border-line rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-teal" />
              </div>
              <div>
                <label className="text-xs text-dim">Extensions (comma-separated, optional)</label>
                <input value={extensions} onChange={(e) => setExtensions(e.target.value)} placeholder="e.g. zip, rar, 7z" className="w-full bg-surface2 border border-line rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-teal" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-dim">Min size (MB)</label>
                  <input value={minSizeMB} onChange={(e) => setMinSizeMB(e.target.value)} type="number" className="w-full bg-surface2 border border-line rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-teal" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-dim">Max size (MB)</label>
                  <input value={maxSizeMB} onChange={(e) => setMaxSizeMB(e.target.value)} type="number" className="w-full bg-surface2 border border-line rounded px-3 py-1.5 text-sm mt-1 focus:outline-none focus:border-teal" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={reset} className="flex-1 border border-line rounded px-3 py-2 text-dim">Cancel</button>
              <button onClick={submit} disabled={!label.trim()} className="flex-1 bg-teal text-ink rounded px-3 py-2 font-medium disabled:opacity-40">Save filter</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
