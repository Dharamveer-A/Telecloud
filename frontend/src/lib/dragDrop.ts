export interface DroppedFileNode {
  type: "file";
  name: string;
  file: File;
}
export interface DroppedFolderNode {
  type: "folder";
  name: string;
  children: DroppedNode[];
}
export type DroppedNode = DroppedFileNode | DroppedFolderNode;

function readEntryFile(entry: any): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readAllDirectoryEntries(reader: any): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const all: any[] = [];
    const readBatch = () => {
      reader.readEntries((batch: any[]) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        readBatch(); // readEntries only returns up to 100 at a time
      }, reject);
    };
    readBatch();
  });
}

async function entryToNode(entry: any): Promise<DroppedNode> {
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    return { type: "file", name: entry.name, file };
  }
  const reader = entry.createReader();
  const entries = await readAllDirectoryEntries(reader);
  const children = await Promise.all(entries.map(entryToNode));
  return { type: "folder", name: entry.name, children };
}

// Works for both drag-and-drop (DataTransferItemList) and a plain
// <input type="file"> selection (FileList, no folder structure available).
export async function itemsToTree(items: DataTransferItemList | null, fallbackFiles?: FileList | null): Promise<DroppedNode[]> {
  if (items && items.length && (items[0] as any).webkitGetAsEntry) {
    const entries = Array.from(items)
      .map((i) => i.webkitGetAsEntry())
      .filter(Boolean) as any[];
    if (entries.length) return Promise.all(entries.map(entryToNode));
  }
  if (fallbackFiles) {
    return Array.from(fallbackFiles).map((f) => ({ type: "file", name: f.name, file: f } as DroppedFileNode));
  }
  return [];
}

export interface FlatFileEntry {
  key: string;
  file: File;
  pathParts: string[]; // folder names above this file, e.g. ["trip", "videos"]
  editableName: string;
}

// Converts a flat FileList that carries `webkitRelativePath` (as produced
// by an <input type="file" webkitdirectory> folder picker) into the same
// tree shape drag-and-drop produces, so both flows share one upload path.
export function filesWithPathsToTree(fileList: FileList): DroppedNode[] {
  interface Building { type: "file"; name: string; file: File } 
  type BuildingFolder = { type: "folder"; name: string; childrenMap: Record<string, Building | BuildingFolder> };
  const rootMap: Record<string, Building | BuildingFolder> = {};

  for (const file of Array.from(fileList)) {
    const relPath = (file as any).webkitRelativePath || file.name;
    const parts = relPath.split("/").filter(Boolean);
    let map = rootMap;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let existing = map[part] as BuildingFolder | undefined;
      if (!existing) {
        existing = { type: "folder", name: part, childrenMap: {} };
        map[part] = existing;
      }
      map = existing.childrenMap;
    }
    const filename = parts[parts.length - 1];
    map[filename] = { type: "file", name: filename, file };
  }

  function convert(map: Record<string, Building | BuildingFolder>): DroppedNode[] {
    return Object.values(map).map((n) =>
      n.type === "file"
        ? { type: "file", name: n.name, file: n.file }
        : { type: "folder", name: n.name, children: convert(n.childrenMap) }
    );
  }
  return convert(rootMap);
}

export function flattenFiles(tree: DroppedNode[], prefix: string[] = []): FlatFileEntry[] {
  const out: FlatFileEntry[] = [];
  for (const node of tree) {
    if (node.type === "file") {
      out.push({
        key: [...prefix, node.name].join("/") + Math.random().toString(36).slice(2),
        file: node.file,
        pathParts: prefix,
        editableName: node.name, // default = original local filename
      });
    } else {
      out.push(...flattenFiles(node.children, [...prefix, node.name]));
    }
  }
  return out;
}
