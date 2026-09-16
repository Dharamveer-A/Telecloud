import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken, saveBlob } from "../lib/api";
import { itemsToTree, filesWithPathsToTree, DroppedNode, flattenFiles } from "../lib/dragDrop";
import { ActiveFilter, CustomFilter, loadCustomFilters, saveCustomFilters, matchesBuiltin, matchesCustom } from "../lib/filters";
import { transferStore } from "../lib/transfers";
import PasswordPrompt from "../components/PasswordPrompt";
import PreviewModal from "../components/PreviewModal";
import Thumbnail from "../components/Thumbnail";
import ContextMenu from "../components/ContextMenu";
import MoveDialog from "../components/MoveDialog";
import FilterBar from "../components/FilterBar";
import TransfersPanel from "../components/TransfersPanel";

type Crumb = { id: string; name: string; locked: boolean };
type SubFolder = { id: string; name: string; locked: boolean };
type FileItem = { id: string; name: string; size: number; mimeType: string; createdAt: number; encrypted: boolean };
type ViewMode = "grid" | "list";
type MoveTarget = { kind: "file" | "folder"; id: string; name: string } | null;

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

function FolderTreeNode({ node, allFolders, currentPath, onSelect, depth = 0 }: { node: any, allFolders: any[], currentPath: Crumb[], onSelect: (node: any) => void, depth?: number }) {
  const children = allFolders.filter(f => f.parentId === node.id);
  const isOpen = currentPath.some(c => c.id === node.id) || depth === 0; // auto open if in path or root
  const [expanded, setExpanded] = useState(isOpen);
  
  useEffect(() => {
    if (currentPath.some(c => c.id === node.id)) setExpanded(true);
  }, [currentPath, node.id]);

  return (
    <div>
      <div 
        className={`flex items-center group ${currentPath[currentPath.length - 1]?.id === node.id ? "bg-teal/20" : "hover:bg-surface"}`}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <button 
          onClick={() => setExpanded(!expanded)} 
          className={`w-6 h-6 flex items-center justify-center shrink-0 ${children.length === 0 ? "opacity-0" : "text-dim hover:text-paper"}`}
          disabled={children.length === 0}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <button 
          onClick={() => onSelect(node)} 
          className="flex-1 text-left py-1.5 flex items-center gap-2 truncate text-sm"
        >
          <span>{node.locked ? "🔒" : "📁"}</span>
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {expanded && children.length > 0 && (
        <div>
          {children.map(child => (
            <FolderTreeNode key={child.id} node={child} allFolders={allFolders} currentPath={currentPath} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
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
  const [error, setError] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showLockSetup, setShowLockSetup] = useState(false);
  const [lockPassword, setLockPassword] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  async function resolveFolderPath(pathParts: string[], cache: Map<string, string>, targetFolderId: string): Promise<string> {
    let parentId = targetFolderId;
    let acc = "";
    for (const part of pathParts) {
      acc += "/" + part;
      if (cache.has(acc)) {
        parentId = cache.get(acc)!;
        continue;
      }
      const res: any = await api.createFolder(parentId, part);
      cache.set(acc, res.folder.id);
      parentId = res.folder.id;
    }
    return parentId;
  }

  async function enqueueUploads(tree: DroppedNode[], targetFolderId: string, password?: string) {
    const flat = flattenFiles(tree);
    const folderCache = new Map<string, string>();
    for (const f of flat) {
      const transferId = "up-" + Math.random().toString(36).slice(2);
      const controller = new AbortController();
      transferStore.start(transferId, f.editableName, "upload", f.file.size, () => controller.abort());
      try {
        const destFolderId = f.pathParts.length ? await resolveFolderPath(f.pathParts, folderCache, targetFolderId) : targetFolderId;
        await api.uploadFile(
          destFolderId,
          f.file,
          password,
          (p) => transferStore.update(transferId, p),
          f.editableName,
          controller.signal
        );
        transferStore.finish(transferId);
        refreshCurrent();
      } catch (e: any) {
        if (e.message !== "Upload cancelled") {
          transferStore.fail(transferId, e.message);
        }
      }
    }
  }
  const [moveTarget, setMoveTarget] = useState<MoveTarget>(null);
  const [renameTarget, setRenameTarget] = useState<{ kind: "file" | "folder"; id: string; name: string } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null);
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>(() => loadCustomFilters());
  const [allFolders, setAllFolders] = useState<any[]>([]);
  const dragCounter = useRef(0);

  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);

  const current = path[path.length - 1];

  async function fetchTree() {
    try {
      const res: any = await api.getAllFolders();
      setAllFolders(res.folders || []);
    } catch {}
  }

  async function submitRename() {
    if (!renameTarget || !renameInput.trim() || renameInput === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    try {
      if (renameTarget.kind === "file") {
        await api.renameFile(renameTarget.id, renameInput);
      } else {
        await api.renameFolder(renameTarget.id, renameInput);
      }
      setRenameTarget(null);
      refreshCurrent();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function openFolder(id: string, name: string, locked: boolean, crumbSlice?: Crumb[], passwordOverride?: string) {
    setError("");
    const password = passwordOverride !== undefined ? passwordOverride : passwords[id];
    try {
      const res: any = await api.getFolder(id, password);
      if (res.locked) {
        setPendingLock({ id, name, locked: true });
        return;
      }
      setSubfolders(res.subfolders);
      setFiles(res.files);
      const newPath = crumbSlice ? [...crumbSlice, { id, name, locked }] : [...path, { id, name, locked }];
      setPath(newPath);

      const pathIds = new Set(newPath.map(c => c.id));
      setPasswords(prev => {
        const next = { ...prev };
        let changed = false;
        for (const k of Object.keys(next)) {
          if (!pathIds.has(k)) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function refreshCurrent() {
    if (!current) return;
    const res: any = await api.getFolder(current.id, passwords[current.id]);
    if (!res.locked) {
      setSubfolders(res.subfolders);
      setFiles(res.files);
    }
    fetchTree();
  }

  async function init() {
    const res: any = await api.getRoot();
    await openFolder(res.rootFolderId, "My Files", false, []);
    fetchTree();
  }
  useEffect(() => { init(); }, []);

  function goToCrumb(index: number) {
    const target = path[index];
    openFolder(target.id, target.name, target.locked, path.slice(0, index));
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
      await openFolder(target.id, target.name, target.locked, undefined, password);
    } catch (e: any) {
      setPasswordError(e.message);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim() || !current) return;
    await api.createFolder(current.id, newFolderName.trim());
    setNewFolderName("");
    setShowNewFolder(false);
    refreshCurrent();
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

  async function deleteFile(id: string) {
    if (!confirm("Delete this file? This can't be undone.")) return;
    await api.deleteFile(id);
    setFiles((f) => f.filter((x) => x.id !== id));
  }

  async function deleteFolder(id: string) {
    if (!confirm("Delete this folder and everything inside it? This can't be undone.")) return;
    await api.deleteFolder(id);
    setSubfolders((f) => f.filter((x) => x.id !== id));
  }

  async function confirmMove(destFolderId: string) {
    if (!moveTarget) return;
    try {
      if (moveTarget.kind === "file") await api.moveFile(moveTarget.id, destFolderId);
      else await api.moveFolder(moveTarget.id, destFolderId);
      setMoveTarget(null);
      refreshCurrent();
    } catch (e: any) {
      alert(e.message);
    }
  }

  // ---- Downloads (speed-tracked via the shared transfer panel) --------

  async function downloadFileAction(file: FileItem) {
    const password = current ? passwords[current.id] : undefined;
    const transferId = `dl-${file.id}-${Date.now()}`;
    transferStore.start(transferId, file.name, "download", file.size);
    try {
      const blob = await api.downloadWithProgress(
        api.fileUrl(file.id, password),
        (p) => transferStore.update(transferId, p)
      );
      saveBlob(blob, file.name);
      transferStore.finish(transferId);
    } catch (e: any) {
      transferStore.fail(transferId, e.message);
    }
  }

  async function downloadFolderAction(folder: SubFolder) {
    if (folder.locked) {
      alert("Open the folder and unlock it first, then use Download from inside.");
      return;
    }
    const transferId = `dlzip-${folder.id}-${Date.now()}`;
    transferStore.start(transferId, `${folder.name}.zip`, "download", 0);
    try {
      const blob = await api.downloadWithProgress(
        api.folderZipUrl(folder.id),
        (p) => transferStore.update(transferId, p)
      );
      saveBlob(blob, `${folder.name}.zip`);
      transferStore.finish(transferId);
    } catch (e: any) {
      transferStore.fail(transferId, e.message);
    }
  }

  function logout() {
    clearToken();
    nav("/login");
  }

  // ---- Drag & drop -> Upload Wizard --------------------------------

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter.current += 1;
    setDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) { setDragging(false); dragCounter.current = 0; }
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (!current) return;
    const tree = await itemsToTree(e.dataTransfer.items, e.dataTransfer.files);
    if (tree.length) {
      enqueueUploads(tree, current.id, passwords[current.id]);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    if (!current || !e.target.files?.length) return;
    if (e.target.webkitdirectory) {
      enqueueUploads(filesWithPathsToTree(e.target.files), current.id, passwords[current.id]);
    } else {
      const tree = await itemsToTree([], e.target.files);
      enqueueUploads(tree, current.id, passwords[current.id]);
    }
    e.target.value = "";
  }

  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function handleInternalDragStart(e: React.DragEvent, item: { kind: "file" | "folder"; id: string; name: string }) {
    e.dataTransfer.setData("application/telecloud-item", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  }

  async function handleFolderDrop(e: React.DragEvent, f: SubFolder) {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    dragCounter.current = 0;
    setDragging(false);

    const internalData = e.dataTransfer.getData("application/telecloud-item");
    if (internalData) {
      const item = JSON.parse(internalData);
      if (item.id === f.id) return; // ignore drop on self
      try {
        if (item.kind === "file") await api.moveFile(item.id, f.id);
        else await api.moveFolder(item.id, f.id);
        refreshCurrent();
      } catch (err: any) {
        alert(err.message);
      }
    } else if (e.dataTransfer.types.includes("Files")) {
      const tree = await itemsToTree(e.dataTransfer.items, e.dataTransfer.files);
      if (tree.length) {
        // If it's locked, we don't know the password unless it's in state
        if (f.locked && !passwords[f.id]) {
          alert("Unlock this folder first to upload files into it.");
          return;
        }
        enqueueUploads(tree, f.id, passwords[f.id]);
      }
    }
  }

  // ---- Custom filters (persisted to localStorage) ----------------------

  function addCustomFilter(f: CustomFilter) {
    const updated = [...customFilters, f];
    setCustomFilters(updated);
    saveCustomFilters(updated);
  }
  function removeCustomFilter(id: string) {
    const updated = customFilters.filter((f) => f.id !== id);
    setCustomFilters(updated);
    saveCustomFilters(updated);
    if (activeFilter?.type === "custom" && activeFilter.id === id) setActiveFilter(null);
  }

  const searchedFolders = subfolders.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));
  const searchedFiles = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));

  // A type/size/name filter only makes sense against files - folders are
  // always shown (still searched by name) so you can navigate through
  // them to reach filtered files inside.
  const filteredFiles = searchedFiles.filter((f) => {
    if (!activeFilter) return true;
    if (activeFilter.type === "builtin") return matchesBuiltin(activeFilter.key, f);
    const custom = customFilters.find((c) => c.id === activeFilter.id);
    return custom ? matchesCustom(custom, f) : true;
  });
  const filteredFolders = activeFilter ? [] : searchedFolders;

  return (
    <div className="min-h-screen flex relative">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-line px-4 py-5 hidden sm:flex flex-col gap-1">
        <h1 className="font-display text-2xl mb-6 px-2">TeleCloud</h1>

        <div className="relative mb-4">
          <button
            onClick={() => setShowNewMenu((s) => !s)}
            className="w-full bg-teal text-ink font-medium rounded px-3 py-2.5 text-sm flex items-center gap-2 justify-center"
          >
            + New
          </button>
          {showNewMenu && (
            <div className="absolute left-0 top-full mt-1 w-full bg-surface2 border border-line rounded shadow-lg z-20 text-sm overflow-hidden">
              <button onClick={() => { setShowNewMenu(false); filePicker.current?.click(); }} className="w-full text-left px-3 py-2 hover:bg-surface">Upload files</button>
              <button onClick={() => { setShowNewMenu(false); folderPicker.current?.click(); }} className="w-full text-left px-3 py-2 hover:bg-surface">Upload folder</button>
              <button onClick={() => { setShowNewMenu(false); setShowNewFolder(true); }} className="w-full text-left px-3 py-2 hover:bg-surface">New folder</button>
            </div>
          )}
        </div>
        <input ref={filePicker} type="file" multiple hidden onChange={onFilePicked} />
        <input ref={folderPicker} type="file" multiple hidden {...({ webkitdirectory: "true" } as any)} onChange={onFilePicked} />

        <button onClick={() => goToCrumb(0)} className="text-left px-2 py-2 rounded text-sm text-paper hover:bg-surface flex items-center gap-2">
          📁 My Files
        </button>

        {/* Folder Tree */}
        <div className="flex-1 overflow-y-auto mt-4 pr-2">
          {allFolders
            .filter(f => !f.parentId) // root folders (My Files)
            .map(rootNode => (
              <FolderTreeNode 
                key={rootNode.id} 
                node={rootNode} 
                allFolders={allFolders} 
                currentPath={path} 
                onSelect={(n) => {
                  // build path up to n
                  const newPath: Crumb[] = [];
                  let curr = n;
                  while (curr) {
                    newPath.unshift({ id: curr.id, name: curr.name, locked: curr.locked });
                    curr = allFolders.find(f => f.id === curr.parentId);
                  }
                  openFolder(n.id, n.name, n.locked, newPath.slice(0, -1));
                }} 
              />
            ))}
        </div>

        {current && !current.locked && (
          <button onClick={() => setShowLockSetup(true)} className="text-left px-2 py-2 rounded text-sm text-brass hover:bg-surface flex items-center gap-2 mt-2">
            🔒 Lock this folder
          </button>
        )}
        {current && current.locked && (
          <div className="mt-2">
            <button onClick={() => goToCrumb(Math.max(0, path.length - 2))} className="text-left w-full px-2 py-2 rounded text-sm text-brass hover:bg-surface flex items-center gap-2">
              🔒 Lock Session (Exit)
            </button>
            <button onClick={async () => {
              const pass = passwords[current.id];
              if (!pass) return;
              if (!confirm("Are you sure you want to permanently remove the password from this folder?")) return;
              try {
                await api.unlockFolder(current.id, pass);
                const updated = [...path];
                updated[updated.length - 1] = { ...current, locked: false };
                setPath(updated);
                refreshCurrent();
              } catch (e: any) {
                alert(e.message);
              }
            }} className="text-left w-full px-2 py-2 rounded text-sm text-danger hover:bg-surface flex items-center gap-2 mt-1">
              🔓 Remove Password
            </button>
          </div>
        )}
        <button onClick={logout} className="text-left px-2 py-2 rounded text-sm text-dim hover:text-paper">Sign out</button>
      </aside>

      {/* Main */}
      <div 
        className="flex-1 flex flex-col min-w-0 relative"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="px-6 py-3 border-b border-line flex items-center gap-3 flex-wrap">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this folder"
            className="flex-1 min-w-[160px] bg-surface border border-line rounded px-3 py-1.5 text-sm focus:outline-none focus:border-teal"
          />
          <div className="flex border border-line rounded overflow-hidden text-xs">
            <button onClick={() => setView("grid")} className={`px-2 py-1.5 ${view === "grid" ? "bg-surface2 text-paper" : "text-dim"}`}>Grid</button>
            <button onClick={() => setView("list")} className={`px-2 py-1.5 ${view === "list" ? "bg-surface2 text-paper" : "text-dim"}`}>List</button>
          </div>
        </div>

        <FilterBar
          active={activeFilter}
          onChange={setActiveFilter}
          customFilters={customFilters}
          onAddCustom={addCustomFilter}
          onRemoveCustom={removeCustomFilter}
        />

        <div className="px-6 py-3 border-b border-line flex items-center gap-2 text-sm overflow-x-auto">
          {path.map((c, i) => (
            <span key={c.id} className="flex items-center gap-2 whitespace-nowrap">
              {i > 0 && <span className="text-dim">/</span>}
              <button 
                onClick={() => goToCrumb(i)} 
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(c.id); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(null); }}
                onDrop={(e) => handleFolderDrop(e, c as SubFolder)}
                className={`${i === path.length - 1 ? "text-paper" : "text-dim hover:text-paper"} ${dropTargetId === c.id ? "bg-teal/20 px-1 rounded" : ""}`}
              >
                {c.locked && <span className="text-brass mr-1">🔒</span>}
                {c.name}
              </button>
            </span>
          ))}
          {error && <span className="text-danger text-sm ml-4">{error}</span>}
        </div>

        <main className="flex-1 px-6 py-5 overflow-y-auto">
          {filteredFolders.length === 0 && filteredFiles.length === 0 && (
            <div className="text-dim text-sm py-12 text-center">
              {query || activeFilter ? "No matches." : "Empty. Drag files or folders in anywhere on this page, or use + New."}
            </div>
          )}

          {view === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {filteredFolders.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onClick={() => openFolder(f.id, f.name, f.locked)}
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "folder", id: f.id, name: f.name })}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(f.id); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(null); }}
                  onDrop={(e) => handleFolderDrop(e, f)}
                  className={`border rounded-lg px-3 py-3 flex flex-col items-start relative group cursor-pointer ${dropTargetId === f.id ? "bg-teal/20 border-teal" : "border-line bg-surface hover:border-teal"}`}
                >
                  <div className="text-2xl mb-3">{f.locked ? "🔒" : "📁"}</div>
                  <div className="text-xs truncate w-full pr-4">{f.name}</div>
                  <div className="absolute top-2 right-2">
                    <ContextMenu
                      actions={[
                        { label: "Download", onClick: () => downloadFolderAction(f) },
                        { label: "Move", onClick: () => setMoveTarget({ kind: "folder", id: f.id, name: f.name }) },
                        { label: "Delete", onClick: () => deleteFolder(f.id), danger: true },
                      ]}
                    />
                  </div>
                </div>
              ))}
              {filteredFiles.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "file", id: f.id, name: f.name })}
                  className="border border-line rounded-lg overflow-hidden hover:border-teal bg-surface flex flex-col relative group"
                >
                  <button onClick={() => setPreview(f)} className="text-left flex flex-col flex-1">
                    <div className="h-24 bg-surface2 flex items-center justify-center text-2xl overflow-hidden">
                      <Thumbnail fileId={f.id} mimeType={f.mimeType} password={current ? passwords[current.id] : undefined} />
                      {!f.mimeType.startsWith("image/") && iconFor(f.mimeType)}
                    </div>
                    <div className="px-2 py-2">
                      <div className="text-xs truncate pr-4">{f.name}</div>
                      <div className="text-[10px] text-dim mt-0.5">{formatBytes(f.size)}</div>
                    </div>
                  </button>
                  <div className="absolute top-1 right-1">
                    <ContextMenu
                      actions={[
                        { label: "Download", onClick: () => downloadFileAction(f) },
                        { label: "Move", onClick: () => setMoveTarget({ kind: "file", id: f.id, name: f.name }) },
                        { label: "Delete", onClick: () => deleteFile(f.id), danger: true },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-line rounded overflow-hidden">
              {filteredFolders.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onClick={() => openFolder(f.id, f.name, f.locked)}
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "folder", id: f.id, name: f.name })}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(f.id); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(null); }}
                  onDrop={(e) => handleFolderDrop(e, f)}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-line cursor-pointer ${dropTargetId === f.id ? "bg-teal/20" : "hover:bg-surface"}`}
                >
                  <div className="flex items-center gap-3 text-left flex-1 min-w-0">
                    <span>{f.locked ? "🔒" : "📁"}</span>
                    <span className="text-sm truncate">{f.name}</span>
                  </div>
                  <ContextMenu
                    actions={[
                      { label: "Download", onClick: () => downloadFolderAction(f) },
                      { label: "Rename", onClick: () => { setRenameTarget({ kind: "folder", id: f.id, name: f.name }); setRenameInput(f.name); } },
                      { label: "Move", onClick: () => setMoveTarget({ kind: "folder", id: f.id, name: f.name }) },
                      { label: "Delete", onClick: () => deleteFolder(f.id), danger: true },
                    ]}
                  />
                </div>
              ))}
              {filteredFiles.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "file", id: f.id, name: f.name })}
                  className="flex items-center justify-between px-4 py-3 border-b border-line last:border-0 hover:bg-surface"
                >
                  <button onClick={() => setPreview(f)} className="flex items-center gap-3 text-left flex-1 min-w-0">
                    <span>{iconFor(f.mimeType)}</span>
                    <span className="truncate text-sm">{f.name}</span>
                  </button>
                  <span className="text-dim text-xs w-20 text-right shrink-0 mr-3">{formatBytes(f.size)}</span>
                  <ContextMenu
                    actions={[
                      { label: "Download", onClick: () => downloadFileAction(f) },
                      { label: "Rename", onClick: () => { setRenameTarget({ kind: "file", id: f.id, name: f.name }); setRenameInput(f.name); } },
                      { label: "Move", onClick: () => setMoveTarget({ kind: "file", id: f.id, name: f.name }) },
                      { label: "Delete", onClick: () => deleteFile(f.id), danger: true },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </main>
        {/* Drag overlay */}
        {dragging && (
          <div className="absolute inset-0 z-40 bg-ink/90 border-4 border-dashed border-teal flex items-center justify-center pointer-events-none">
            <p className="font-display text-2xl text-paper">Drop to upload into "{current?.name}"</p>
          </div>
        )}
      </div>


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

      {moveTarget && (
        <MoveDialog
          title={`Move "${moveTarget.name}"`}
          excludeFolderId={moveTarget.kind === "folder" ? moveTarget.id : undefined}
          onCancel={() => setMoveTarget(null)}
          onConfirm={confirmMove}
        />
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

      {renameTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-6">
          <div className="bg-surface border border-line rounded w-full max-w-sm p-6">
            <h2 className="font-display text-lg mb-4">Rename {renameTarget.kind}</h2>
            <input
              autoFocus
              className="w-full bg-surface2 border border-line rounded px-3 py-2 text-paper focus:outline-none focus:border-teal"
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitRename()}
            />
            <div className="flex gap-2 mt-5">
              <button onClick={() => setRenameTarget(null)} className="flex-1 border border-line rounded px-3 py-2 text-dim">Cancel</button>
              <button onClick={submitRename} className="flex-1 bg-teal text-ink rounded px-3 py-2 font-medium">Rename</button>
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

      <TransfersPanel />
    </div>
  );
}
