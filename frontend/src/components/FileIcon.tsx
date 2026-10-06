import React from "react";
import {
  Folder,
  FolderLock,
  Lock,
  File,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Code,
  FileSpreadsheet,
} from "lucide-react";

export function FileIcon({
  mime = "",
  isFolder = false,
  locked = false,
  className = "w-5 h-5",
}: {
  mime?: string;
  isFolder?: boolean;
  locked?: boolean;
  className?: string;
}) {
  if (isFolder) {
    if (locked) return <FolderLock className={`${className} text-brass`} />;
    return <Folder className={`${className} text-teal`} />;
  }

  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return <ImageIcon className={`${className} text-teal`} />;
  if (m.startsWith("video/")) return <Film className={`${className} text-sky-400`} />;
  if (m.startsWith("audio/")) return <Music className={`${className} text-pink-400`} />;
  if (m === "application/pdf") return <FileText className={`${className} text-red-400`} />;
  if (
    m.includes("zip") ||
    m.includes("archive") ||
    m.includes("tar") ||
    m.includes("compressed") ||
    m.includes("rar") ||
    m.includes("7z")
  ) {
    return <Archive className={`${className} text-amber-400`} />;
  }
  if (m.includes("sheet") || m.includes("excel") || m.includes("csv")) {
    return <FileSpreadsheet className={`${className} text-emerald-400`} />;
  }
  if (
    m.includes("json") ||
    m.includes("javascript") ||
    m.includes("typescript") ||
    m.includes("html") ||
    m.includes("text/")
  ) {
    return <Code className={`${className} text-indigo-400`} />;
  }
  return <File className={`${className} text-dim`} />;
}
