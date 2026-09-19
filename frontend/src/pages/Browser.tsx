import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken, saveBlob } from "../lib/api";
import { itemsToTree, filesWithPathsToTree, DroppedNode, flattenFiles } from "../lib/dragDrop";
import { ActiveFilter, CustomFilter, loadCustomFilters, saveCustomFilters, matchesBuiltin, matchesCustom } from "../lib/filters";
import { transferStore } from "../lib/transfers";
import { useSelection } from "../lib/useSelection";
import PasswordPrompt from "../components/PasswordPrompt";
import PreviewModal from "../components/PreviewModal";
import Thumbnail from "../components/Thumbnail";
import GlobalContextMenu, { ContextMenuState } from "../components/GlobalContextMenu";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import MoveDialog from "../components/MoveDialog";
import FilterBar from "../components/FilterBar";
import TransfersPanel from "../components/TransfersPanel";
import TransfersTopButton from "../components/TransfersTopButton";
import ShareModal, { ShareTargetItem } from "../components/ShareModal";

type Crumb = { id: string; name: string; locked: boolean };
type SubFolder = {
  id: string;
  name: string;
  locked: boolean;
  itemCount?: number;
  createdAt?: number;
  path?: Crumb[];
  parentFolderName?: string;
};
type FileItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: number;
  encrypted: boolean;
  folderId?: string;
  path?: Crumb[];
  parentFolderName?: string;
};
type ViewMode = "grid" | "list";
type MoveTarget =
  | { kind: "file" | "folder"; id: string; name: string }
  | { kind: "bulk"; items: { kind: "file" | "folder"; id: string; name: string }[] }
  | null;
type SortOption = "name-asc" | "name-desc" | "date-desc" | "date-asc" | "size-desc" | "size-asc";
type TrashItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  size?: number;
  mimeType?: string;
  itemCount?: number;
  deletedAt: number;
  originalFolderName: string;
  locked?: boolean;
};

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

function FolderTreeNode({
  node,
  allFolders,
  currentPath,
  inTrash,
  onSelect,
  onDropToNode,
  depth = 0,
}: {
  node: any;
  allFolders: any[];
  currentPath: Crumb[];
  inTrash?: boolean;
  onSelect: (node: any) => void;
  onDropToNode?: (e: React.DragEvent, node: any) => void;
  depth?: number;
}) {
  const children = allFolders.filter((f) => f.parentId === node.id);
  const isOpen = currentPath.some((c) => c.id === node.id) || depth === 0; // auto open if in path or root
  const [expanded, setExpanded] = useState(isOpen);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (currentPath.some((c) => c.id === node.id)) setExpanded(true);
  }, [currentPath, node.id]);

  const isCurrentActive = !inTrash && currentPath[currentPath.length - 1]?.id === node.id;

  return (
    <div>
      <div
        className={`flex items-center group transition-colors rounded-md ${
          isCurrentActive
            ? "bg-teal/20 text-paper font-medium"
            : "hover:bg-surface text-dim hover:text-paper"
        } ${isDragOver ? "bg-teal/30 ring-1 ring-inset ring-teal" : ""}`}
        style={{ paddingLeft: `${depth * 12}px` }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          if (onDropToNode) onDropToNode(e, node);
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-6 h-6 flex items-center justify-center shrink-0 ${
            children.length === 0 ? "opacity-0" : "text-dim hover:text-paper"
          }`}
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
        <div className="space-y-0.5 mt-0.5">
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              allFolders={allFolders}
              currentPath={currentPath}
              inTrash={inTrash}
              onSelect={onSelect}
              onDropToNode={onDropToNode}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Browser() {
  const nav = useNavigate();
  const { selectedIds, setSelectedIds, marquee, registerItem, handlePointerDown, handleItemClick } = useSelection();
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
  const [shareTarget, setShareTarget] = useState<ShareTargetItem | null>(null);
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"current" | "global">("current");
  const [globalResults, setGlobalResults] = useState<{ files: FileItem[]; folders: SubFolder[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  async function resolveFolderPath(pathParts: string[], cache: Map<string, Promise<string>>, targetFolderId: string): Promise<string> {
    let parentId = targetFolderId;
    let acc = "";
    for (const part of pathParts) {
      acc += "/" + part;
      if (!cache.has(acc)) {
        const currParent = parentId;
        const currPart = part;
        const promise = (async () => {
          try {
            const all: any = await api.getAllFolders();
            const existing = (all.folders || []).find(
              (f: any) => f.parentId === currParent && f.name.toLowerCase() === currPart.toLowerCase()
            );
            if (existing) return existing.id;
          } catch {}
          const res: any = await api.createFolder(currParent, currPart);
          return res.folder.id;
        })();
        cache.set(acc, promise);
      }
      parentId = await cache.get(acc)!;
    }
    return parentId;
  }

  async function enqueueUploads(tree: DroppedNode[], targetFolderId: string, password?: string) {
    const flat = flattenFiles(tree);
    if (!flat.length) return;

    const items = flat.map((f) => ({
      f,
      transferId: "up-" + Math.random().toString(36).slice(2),
    }));

    transferStore.queueBatch(
      items.map((item) => ({
        id: item.transferId,
        name: item.f.editableName,
        kind: "upload",
        total: item.f.file.size,
      }))
    );

    const folderPromises = new Map<string, Promise<string>>();
    const CONCURRENCY = 2;
    let nextIndex = 0;

    async function uploadWorker() {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        const { f, transferId } = item;

        if (transferStore.isCancelled(transferId)) {
          continue;
        }

        // Wait if this transfer is paused before starting
        while (transferStore.isPaused(transferId) && !transferStore.isCancelled(transferId)) {
          await new Promise((r) => setTimeout(r, 400));
        }
        if (transferStore.isCancelled(transferId)) {
          continue;
        }

        let isDone = false;
        while (!isDone && !transferStore.isCancelled(transferId)) {
          const controller = new AbortController();
          transferStore.start(transferId, f.editableName, "upload", f.file.size, () => controller.abort());

          try {
            const destFolderId = f.pathParts.length
              ? await resolveFolderPath(f.pathParts, folderPromises, targetFolderId)
              : targetFolderId;

            if (transferStore.isCancelled(transferId)) {
              break;
            }
            if (transferStore.isPaused(transferId)) {
              while (transferStore.isPaused(transferId) && !transferStore.isCancelled(transferId)) {
                await new Promise((r) => setTimeout(r, 400));
              }
              if (transferStore.isCancelled(transferId)) break;
              continue;
            }

            await api.uploadFile(
              destFolderId,
              f.file,
              password,
              (p) => transferStore.update(transferId, p),
              f.editableName,
              controller.signal
            );
            transferStore.finish(transferId);
            isDone = true;
            refreshCurrent();
          } catch (e: any) {
            if (transferStore.isPaused(transferId)) {
              // Upload was paused by user! Wait until resumed or cancelled
              while (transferStore.isPaused(transferId) && !transferStore.isCancelled(transferId)) {
                await new Promise((r) => setTimeout(r, 400));
              }
              if (transferStore.isCancelled(transferId)) {
                break;
              }
              // If resumed, loop retries this file
              continue;
            } else if (e.message !== "Upload cancelled") {
              transferStore.fail(transferId, e.message);
              isDone = true;
            } else {
              transferStore.cancel(transferId);
              isDone = true;
            }
          }
        }
      }
    }

    const workerCount = Math.min(CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => uploadWorker()));

    refreshCurrent();
  }
  const [moveTarget, setMoveTarget] = useState<MoveTarget>(null);
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [inTrash, setInTrash] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashCount, setTrashCount] = useState<number>(0);

  async function fetchTrash() {
    try {
      const res: any = await api.getTrash();
      const list = res.items || [...(res.folders || []), ...(res.files || [])];
      setTrashItems(list);
      setTrashCount(list.length);
    } catch (e) {
      console.error("Failed to fetch trash:", e);
    }
  }

  function openTrash() {
    setSelectedIds(new Set());
    setInTrash(true);
    fetchTrash();
  }

  async function restoreTrashItems(ids: string[]) {
    try {
      await api.restoreTrash(ids);
      setSelectedIds(new Set());
      await fetchTrash();
      refreshCurrent();
    } catch (e: any) {
      alert(e.message || "Failed to restore items");
    }
  }

  async function deleteTrashPermanent(id: string) {
    if (!confirm("Permanently delete this item? This action cannot be undone.")) return;
    try {
      await api.deleteTrashPermanent(id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetchTrash();
    } catch (e: any) {
      alert(e.message || "Failed to permanently delete item");
    }
  }

  async function bulkDeleteTrashPermanent(ids: Set<string>) {
    if (!confirm(`Permanently delete ${ids.size} items? This action cannot be undone.`)) return;
    try {
      for (const id of ids) {
        await api.deleteTrashPermanent(id);
      }
      setSelectedIds(new Set());
      await fetchTrash();
    } catch (e: any) {
      alert(e.message || "Failed to permanently delete items");
    }
  }

  async function emptyTrash() {
    if (!confirm("Empty entire trash bin? All items will be permanently destroyed.")) return;
    try {
      await api.emptyTrash();
      setSelectedIds(new Set());
      await fetchTrash();
    } catch (e: any) {
      alert(e.message || "Failed to empty trash");
    }
  }


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

  const openFolderAbortRef = useRef<AbortController | null>(null);

  async function openFolder(id: string, name: string, locked: boolean, crumbSlice?: Crumb[], passwordOverride?: string) {
    setError("");
    if (openFolderAbortRef.current) {
      openFolderAbortRef.current.abort();
    }
    const controller = new AbortController();
    openFolderAbortRef.current = controller;

    const password = passwordOverride !== undefined ? passwordOverride : passwords[id];
    try {
      const res: any = await api.getFolder(id, password, controller.signal);
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
      if (e.name === "AbortError" || controller.signal.aborted) {
        return;
      }
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
    fetchTrash();
  }

  async function init() {
    const res: any = await api.getRoot();
    await openFolder(res.rootFolderId, "My Files", false, []);
    fetchTree();
    fetchTrash();
  }
  useEffect(() => { init(); }, []);

  function goToCrumb(index: number) {
    setInTrash(false);
    const target = path[index];
    openFolder(target.id, target.name, target.locked, path.slice(0, index));
  }

  useEffect(() => {
    if (searchScope !== "global" || !query.trim()) {
      setGlobalResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res: any = await api.search(query.trim());
        setGlobalResults({
          files: res.files || [],
          folders: res.folders || [],
        });
      } catch (e) {
        console.error("Global search failed:", e);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, searchScope]);

  async function jumpToParentFolder(pathCrumbs?: Crumb[], highlightItemId?: string) {
    if (!pathCrumbs || pathCrumbs.length === 0) return;
    const targetFolder = pathCrumbs[pathCrumbs.length - 1];
    setInTrash(false);
    setSearchScope("current");
    setQuery("");
    await openFolder(targetFolder.id, targetFolder.name, targetFolder.locked, pathCrumbs.slice(0, -1));
    if (highlightItemId) {
      setSelectedIds(new Set([highlightItemId]));
    }
  }

  function handleOpenFolderFromSearch(f: SubFolder) {
    setInTrash(false);
    setSearchScope("current");
    setQuery("");
    openFolder(f.id, f.name, f.locked, f.path);
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
    if (!confirm("Move this file to Trash?")) return;
    await api.deleteFile(id);
    setFiles((f) => f.filter((x) => x.id !== id));
    fetchTrash();
  }

  async function deleteFolder(id: string) {
    if (!confirm("Move this folder and everything inside it to Trash?")) return;
    await api.deleteFolder(id);
    setSubfolders((f) => f.filter((x) => x.id !== id));
    fetchTrash();
    fetchTree();
  }

  function openBulkMove(ids: Set<string>) {
    const items: { kind: "file" | "folder"; id: string; name: string }[] = [];
    for (const id of ids) {
      const file = files.find((f) => f.id === id);
      if (file) {
        items.push({ kind: "file", id: file.id, name: file.name });
        continue;
      }
      const folder = subfolders.find((f) => f.id === id);
      if (folder) {
        items.push({ kind: "folder", id: folder.id, name: folder.name });
      }
    }
    if (items.length === 0) return;
    setMoveTarget({ kind: "bulk", items });
  }

  async function confirmMove(destFolderId: string) {
    if (!moveTarget) return;
    try {
      if (moveTarget.kind === "file") {
        await api.moveFile(moveTarget.id, destFolderId);
      } else if (moveTarget.kind === "folder") {
        await api.moveFolder(moveTarget.id, destFolderId);
      } else if (moveTarget.kind === "bulk") {
        const fileIds = moveTarget.items.filter((i) => i.kind === "file").map((i) => i.id);
        const folderIds = moveTarget.items.filter((i) => i.kind === "folder").map((i) => i.id);
        await api.bulkMove(fileIds, folderIds, destFolderId);
        setSelectedIds(new Set());
      }
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
    if (inTrash || !e.dataTransfer.types.includes("Files")) return;
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
    if (inTrash || !current) return;
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
      const tree = await itemsToTree(null, e.target.files);
      enqueueUploads(tree, current.id, passwords[current.id]);
    }
    e.target.value = "";
  }

  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function handleInternalDragStart(e: React.DragEvent, item: { kind: "file" | "folder"; id: string; name: string }) {
    let itemsToMove = [item];
    if (selectedIds.has(item.id)) {
      itemsToMove = [];
      for (const id of selectedIds) {
        const fileMatch = files.find(x => x.id === id);
        if (fileMatch) itemsToMove.push({ kind: "file", id, name: fileMatch.name });
        else {
          const folderMatch = subfolders.find(x => x.id === id);
          if (folderMatch) itemsToMove.push({ kind: "folder", id, name: folderMatch.name });
        }
      }
    }
    e.dataTransfer.setData("application/telecloud-items", JSON.stringify(itemsToMove));
    e.dataTransfer.effectAllowed = "move";
  }

  async function handleFolderDrop(e: React.DragEvent, f: SubFolder) {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    dragCounter.current = 0;
    setDragging(false);

    const internalData = e.dataTransfer.getData("application/telecloud-items") || e.dataTransfer.getData("application/telecloud-item");
    if (internalData) {
      try {
        let items = JSON.parse(internalData);
        if (!Array.isArray(items)) items = [items];
        
        for (const item of items) {
          if (item.id === f.id) continue;
          if (item.kind === "file") await api.moveFile(item.id, f.id);
          else await api.moveFolder(item.id, f.id);
        }
        setSelectedIds(new Set());
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

  const isGlobalSearch = searchScope === "global" && !!query.trim();

  const sourceFolders = useMemo(() => {
    if (isGlobalSearch) return globalResults?.folders || [];
    return subfolders;
  }, [isGlobalSearch, globalResults, subfolders]);

  const sourceFiles = useMemo(() => {
    if (isGlobalSearch) return globalResults?.files || [];
    return files;
  }, [isGlobalSearch, globalResults, files]);

  const searchedFolders = useMemo(() => {
    if (isGlobalSearch) return sourceFolders;
    return sourceFolders.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));
  }, [isGlobalSearch, sourceFolders, query]);

  const searchedFiles = useMemo(() => {
    if (isGlobalSearch) return sourceFiles;
    return sourceFiles.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));
  }, [isGlobalSearch, sourceFiles, query]);

  // A type/size/name filter only makes sense against files - folders are
  // always shown (still searched by name) so you can navigate through
  // them to reach filtered files inside.
  const filteredFiles = useMemo(() => {
    return searchedFiles.filter((f) => {
      if (!activeFilter) return true;
      if (activeFilter.type === "builtin") {
        return matchesBuiltin(activeFilter.key, f);
      }
      const custom = customFilters.find(cf => cf.id === activeFilter.id);
      return custom ? matchesCustom(custom, f) : true;
    });
  }, [searchedFiles, activeFilter, customFilters]);
  const filteredFolders = useMemo(() => activeFilter ? [] : searchedFolders, [activeFilter, searchedFolders]);

  const sortedFolders = useMemo(() => {
    const list = [...filteredFolders];
    list.sort((a, b) => {
      if (sortBy === "name-asc") return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      if (sortBy === "name-desc") return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" });
      if (sortBy === "date-desc") return (b.createdAt || 0) - (a.createdAt || 0);
      if (sortBy === "date-asc") return (a.createdAt || 0) - (b.createdAt || 0);
      if (sortBy === "size-desc") return (b.itemCount || 0) - (a.itemCount || 0);
      if (sortBy === "size-asc") return (a.itemCount || 0) - (b.itemCount || 0);
      return 0;
    });
    return list;
  }, [filteredFolders, sortBy]);

  const sortedFiles = useMemo(() => {
    const list = [...filteredFiles];
    list.sort((a, b) => {
      if (sortBy === "name-asc") return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      if (sortBy === "name-desc") return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" });
      if (sortBy === "date-desc") return (b.createdAt || 0) - (a.createdAt || 0);
      if (sortBy === "date-asc") return (a.createdAt || 0) - (b.createdAt || 0);
      if (sortBy === "size-desc") return b.size - a.size;
      if (sortBy === "size-asc") return a.size - b.size;
      return 0;
    });
    return list;
  }, [filteredFiles, sortBy]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  function handleMainContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: "New Folder", onClick: () => setShowNewFolder(true) },
        { label: "Select All", onClick: () => {
           const allIds = new Set<string>();
           sortedFolders.forEach(f => allIds.add(f.id));
           sortedFiles.forEach(f => allIds.add(f.id));
           setSelectedIds(allIds);
        }}
      ]
    });
  }

  function handleItemMenu(
    e: React.MouseEvent,
    item: { kind: "file" | "folder"; id: string; name: string; locked?: boolean },
    fromButton = false
  ) {
    e.preventDefault();
    e.stopPropagation();

    let coords = { x: e.clientX, y: e.clientY };
    if (fromButton) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      coords = { x: rect.right - 150, y: rect.bottom + 4 };
    }

    const isSelected = selectedIds.has(item.id);

    if (isSelected && selectedIds.size > 1) {
      setContextMenu({
        x: coords.x,
        y: coords.y,
        actions: [
          {
            label: "Deselect",
            onClick: () => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
              });
            },
          },
          { label: `Move ${selectedIds.size} items`, onClick: () => openBulkMove(selectedIds) },
          { label: `Download ${selectedIds.size} items`, onClick: () => bulkDownload(selectedIds) },
          { label: `Delete ${selectedIds.size} items`, onClick: () => bulkDelete(selectedIds), danger: true },
        ],
      });
      return;
    }

    const selectAction = {
      label: isSelected ? "Deselect" : "Select",
      onClick: () => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (isSelected) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      },
    };

    if (item.kind === "folder") {
      const matchFolder = sortedFolders.find((x) => x.id === item.id);
      const folderActions: any[] = [
        {
          label: "Open",
          onClick: () =>
            matchFolder?.path
              ? handleOpenFolderFromSearch(matchFolder)
              : openFolder(item.id, item.name, !!item.locked),
        },
        selectAction,
      ];
      if (matchFolder?.path && matchFolder.path.length > 0) {
        folderActions.push({
          label: "Open containing folder",
          onClick: () => jumpToParentFolder(matchFolder.path, matchFolder.id),
        });
      }
      folderActions.push(
        {
          label: "Download",
          onClick: () =>
            downloadFolderAction({ id: item.id, name: item.name, locked: item.locked! }),
        },
        {
          label: "Share",
          onClick: () =>
            setShareTarget({
              kind: "folder",
              id: item.id,
              name: item.name,
              locked: item.locked,
            }),
        },
        {
          label: "Rename",
          onClick: () => {
            setRenameTarget({ kind: "folder", id: item.id, name: item.name });
            setRenameInput(item.name);
          },
        },
        { label: "Move", onClick: () => setMoveTarget({ kind: "folder", id: item.id, name: item.name }) },
        { label: "Delete", onClick: () => deleteFolder(item.id), danger: true }
      );

      setContextMenu({
        x: coords.x,
        y: coords.y,
        actions: folderActions,
      });
    } else {
      const targetFile = files.find((x) => x.id === item.id) || sortedFiles.find((x) => x.id === item.id);
      const fileActions: any[] = [
        {
          label: "Preview",
          onClick: () => {
            if (targetFile) setPreview(targetFile);
          },
        },
        selectAction,
      ];
      if (targetFile?.path && targetFile.path.length > 0) {
        fileActions.push({
          label: "Open containing folder",
          onClick: () => jumpToParentFolder(targetFile.path, targetFile.id),
        });
      }
      fileActions.push(
        {
          label: "Download",
          onClick: () => {
            if (targetFile) downloadFileAction(targetFile);
          },
        },
        {
          label: "Share",
          onClick: () =>
            setShareTarget({
              kind: "file",
              id: item.id,
              name: item.name,
              size: targetFile?.size,
              mimeType: targetFile?.mimeType,
            }),
        },
        {
          label: "Rename",
          onClick: () => {
            setRenameTarget({ kind: "file", id: item.id, name: item.name });
            setRenameInput(item.name);
          },
        },
        { label: "Move", onClick: () => setMoveTarget({ kind: "file", id: item.id, name: item.name }) },
        { label: "Delete", onClick: () => deleteFile(item.id), danger: true }
      );

      setContextMenu({
        x: coords.x,
        y: coords.y,
        actions: fileActions,
      });
    }
  }

  const handleItemContextMenu = (e: React.MouseEvent, item: { kind: "file" | "folder"; id: string; name: string; locked?: boolean }) => handleItemMenu(e, item, false);

  async function bulkDelete(ids: Set<string>) {
    if (inTrash) {
      await bulkDeleteTrashPermanent(ids);
      return;
    }
    if (!confirm(`Move ${ids.size} items to Trash?`)) return;
    for (const id of ids) {
      if (files.some(f => f.id === id)) await api.deleteFile(id);
      else await api.deleteFolder(id);
    }
    setSelectedIds(new Set());
    refreshCurrent();
    fetchTrash();
  }

  async function bulkDownload(ids: Set<string>) {
    for (const id of ids) {
      const f = files.find(x => x.id === id);
      if (f) downloadFileAction(f);
      else {
        const fd = subfolders.find(x => x.id === id);
        if (fd) downloadFolderAction(fd);
      }
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          bulkDelete(selectedIds);
        }
      } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (inTrash) {
          setSelectedIds(new Set(trashItems.map(item => item.id)));
        } else {
          const allIds = new Set<string>();
          sortedFolders.forEach(f => allIds.add(f.id));
          sortedFiles.forEach(f => allIds.add(f.id));
          setSelectedIds(allIds);
        }
      } else if (e.key === "F2") {
        if (selectedIds.size === 1 && !inTrash) {
          e.preventDefault();
          const id = Array.from(selectedIds)[0];
          const fileMatch = files.find(f => f.id === id);
          if (fileMatch) {
            setRenameTarget({ kind: "file", id, name: fileMatch.name });
            setRenameInput(fileMatch.name);
          } else {
            const folderMatch = subfolders.find(f => f.id === id);
            if (folderMatch) {
              setRenameTarget({ kind: "folder", id, name: folderMatch.name });
              setRenameInput(folderMatch.name);
            }
          }
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, files, subfolders, sortedFolders, sortedFiles, inTrash, trashItems]);

  const combinedItems = useMemo(() => [
    ...filteredFolders.map(f => ({ ...f, _type: 'folder' as const })),
    ...filteredFiles.map(f => ({ ...f, _type: 'file' as const }))
  ], [filteredFolders, filteredFiles]);

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

        {/* Folder Tree (Root 'My Files' + Subfolders) */}
        <div className="flex-1 overflow-y-auto mt-3 pr-2 space-y-0.5">
          {allFolders
            .filter((f) => !f.parentId) // root folders (My Files)
            .map((rootNode) => (
              <FolderTreeNode 
                key={rootNode.id} 
                node={rootNode} 
                allFolders={allFolders} 
                currentPath={path} 
                inTrash={inTrash}
                onDropToNode={handleFolderDrop}
                onSelect={(n) => {
                  setInTrash(false);
                  if (!n.parentId) {
                    goToCrumb(0);
                    return;
                  }
                  // build path up to n
                  const newPath: Crumb[] = [];
                  let curr = n;
                  while (curr) {
                    newPath.unshift({ id: curr.id, name: curr.name, locked: curr.locked });
                    curr = allFolders.find((f) => f.id === curr.parentId);
                  }
                  openFolder(n.id, n.name, n.locked, newPath.slice(0, -1));
                }} 
              />
            ))}
        </div>

        {/* Trash */}
        <div className="border-t border-line pt-2 mt-2">
          <button
            onClick={openTrash}
            className={`w-full text-left px-2.5 py-2 rounded text-sm flex items-center justify-between transition-colors ${
              inTrash ? "bg-surface2 text-paper font-medium" : "text-dim hover:text-paper hover:bg-surface"
            }`}
          >
            <div className="flex items-center gap-2">
              <span>🗑️</span>
              <span>Trash</span>
            </div>
            {trashCount > 0 && (
              <span className="text-xs bg-danger/20 text-danger border border-danger/30 px-1.5 py-0.5 rounded-full font-mono">
                {trashCount}
              </span>
            )}
          </button>
        </div>

        {current && (
          <button
            onClick={() =>
              setShareTarget({
                kind: "folder",
                id: current.id,
                name: current.name,
                locked: current.locked,
              })
            }
            className="text-left px-2 py-2 rounded text-sm text-dim hover:text-paper hover:bg-surface flex items-center gap-2 mt-2"
          >
            🔗 Share this folder
          </button>
        )}

        {current && !current.locked && (
          <button onClick={() => setShowLockSetup(true)} className="text-left px-2 py-2 rounded text-sm text-brass hover:bg-surface flex items-center gap-2 mt-1">
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
        {inTrash ? (
          <div className="px-6 py-4 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🗑️</span>
              <div>
                <h2 className="text-paper font-medium text-base">Trash Bin</h2>
                <p className="text-dim text-xs">
                  {trashItems.length} {trashItems.length === 1 ? "item" : "items"} &bull; Items are kept here until restored or permanently deleted
                </p>
              </div>
            </div>
            {trashItems.length > 0 && (
              <button
                onClick={emptyTrash}
                className="text-xs bg-danger/10 hover:bg-danger/20 text-danger border border-danger/30 px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 font-medium"
              >
                <span>🗑️</span> Empty Trash
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-line flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] relative flex items-center">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    searchScope === "global"
                      ? "Search across all files & folders..."
                      : `Search in "${current?.name || "this folder"}"...`
                  }
                  className="w-full bg-surface border border-line rounded px-3 py-1.5 pr-8 text-sm focus:outline-none focus:border-teal"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-2.5 text-xs text-dim hover:text-paper"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex border border-line rounded overflow-hidden text-xs shrink-0">
                <button
                  onClick={() => setSearchScope("current")}
                  className={`px-2.5 py-1.5 flex items-center gap-1.5 transition-colors ${
                    searchScope === "current" ? "bg-surface2 text-paper font-medium" : "text-dim hover:text-paper"
                  }`}
                  title="Search only within this folder"
                >
                  <span>📁</span>
                  <span className="hidden sm:inline">This folder</span>
                </button>
                <button
                  onClick={() => setSearchScope("global")}
                  className={`px-2.5 py-1.5 flex items-center gap-1.5 transition-colors ${
                    searchScope === "global" ? "bg-surface2 text-teal font-medium" : "text-dim hover:text-paper"
                  }`}
                  title="Search across all files and folders"
                >
                  <span>🌐</span>
                  <span className="hidden sm:inline">All files</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-dim">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-surface border border-line rounded px-2.5 py-1.5 text-xs text-paper focus:outline-none focus:border-teal cursor-pointer"
                >
                  <option value="name-asc">Name (A–Z)</option>
                  <option value="name-desc">Name (Z–A)</option>
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="size-desc">Size / Items (Largest)</option>
                  <option value="size-asc">Size / Items (Smallest)</option>
                </select>
              </div>
              <div className="flex border border-line rounded overflow-hidden text-xs">
                <button onClick={() => setView("grid")} className={`px-2 py-1.5 ${view === "grid" ? "bg-surface2 text-paper" : "text-dim"}`}>Grid</button>
                <button onClick={() => setView("list")} className={`px-2 py-1.5 ${view === "list" ? "bg-surface2 text-paper" : "text-dim"}`}>List</button>
              </div>

              <div className="ml-auto flex items-center">
                <TransfersTopButton />
              </div>
            </div>

            <FilterBar
              active={activeFilter}
              onChange={setActiveFilter}
              customFilters={customFilters}
              onAddCustom={addCustomFilter}
              onRemoveCustom={removeCustomFilter}
            />

            {!isGlobalSearch ? (
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
            ) : (
              <div className="px-6 py-2.5 bg-surface2/60 border-b border-line flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2">
                  <span className="text-teal font-medium flex items-center gap-1.5">
                    <span>🌐</span>
                    {isSearching
                      ? "Searching across all folders..."
                      : `Found ${sortedFolders.length + sortedFiles.length} ${sortedFolders.length + sortedFiles.length === 1 ? "result" : "results"} for "${query}" across all folders`}
                  </span>
                </div>
                <button
                  onClick={() => { setQuery(""); setSearchScope("current"); }}
                  className="text-dim hover:text-paper text-xs flex items-center gap-1 hover:underline cursor-pointer"
                >
                  ✕ Clear search
                </button>
              </div>
            )}
          </>
        )}

        <main 
          className="flex-1 px-6 py-5 overflow-y-auto relative"
          onPointerDown={inTrash ? undefined : handlePointerDown}
          onContextMenu={inTrash ? undefined : handleMainContextMenu}
        >
        {inTrash ? (
          trashItems.length === 0 ? (
            <div className="text-dim text-sm py-20 text-center flex flex-col items-center justify-center">
              <span className="text-4xl mb-3">🗑️</span>
              <p className="text-paper font-medium mb-1">Trash is empty</p>
              <p className="text-xs text-dim">Deleted files and folders will appear here until restored or permanently deleted.</p>
            </div>
          ) : (
            <div className="border border-line rounded-lg overflow-hidden bg-surface">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface2 text-dim text-xs">
                    <th className="py-2.5 px-4 w-8">
                      <input
                        type="checkbox"
                        checked={trashItems.length > 0 && selectedIds.size === trashItems.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(new Set(trashItems.map((item) => item.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                        className="cursor-pointer accent-teal"
                      />
                    </th>
                    <th className="py-2.5 px-4 font-normal">Name</th>
                    <th className="py-2.5 px-4 font-normal">Original Location</th>
                    <th className="py-2.5 px-4 font-normal">Date Deleted</th>
                    <th className="py-2.5 px-4 font-normal">Size / Items</th>
                    <th className="py-2.5 px-4 font-normal text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {trashItems.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                        className={`hover:bg-surface2/60 transition-colors cursor-pointer ${
                          isSelected ? "bg-teal/10" : ""
                        }`}
                      >
                        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              });
                            }}
                            className="cursor-pointer accent-teal"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">
                              {item.type === "folder" ? (item.locked ? "🔒" : "📁") : "📄"}
                            </span>
                            <span className="font-medium text-paper">{item.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-dim text-xs">
                          📁 {item.originalFolderName || "My Files"}
                        </td>
                        <td className="py-3 px-4 text-dim text-xs">
                          {new Date(item.deletedAt).toLocaleDateString()} {new Date(item.deletedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-4 text-dim text-xs">
                          {item.type === "folder" ? `${item.itemCount || 0} items` : formatBytes(item.size || 0)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => restoreTrashItems([item.id])}
                              className="px-2.5 py-1 rounded text-xs bg-surface2 hover:bg-teal/20 text-dim hover:text-teal border border-line hover:border-teal/50 transition-colors flex items-center gap-1"
                              title="Restore item"
                            >
                              <span>↩️</span> Restore
                            </button>
                            <button
                              onClick={() => deleteTrashPermanent(item.id)}
                              className="px-2.5 py-1 rounded text-xs bg-surface2 hover:bg-danger/20 text-dim hover:text-danger border border-line hover:border-danger/50 transition-colors flex items-center gap-1"
                              title="Delete forever"
                            >
                              <span>🗑️</span> Delete Forever
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
        {marquee && (
          <div
            style={{
              position: 'fixed',
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              width: Math.abs(marquee.x1 - marquee.x2),
              height: Math.abs(marquee.y1 - marquee.y2),
            }}
            className="bg-teal/20 border border-teal pointer-events-none z-50"
          />
        )}
          {sortedFolders.length === 0 && sortedFiles.length === 0 && (
            <div className="text-dim text-sm py-12 text-center">
              {query || activeFilter ? "No matches." : "Empty. Drag files or folders in anywhere on this page, or use + New."}
            </div>
          )}

          {view === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {sortedFolders.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onClick={(e) => {
                    if (!handleItemClick(e, f.id)) {
                      if (f.path) handleOpenFolderFromSearch(f);
                      else openFolder(f.id, f.name, f.locked);
                    }
                  }}
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "folder", id: f.id, name: f.name })}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(f.id); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(null); }}
                  onDrop={(e) => handleFolderDrop(e, f)}
                  ref={(el) => registerItem(f.id, el)}
                  className={`selectable-item border rounded-lg px-3 py-3 flex flex-col items-start relative group cursor-pointer ${dropTargetId === f.id ? "bg-teal/20 border-teal" : selectedIds.has(f.id) ? "bg-teal/20 border-teal ring-1 ring-teal" : "border-line bg-surface hover:border-teal"}`}
                  onContextMenu={(e) => handleItemContextMenu(e, { kind: "folder", id: f.id, name: f.name, locked: f.locked })}
                >
                  <button
                    onClick={(e) => handleItemMenu(e, { kind: "folder", id: f.id, name: f.name, locked: f.locked }, true)}
                    className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center text-dim hover:text-paper hover:bg-surface2/80 transition-all opacity-70 group-hover:opacity-100 z-10 text-sm focus:outline-none"
                    title="Options"
                    aria-label="Options"
                  >
                    ⋮
                  </button>
                  <div className="text-2xl mb-2">{f.locked ? "🔒" : "📁"}</div>
                  <div className="text-xs font-medium truncate w-full pr-6">{f.name}</div>
                  <div className="text-[10px] text-dim mt-0.5">
                    {f.itemCount !== undefined ? `${f.itemCount} ${f.itemCount === 1 ? "item" : "items"}` : ""}
                  </div>
                  {f.path && f.path.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToParentFolder(f.path, f.id);
                      }}
                      className="text-[10px] text-teal/80 hover:text-teal hover:underline truncate mt-1 flex items-center gap-1 max-w-full text-left"
                      title={`Location: ${f.path.map((p) => p.name).join(" / ")}`}
                    >
                      <span>in</span>
                      <span className="truncate">{f.path.map((p) => p.name).join(" / ")}</span>
                    </button>
                  )}
                </div>
              ))}
              {sortedFiles.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "file", id: f.id, name: f.name })}
                  ref={(el) => registerItem(f.id, el)}
                  className={`selectable-item border rounded-lg overflow-hidden flex flex-col relative group ${selectedIds.has(f.id) ? "bg-teal/20 border-teal ring-1 ring-teal" : "border-line bg-surface hover:border-teal"}`}
                  onContextMenu={(e) => handleItemContextMenu(e, { kind: "file", id: f.id, name: f.name })}
                >
                  <button
                    onClick={(e) => handleItemMenu(e, { kind: "file", id: f.id, name: f.name }, true)}
                    className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center text-dim hover:text-paper bg-surface/80 hover:bg-surface2 backdrop-blur-sm transition-all opacity-70 group-hover:opacity-100 z-10 text-sm shadow-sm focus:outline-none"
                    title="Options"
                    aria-label="Options"
                  >
                    ⋮
                  </button>
                  <button onClick={(e) => { if (!handleItemClick(e, f.id)) setPreview(f); }} className="text-left flex flex-col flex-1">
                    <div className="h-24 bg-surface2 flex items-center justify-center text-2xl overflow-hidden relative">
                      <span className="select-none pointer-events-none">{iconFor(f.mimeType)}</span>
                      {(f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/")) && (
                        <div className="absolute inset-0 z-10">
                          <Thumbnail fileId={f.id} mimeType={f.mimeType} password={current ? passwords[current.id] : undefined} />
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-2">
                      <div className="text-xs truncate pr-4">{f.name}</div>
                      <div className="text-[10px] text-dim mt-0.5">{formatBytes(f.size)}</div>
                      {f.path && f.path.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            jumpToParentFolder(f.path, f.id);
                          }}
                          className="text-[10px] text-teal/80 hover:text-teal hover:underline truncate mt-1 flex items-center gap-1 max-w-full text-left"
                          title={`Location: ${f.path.map((p) => p.name).join(" / ")}`}
                        >
                          <span>in</span>
                          <span className="truncate">{f.path.map((p) => p.name).join(" / ")}</span>
                        </button>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-line rounded overflow-hidden">
              {sortedFolders.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onClick={(e) => {
                    if (!handleItemClick(e, f.id)) {
                      if (f.path) handleOpenFolderFromSearch(f);
                      else openFolder(f.id, f.name, f.locked);
                    }
                  }}
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "folder", id: f.id, name: f.name })}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(f.id); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDropTargetId(null); }}
                  onDrop={(e) => handleFolderDrop(e, f)}
                  ref={(el) => registerItem(f.id, el)}
                  className={`selectable-item flex items-center gap-3 px-4 py-3 border-b border-line cursor-pointer ${dropTargetId === f.id ? "bg-teal/20" : selectedIds.has(f.id) ? "bg-teal/20" : "hover:bg-surface"}`}
                  onContextMenu={(e) => handleItemContextMenu(e, { kind: "folder", id: f.id, name: f.name, locked: f.locked })}
                >
                  <div className="flex items-center gap-3 text-left flex-1 min-w-0">
                    <span>{f.locked ? "🔒" : "📁"}</span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm truncate">{f.name}</span>
                      {f.path && f.path.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            jumpToParentFolder(f.path, f.id);
                          }}
                          className="text-[11px] text-teal/80 hover:text-teal hover:underline text-left truncate flex items-center gap-1 mt-0.5"
                          title={`Location: ${f.path.map((p) => p.name).join(" / ")}`}
                        >
                          <span>in</span>
                          <span className="truncate">{f.path.map((p) => p.name).join(" / ")}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-dim text-xs w-20 text-right">
                      {f.itemCount !== undefined ? `${f.itemCount} ${f.itemCount === 1 ? "item" : "items"}` : "—"}
                    </span>
                    <button
                      onClick={(e) => handleItemMenu(e, { kind: "folder", id: f.id, name: f.name, locked: f.locked }, true)}
                      className="w-6 h-6 rounded flex items-center justify-center text-dim hover:text-paper hover:bg-surface2 transition-all opacity-70 group-hover:opacity-100 shrink-0 text-sm focus:outline-none"
                      title="Options"
                      aria-label="Options"
                    >
                      ⋮
                    </button>
                  </div>
                </div>
              ))}
              {sortedFiles.map((f) => (
                <div
                  key={f.id}
                  draggable
                  onDragStart={(e) => handleInternalDragStart(e, { kind: "file", id: f.id, name: f.name })}
                  ref={(el) => registerItem(f.id, el)}
                  className={`selectable-item flex items-center justify-between px-4 py-3 border-b border-line last:border-0 ${selectedIds.has(f.id) ? "bg-teal/20" : "hover:bg-surface"}`}
                  onContextMenu={(e) => handleItemContextMenu(e, { kind: "file", id: f.id, name: f.name })}
                >
                  <button onClick={(e) => { if (!handleItemClick(e, f.id)) setPreview(f); }} className="flex items-center gap-3 text-left flex-1 min-w-0">
                    <span>{iconFor(f.mimeType)}</span>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-sm">{f.name}</span>
                      {f.path && f.path.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            jumpToParentFolder(f.path, f.id);
                          }}
                          className="text-[11px] text-teal/80 hover:text-teal hover:underline text-left truncate flex items-center gap-1 mt-0.5"
                          title={`Location: ${f.path.map((p) => p.name).join(" / ")}`}
                        >
                          <span>in</span>
                          <span className="truncate">{f.path.map((p) => p.name).join(" / ")}</span>
                        </button>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-dim text-xs w-20 text-right">{formatBytes(f.size)}</span>
                    <button
                      onClick={(e) => handleItemMenu(e, { kind: "file", id: f.id, name: f.name }, true)}
                      className="w-6 h-6 rounded flex items-center justify-center text-dim hover:text-paper hover:bg-surface2 transition-all opacity-70 group-hover:opacity-100 text-sm shrink-0 focus:outline-none"
                      title="Options"
                      aria-label="Options"
                    >
                      ⋮
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </>
        )}
        </main>
        {/* Drag overlay */}
        {dragging && !inTrash && (
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

      {shareTarget && (
        <ShareModal
          item={shareTarget}
          folderPassword={passwords[shareTarget.id] || (current ? passwords[current.id] : undefined)}
          onClose={() => setShareTarget(null)}
        />
      )}

      {moveTarget && (
        <MoveDialog
          title={
            moveTarget.kind === "bulk"
              ? `Move ${moveTarget.items.length} items`
              : `Move "${moveTarget.name}"`
          }
          excludeFolderId={moveTarget.kind === "folder" ? moveTarget.id : undefined}
          excludeFolderIds={
            moveTarget.kind === "bulk"
              ? moveTarget.items.filter((i) => i.kind === "folder").map((i) => i.id)
              : undefined
          }
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

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface/95 backdrop-blur border border-line shadow-2xl rounded-full px-5 py-2 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
          <span className="text-xs font-semibold text-paper whitespace-nowrap">
            {selectedIds.size} {selectedIds.size === 1 ? "item" : "items"} selected
          </span>
          <span className="w-px h-4 bg-line" />
          {inTrash ? (
            <>
              <button
                onClick={() => restoreTrashItems(Array.from(selectedIds))}
                className="text-xs text-teal hover:bg-teal/20 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors font-medium"
                title="Restore selected items"
              >
                <span>↩️</span> Restore
              </button>
              <button
                onClick={() => bulkDeleteTrashPermanent(selectedIds)}
                className="text-xs text-danger hover:bg-danger/10 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors font-medium"
                title="Delete selected items permanently"
              >
                <span>🗑️</span> Delete Forever
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => openBulkMove(selectedIds)}
                className="text-xs text-dim hover:text-paper hover:bg-surface2 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors"
                title="Move selected items"
              >
                <span>📦</span> Move
              </button>
              <button
                onClick={() => bulkDownload(selectedIds)}
                className="text-xs text-dim hover:text-paper hover:bg-surface2 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors"
                title="Download selected items"
              >
                <span>⬇️</span> Download
              </button>
              <button
                onClick={() => bulkDelete(selectedIds)}
                className="text-xs text-danger/80 hover:text-danger hover:bg-danger/10 px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors"
                title="Delete selected items"
              >
                <span>🗑</span> Delete
              </button>
            </>
          )}
          <span className="w-px h-4 bg-line" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-dim hover:text-paper hover:bg-surface2 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
            title="Clear selection"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
      )}

      <TransfersPanel />
      <GlobalContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
