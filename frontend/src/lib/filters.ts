export interface CustomFilter {
  id: string;
  label: string;
  nameContains?: string;
  extensions?: string[]; // without dots, lowercase, e.g. ["zip","rar"]
  minSizeMB?: number;
  maxSizeMB?: number;
}

export type BuiltinFilterKey = "images" | "videos" | "audio" | "documents";

export type ActiveFilter = { type: "builtin"; key: BuiltinFilterKey } | { type: "custom"; id: string } | null;

const STORAGE_KEY = "telecloud_custom_filters";

export function loadCustomFilters(): CustomFilter[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}
export function saveCustomFilters(filters: CustomFilter[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

const DOC_MIME_HINTS = ["pdf", "word", "document", "text/", "spreadsheet", "presentation", "msword", "rtf"];

export function matchesBuiltin(key: BuiltinFilterKey, file: { name: string; mimeType: string }): boolean {
  switch (key) {
    case "images": return file.mimeType.startsWith("image/");
    case "videos": return file.mimeType.startsWith("video/");
    case "audio": return file.mimeType.startsWith("audio/");
    case "documents": return DOC_MIME_HINTS.some((hint) => file.mimeType.includes(hint));
  }
}

export function matchesCustom(filter: CustomFilter, file: { name: string; size: number }): boolean {
  if (filter.nameContains && !file.name.toLowerCase().includes(filter.nameContains.toLowerCase())) return false;
  if (filter.extensions && filter.extensions.length > 0) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!filter.extensions.includes(ext)) return false;
  }
  const sizeMB = file.size / (1024 * 1024);
  if (filter.minSizeMB !== undefined && sizeMB < filter.minSizeMB) return false;
  if (filter.maxSizeMB !== undefined && sizeMB > filter.maxSizeMB) return false;
  return true;
}
