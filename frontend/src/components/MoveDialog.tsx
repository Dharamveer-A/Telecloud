import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Crumb { id: string; name: string }
interface SubFolder { id: string; name: string; locked: boolean }

export default function MoveDialog({
  title,
  excludeFolderId,
  onCancel,
  onConfirm,
}: {
  title: string;
  excludeFolderId?: string; // when moving a folder, hide itself so you can't pick it as its own destination
  onCancel: () => void;
  onConfirm: (destFolderId: string) => void;
}) {
  const [path, setPath] = useState<Crumb[]>([]);
  const [subfolders, setSubfolders] = useState<SubFolder[]>([]);
  const [error, setError] = useState("");

  async function open(id: string, name: string, slice: Crumb[]) {
    setError("");
    try {
      const res: any = await api.getFolder(id);
      if (res.locked) { setError("Can't navigate into a locked folder here."); return; }
      setSubfolders(res.subfolders.filter((f: SubFolder) => f.id !== excludeFolderId));
      setPath([...slice, { id, name }]);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    (async () => {
      const res: any = await api.getRoot();
      open(res.rootFolderId, "My Files", []);
    })();
  }, []);

  const current = path[path.length - 1];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-6">
      <div className="bg-surface border border-line rounded w-full max-w-md">
        <div className="px-6 py-4 border-b border-line">
          <h2 className="font-display text-lg text-paper">{title}</h2>
          <div className="flex items-center gap-1 text-xs mt-2 overflow-x-auto">
            {path.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1 whitespace-nowrap">
                {i > 0 && <span className="text-dim">/</span>}
                <button onClick={() => open(c.id, c.name, path.slice(0, i))} className={i === path.length - 1 ? "text-paper" : "text-dim hover:text-paper"}>
                  {c.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto px-3 py-2">
          {error && <p className="text-danger text-sm px-3 py-2">{error}</p>}
          {!error && subfolders.length === 0 && <p className="text-dim text-sm px-3 py-4">No subfolders here.</p>}
          {subfolders.map((f) => (
            <button
              key={f.id}
              onClick={() => open(f.id, f.name, path)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-surface2 text-left text-sm"
            >
              <span>{f.locked ? "🔒" : "📁"}</span>
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-line flex gap-2">
          <button onClick={onCancel} className="flex-1 border border-line rounded px-3 py-2 text-dim">Cancel</button>
          <button
            onClick={() => current && onConfirm(current.id)}
            disabled={!current}
            className="flex-1 bg-teal text-ink rounded px-3 py-2 font-medium disabled:opacity-40"
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}
