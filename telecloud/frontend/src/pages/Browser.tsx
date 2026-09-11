import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken } from "../lib/api";
import PasswordPrompt from "../components/PasswordPrompt";
import PreviewModal from "../components/PreviewModal";

type Crumb = { id: string; name: string; locked: boolean };
type SubFolder = { id: string; name: string; locked: boolean };
type FileItem = { id: string; name: string; size: number; mimeType: string; createdAt: number; encrypted: boolean };

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/")) return "🎞";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("zip") || mime.includes("archive")) return "🗜";
  return "📦";
}

export default function Browser() {
  const nav = useNavigate();
  const [path, setPath] = useState<Crumb[]>([]);
  const [subfolders, setSubfolders] = useState<SubFolder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [pendingLock, setPendingLock] = useState<SubFolder | null>(null);
  const [passwordError, setPasswordError] = useState("");
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showLockSetup, setShowLockSetup] = useState(false);
  const [lockPassword, setLockPassword] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const current = path[path.length - 1];

  async function openFolder(id: string, name: string, locked: boolean, crumbSlice?: Crumb[]) {
    setError("");
    const password = passwords[id];
    try {
      const res: any = await api.getFolder(id, password);
      if (res.locked) {
        // needs a password we don't have cached
        setPendingLock({ id, name, locked: true });
        return;
      }
      setSubfolders(res.subfolders);
      setFiles(res.files);
      setPath(crumbSlice ? [...crumbSlice, { id, name, locked }] : [...path, { id, name, locked }]);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function init() {
    const res: any = await api.getRoot();
    await openFolder(res.rootFolderId, "My Files", false, []);
  }

  useEffect(() => { init(); }, []);

  function goToCrumb(index: number) {
    const target = path[index];
    const slice = path.slice(0, index);
    openFolder(target.id, target.name, target.locked, slice);
  }

  async function handleUnlockSubmit(password: string) {
    if (!pendingLock) return;
    try {
      const check: any = await api.checkFolderPassword(pendingLock.id, password);
      if (!check.ok) { setPasswordError("Wrong password"); return; }
      setPasswords((p) => ({ ...p, [pendingLock.id]: password }));
      setPasswordError("");
      const target = pendingLock;
      setPendingLock(null);
      await openFolder(target.id, target.name, target.locked);
    } catch (e: any) {
      setPasswordError(e.message);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim() || !current) return;
    await api.createFolder(current.id, newFolderName.trim());
    setNewFolderName("");
    setShowNewFolder(false);
    openFolder(current.id, current.name, current.locked, path.slice(0, -1));
  }

  async function setupLock() {
    if (!current || lockPassword.length < 6) return;
    await api.lockFolder(current.id, lockPassword);
    setPasswords((p) => ({ ...p, [current.id]: lockPassword }));
    setLockPassword("");
    setShowLockSetup(false);
    const updated = [...path];
    updated[updated.length - 1] = { ...current, locked: true };
    setPath(updated);
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !current) return;
    const password = passwords[current.id];
    for (const file of Array.from(fileList)) {
      setUploadPct(0);
      try {
        await api.uploadFile(current.id, file, password, setUploadPct);
      } catch (e: any) {
        setError(e.message);
      }
    }
    setUploadPct(null);
    openFolder(current.id, current.name, current.locked, path.slice(0, -1));
  }

  async function deleteFile(id: string) {
    await api.deleteFile(id);
    setFiles((f) => f.filter((x) => x.id !== id));
  }

  function logout() {
    clearToken();
    nav("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line px-6 py-4 flex items-center justify-between">
        <h1 className="font-display text-2xl">TeleCloud</h1>
        <button onClick={logout} className="text-dim text-sm hover:text-paper">Sign out</button>
      </header>

      <div className="px-6 py-3 border-b border-line flex items-center gap-2 text-sm overflow-x-auto">
        {path.map((c, i) => (
          <span key={c.id} className="flex items-center gap-2 whitespace-nowrap">
            {i > 0 && <span className="text-dim">/</span>}
            <button
              onClick={() => goToCrumb(i)}
              className={i === path.length - 1 ? "text-paper" : "text-dim hover:text-paper"}
            >
              {c.locked && <span className="text-brass mr-1">🔒</span>}
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="px-6 py-3 border-b border-line flex flex-wrap items-center gap-3">
        <button onClick={() => fileInput.current?.click()} className="bg-teal text-ink text-sm font-medium rounded px-3 py-1.5">
          Upload
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        <button onClick={() => setShowNewFolder(true)} className="border border-line text-sm rounded px-3 py-1.5 text-dim hover:text-paper">
          New folder
        </button>
        {current && !current.locked && (
          <button onClick={() => setShowLockSetup(true)} className="border border-line text-sm rounded px-3 py-1.5 text-brass hover:bg-surface2">
            Lock this folder
          </button>
        )}
        {uploadPct !== null && <span className="text-dim text-sm">Uploading… {uploadPct}%</span>}
        {error && <span className="text-danger text-sm">{error}</span>}
      </div>

      <main className="flex-1 px-6 py-4">
        {subfolders.length === 0 && files.length === 0 && (
          <p className="text-dim text-sm">Empty. Upload a file or create a folder to get started.</p>
        )}

        {subfolders.length > 0 && (
          <div className="mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {subfolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openFolder(f.id, f.name, f.locked)}
                  className="text-left border border-line rounded px-4 py-3 hover:border-teal bg-surface"
                >
                  <div className="text-2xl mb-2">{f.locked ? "🔒" : "📁"}</div>
                  <div className="text-sm truncate">{f.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {files.length > 0 && (
          <div className="border border-line rounded overflow-hidden">
            {files.map((f) => (
              <div key={f.id} className="flex items-center justify-between px-4 py-3 border-b border-line last:border-0 hover:bg-surface">
                <button onClick={() => setPreview(f)} className="flex items-center gap-3 text-left flex-1 min-w-0">
                  <span>{iconFor(f.mimeType)}</span>
                  <span className="truncate text-sm">{f.name}</span>
                </button>
                <span className="text-dim text-xs w-20 text-right">{formatBytes(f.size)}</span>
                <button onClick={() => deleteFile(f.id)} className="text-dim hover:text-danger text-xs ml-4">Delete</button>
              </div>
            ))}
          </div>
        )}
      </main>

      {pendingLock && (
        <PasswordPrompt
          folderName={pendingLock.name}
          error={passwordError}
          onSubmit={handleUnlockSubmit}
          onCancel={() => { setPendingLock(null); setPasswordError(""); }}
        />
      )}

      {preview && current && (
        <PreviewModal file={preview} password={passwords[current.id]} onClose={() => setPreview(null)} />
      )}

      {showNewFolder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-6">
          <div className="bg-surface border border-line rounded w-full max-w-sm p-6">
            <h2 className="font-display text-lg mb-4">New folder</h2>
            <input
              autoFocus
              className="w-full bg-surface2 border border-line rounded px-3 py-2 text-paper focus:outline-none focus:border-teal"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="Folder name"
            />
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowNewFolder(false)} className="flex-1 border border-line rounded px-3 py-2 text-dim">Cancel</button>
              <button onClick={createFolder} className="flex-1 bg-teal text-ink rounded px-3 py-2 font-medium">Create</button>
            </div>
          </div>
        </div>
      )}

      {showLockSetup && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-6">
          <div className="bg-surface border border-line rounded w-full max-w-sm p-6">
            <h2 className="font-display text-lg mb-1">Lock "{current?.name}"</h2>
            <p className="text-sm text-dim mb-4">Set a password. Files you upload here from now on are encrypted with it — losing the password means the files can't be recovered.</p>
            <input
              autoFocus
              type="password"
              className="w-full bg-surface2 border border-line rounded px-3 py-2 text-paper focus:outline-none focus:border-brass"
              value={lockPassword}
              onChange={(e) => setLockPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowLockSetup(false)} className="flex-1 border border-line rounded px-3 py-2 text-dim">Cancel</button>
              <button onClick={setupLock} disabled={lockPassword.length < 6} className="flex-1 bg-brass text-ink rounded px-3 py-2 font-medium disabled:opacity-40">Lock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
