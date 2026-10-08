import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { api } from "../lib/api";
import { thumbBlobCache } from "./Thumbnail";
import { FileIcon } from "./FileIcon";

export interface PreviewModalFile {
  id: string;
  name: string;
  size?: number;
  mimeType: string;
  encrypted?: boolean;
  folderId?: string;
}

export interface PreviewModalProps {
  file: PreviewModalFile;
  files?: PreviewModalFile[];
  password?: string;
  onClose: () => void;
  onNavigate?: (file: PreviewModalFile) => void;
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// Module-level cache for converted HEIC photos so navigating back is instant
const heicBlobCache = new Map<string, string>();

export default function PreviewModal({
  file,
  files = [],
  password,
  onClose,
  onNavigate,
}: PreviewModalProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState("");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isTextLoading, setIsTextLoading] = useState(false);
  const [heicUrl, setHeicUrl] = useState<string | null>(null);
  const [isHeicConverting, setIsHeicConverting] = useState(false);

  const isHeic =
    /\.(heic|heif)$/i.test(file.name) ||
    file.mimeType === "image/heic" ||
    file.mimeType === "image/heif";
  const isImage = file.mimeType.startsWith("image/") && !isHeic;
  const isVideo = file.mimeType.startsWith("video/");
  const isAudio = file.mimeType.startsWith("audio/");
  const isPdf = file.mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isText =
    file.mimeType.startsWith("text/") ||
    file.mimeType === "application/json" ||
    /\.(txt|md|json|log|csv|js|ts|jsx|tsx|py|html|css|yml|yaml|xml|sh|env)$/i.test(file.name);

  // Active navigation indices
  const activeIndex = useMemo(() => {
    if (!files || files.length === 0) return -1;
    return files.findIndex((f) => f.id === file.id);
  }, [files, file.id]);

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < files.length - 1;

  const handlePrev = useCallback(() => {
    if (onNavigate && hasPrev) {
      onNavigate(files[activeIndex - 1]);
    }
  }, [onNavigate, hasPrev, files, activeIndex]);

  const handleNext = useCallback(() => {
    if (onNavigate && hasNext) {
      onNavigate(files[activeIndex + 1]);
    }
  }, [onNavigate, hasNext, files, activeIndex]);

  // Keyboard navigation: Left/Right arrows and Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (hasPrev) handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (hasNext) handleNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePrev, handleNext, onClose, hasPrev, hasNext]);

  // Reset states on file change
  useEffect(() => {
    setImageLoaded(false);
    setError("");
    setTextContent(null);
    setHeicUrl(heicBlobCache.get(file.id) || null);
    setIsHeicConverting(false);
  }, [file.id]);

  // Convert Apple HEIC to JPEG in browser using WebAssembly
  useEffect(() => {
    if (!isHeic) return;
    if (heicBlobCache.has(file.id)) {
      setHeicUrl(heicBlobCache.get(file.id)!);
      return;
    }

    let cancelled = false;
    setIsHeicConverting(true);

    (async () => {
      try {
        const res = await fetch(api.fileUrl(file.id, password), {
          headers: { Authorization: `Bearer ${localStorage.getItem("telecloud_token")}` },
        });
        if (!res.ok) throw new Error("Failed to download HEIC image");
        const blob = await res.blob();
        if (cancelled) return;

        const heic2any = ((await import("heic2any")) as any).default;
        const converted = await heic2any({
          blob,
          toType: "image/jpeg",
          quality: 0.9,
        });

        if (cancelled) return;
        const resultBlob = Array.isArray(converted) ? converted[0] : converted;
        const url = URL.createObjectURL(resultBlob);
        heicBlobCache.set(file.id, url);
        setHeicUrl(url);
      } catch (err: any) {
        if (!cancelled) {
          console.warn("HEIC preview conversion warning:", err);
          setError("Apple HEIC photos are not natively supported by Chrome/Edge. Please download to view the original.");
        }
      } finally {
        if (!cancelled) setIsHeicConverting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file.id, isHeic, password]);

  // Smart Preloading for next & previous images/thumbnails
  useEffect(() => {
    if (!files || activeIndex < 0) return;
    const neighbors = [activeIndex + 1, activeIndex + 2, activeIndex - 1];
    neighbors.forEach((idx) => {
      const neighbor = files[idx];
      if (neighbor) {
        // Preload next image full resolution if unencrypted
        if (neighbor.mimeType.startsWith("image/") && !neighbor.encrypted) {
          const preImg = new Image();
          preImg.src = api.fileUrl(neighbor.id, password, true);
        }
        // Preload thumbnail for image/video
        if (neighbor.mimeType.startsWith("image/") || neighbor.mimeType.startsWith("video/")) {
          const preThumb = new Image();
          preThumb.src = api.thumbnailUrl(neighbor.id, password);
        }
      }
    });
  }, [file.id, activeIndex, files, password]);

  // For text files: load text content
  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    setIsTextLoading(true);
    fetch(api.fileUrl(file.id, password), {
      headers: { Authorization: `Bearer ${localStorage.getItem("telecloud_token")}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load text");
        return res.text();
      })
      .then((txt) => {
        if (!cancelled) {
          setTextContent(txt.length > 500000 ? txt.slice(0, 500000) + "\n... (truncated for preview)" : txt);
          setIsTextLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Failed to load text preview");
          setIsTextLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file.id, isText, password]);

  // For encrypted video/audio/pdf: fallback to blob URL
  const needsBlobFetch = file.encrypted && (isVideo || isAudio || isPdf);
  useEffect(() => {
    if (!needsBlobFetch) return;
    let revoked = "";
    (async () => {
      try {
        const res = await fetch(api.fileUrl(file.id, password), {
          headers: { Authorization: `Bearer ${localStorage.getItem("telecloud_token")}` },
        });
        if (!res.ok) throw new Error((await res.json()).error || "Preview failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revoked = url;
        setBlobUrl(url);
      } catch (e: any) {
        setError(e.message || "Failed to load preview");
      }
    })();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file.id, needsBlobFetch, password]);

  // Direct streaming download URL with query token
  const directStreamUrl = api.fileUrl(file.id, password, true);
  // Instant cached thumbnail URL
  const cachedThumbUrl = thumbBlobCache.get(file.id) || api.thumbnailUrl(file.id, password);

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-6 select-none"
      onClick={onClose}
    >
      {/* Floating Previous Button */}
      {files.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlePrev();
          }}
          disabled={!hasPrev}
          className={`absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 z-30 p-2.5 sm:p-3.5 rounded-full bg-surface/85 hover:bg-surface border border-line text-paper hover:text-teal backdrop-blur-lg shadow-2xl transition-all duration-150 active:scale-95 ${
            !hasPrev ? "opacity-20 cursor-not-allowed pointer-events-none" : "hover:scale-110 cursor-pointer"
          }`}
          title="Previous file (Left arrow)"
          aria-label="Previous file"
        >
          <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      )}

      {/* Floating Next Button */}
      {files.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
          disabled={!hasNext}
          className={`absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-30 p-2.5 sm:p-3.5 rounded-full bg-surface/85 hover:bg-surface border border-line text-paper hover:text-teal backdrop-blur-lg shadow-2xl transition-all duration-150 active:scale-95 ${
            !hasNext ? "opacity-20 cursor-not-allowed pointer-events-none" : "hover:scale-110 cursor-pointer"
          }`}
          title="Next file (Right arrow)"
          aria-label="Next file"
        >
          <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      )}

      {/* Main Container */}
      <div
        className="w-full max-w-5xl max-h-[96vh] flex flex-col items-center z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="w-full flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-xl bg-surface/80 border border-line backdrop-blur-md shadow-lg">
          {/* File details */}
          <div className="flex items-center gap-2.5 min-w-0 mr-2">
            <FileIcon mime={file.mimeType} className="w-5 h-5 shrink-0" />
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-paper text-sm font-medium truncate max-w-[200px] sm:max-w-md" title={file.name}>
                {file.name}
              </span>
              {file.size !== undefined && (
                <span className="text-xs text-dim shrink-0 hidden sm:inline">
                  {formatBytes(file.size)}
                </span>
              )}
            </div>
          </div>

          {/* Center: Navigation Counter & Buttons */}
          {files.length > 1 && (
            <div className="flex items-center gap-1 bg-surface2/80 px-2 py-1 rounded-lg border border-line text-xs">
              <button
                onClick={handlePrev}
                disabled={!hasPrev}
                className="p-1 text-dim hover:text-paper disabled:opacity-25 disabled:cursor-not-allowed rounded transition-colors"
                title="Previous (Left arrow)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-dim px-1 font-mono text-[11px] sm:text-xs">
                <span className="text-paper font-semibold">{activeIndex + 1}</span> / {files.length}
              </span>
              <button
                onClick={handleNext}
                disabled={!hasNext}
                className="p-1 text-dim hover:text-paper disabled:opacity-25 disabled:cursor-not-allowed rounded transition-colors"
                title="Next (Right arrow)"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={needsBlobFetch ? blobUrl || directStreamUrl : directStreamUrl}
              download={file.name}
              className="px-2.5 sm:px-3 py-1.5 bg-teal/15 hover:bg-teal/25 text-teal border border-teal/40 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-xs"
              title="Download file"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </a>
            <a
              href={directStreamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-dim hover:text-paper hover:bg-surface2 rounded-lg transition-colors hidden sm:flex items-center justify-center"
              title="Open raw file in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-dim hover:text-paper hover:bg-surface2 rounded-lg transition-colors flex items-center justify-center"
              title="Close (Esc)"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Viewer Body */}
        <div className="w-full flex-1 flex flex-col items-center justify-center relative min-h-[300px] max-h-[82vh] overflow-hidden rounded-2xl bg-black/60 border border-line shadow-2xl p-2 sm:p-4">
          {error && (
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
              <AlertCircle className="w-10 h-10 text-danger mb-3" />
              <p className="text-danger text-sm font-medium mb-1">{error}</p>
              <p className="text-dim text-xs mb-4">The file could not be rendered inline.</p>
              <a
                href={directStreamUrl}
                download={file.name}
                className="px-4 py-2 bg-teal text-ink font-semibold rounded-lg text-xs hover:opacity-90 transition-opacity"
              >
                Download File
              </a>
            </div>
          )}

          {/* IMAGE PREVIEW: Instant thumbnail + Progressive Native High-Res Image */}
          {isImage && !error && (
            <div className="relative flex items-center justify-center w-full h-full max-h-[80vh] overflow-hidden">
              {/* Instant blurred thumbnail placeholder (renders within 10-50ms) */}
              <img
                key={`thumb-${file.id}`}
                src={cachedThumbUrl}
                alt=""
                aria-hidden="true"
                className={`max-h-[78vh] sm:max-h-[80vh] max-w-full rounded-lg object-contain filter blur-md transition-opacity duration-300 pointer-events-none absolute inset-0 m-auto ${
                  imageLoaded ? "opacity-0" : "opacity-75"
                }`}
              />

              {/* Native full-resolution image streams directly */}
              <img
                key={`full-${file.id}`}
                src={directStreamUrl}
                alt={file.name}
                onLoad={() => setImageLoaded(true)}
                onError={() => {
                  // If direct stream fails, show error
                  setImageLoaded(true);
                  setError("Failed to render image");
                }}
                className={`max-h-[78vh] sm:max-h-[80vh] max-w-full rounded-lg object-contain transition-opacity duration-200 z-10 shadow-lg ${
                  imageLoaded ? "opacity-100" : "opacity-0"
                }`}
              />

              {/* High-res loading badge */}
              {!imageLoaded && !error && (
                <div className="absolute bottom-3 right-3 z-20 bg-surface/85 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 text-xs text-paper border border-line shadow-xl pointer-events-none">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal" />
                  <span className="text-[11px] font-medium">Loading high resolution…</span>
                </div>
              )}
            </div>
          )}

          {/* APPLE HEIC / HEIF PREVIEW (Converted to JPEG on-the-fly) */}
          {isHeic && !error && (
            <div className="relative flex items-center justify-center w-full h-full max-h-[80vh] overflow-hidden">
              {isHeicConverting && !heicUrl && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <Loader2 className="w-9 h-9 animate-spin text-teal" />
                  <p className="text-paper text-sm font-semibold">Converting Apple HEIC photo for preview…</p>
                  <p className="text-dim text-xs">Converting high-efficiency image to JPEG for browser display</p>
                </div>
              )}
              {heicUrl && (
                <img
                  key={heicUrl}
                  src={heicUrl}
                  alt={file.name}
                  className="max-h-[78vh] sm:max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
                />
              )}
            </div>
          )}

          {/* VIDEO PREVIEW: Native streaming with instant poster */}
          {isVideo && !error && (
            <div className="relative flex items-center justify-center w-full h-full max-h-[80vh]">
              {needsBlobFetch ? (
                blobUrl ? (
                  <video
                    key={file.id}
                    src={blobUrl}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-[78vh] sm:max-h-[80vh] max-w-full rounded-lg border border-line shadow-2xl"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-teal" />
                    <p className="text-dim text-xs">Decrypting locked video…</p>
                  </div>
                )
              ) : (
                <video
                  key={file.id}
                  src={directStreamUrl}
                  poster={cachedThumbUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[78vh] sm:max-h-[80vh] max-w-full rounded-lg border border-line shadow-2xl"
                />
              )}
            </div>
          )}

          {/* AUDIO PREVIEW: Native player */}
          {isAudio && !error && (
            <div className="flex flex-col items-center justify-center w-full max-w-md p-6 bg-surface/90 border border-line rounded-2xl shadow-xl my-8">
              <div className="w-16 h-16 rounded-2xl bg-teal/15 border border-teal/30 flex items-center justify-center mb-4 text-teal shadow-inner">
                <FileIcon mime={file.mimeType} className="w-8 h-8" />
              </div>
              <h3 className="text-paper text-sm font-semibold mb-1 text-center truncate max-w-full">
                {file.name}
              </h3>
              <p className="text-dim text-xs mb-6">{formatBytes(file.size)}</p>
              {needsBlobFetch ? (
                blobUrl ? (
                  <audio key={file.id} src={blobUrl} controls autoPlay className="w-full" />
                ) : (
                  <div className="flex items-center gap-2 text-xs text-dim">
                    <Loader2 className="w-4 h-4 animate-spin text-teal" />
                    <span>Decrypting audio…</span>
                  </div>
                )
              ) : (
                <audio key={file.id} src={directStreamUrl} controls autoPlay className="w-full" />
              )}
            </div>
          )}

          {/* PDF PREVIEW: Direct iframe streaming */}
          {isPdf && !error && (
            <div className="w-full h-[78vh] sm:h-[80vh] rounded-lg overflow-hidden border border-line bg-white shadow-2xl">
              {needsBlobFetch ? (
                blobUrl ? (
                  <iframe src={blobUrl} className="w-full h-full border-0" title={file.name} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 bg-surface">
                    <Loader2 className="w-8 h-8 animate-spin text-teal" />
                    <p className="text-dim text-xs">Decrypting locked PDF…</p>
                  </div>
                )
              ) : (
                <iframe src={directStreamUrl} className="w-full h-full border-0" title={file.name} />
              )}
            </div>
          )}

          {/* TEXT / CODE PREVIEW */}
          {isText && !error && (
            <div className="w-full h-[78vh] sm:h-[80vh] flex flex-col rounded-lg overflow-hidden border border-line bg-surface2 select-text">
              {isTextLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-teal" />
                  <p className="text-dim text-xs">Loading text…</p>
                </div>
              ) : textContent !== null ? (
                <pre className="p-4 font-mono text-xs text-paper overflow-auto flex-1 leading-relaxed whitespace-pre-wrap">
                  <code>{textContent}</code>
                </pre>
              ) : null}
            </div>
          )}

          {/* UNSUPPORTED BINARY FILE: Download Prompt */}
          {!isImage && !isVideo && !isAudio && !isPdf && !isText && !error && (
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
              <div className="w-16 h-16 rounded-2xl bg-surface2 border border-line flex items-center justify-center mb-4 text-dim">
                <FileIcon mime={file.mimeType} className="w-8 h-8" />
              </div>
              <h3 className="text-paper text-sm font-semibold mb-1 truncate max-w-full">
                {file.name}
              </h3>
              <p className="text-dim text-xs mb-4">
                {formatBytes(file.size)} • {file.mimeType || "Binary File"}
              </p>
              <p className="text-dim text-xs mb-6">
                No inline preview is available for this file type.
              </p>
              <a
                href={directStreamUrl}
                download={file.name}
                className="px-4 py-2 bg-teal text-ink font-semibold rounded-lg text-xs hover:opacity-90 transition-opacity flex items-center gap-2 shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>Download to View</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
