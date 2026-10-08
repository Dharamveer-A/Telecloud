import { useEffect, useState, useCallback, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  X,
  AlertCircle,
  Camera,
  Film,
  FileText,
  ShieldCheck,
  Sparkles,
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

interface InterestingLoaderProps {
  type: "heic" | "image" | "video" | "audio" | "pdf" | "text" | "encrypted";
  fileName: string;
  fileSize?: number;
}

const stepsByType: Record<string, Array<{ title: string; desc: string }>> = {
  heic: [
    { title: "Retrieving Apple HEIC Asset", desc: "Streaming compressed high-efficiency blocks from Telegram Cloud…" },
    { title: "Extracting Multi-Frame Layers", desc: "Parsing HEVC container, depth metadata & HDR channels…" },
    { title: "Calibrating DCI-P3 Color Gamut", desc: "Optimizing wide color spectrum for high-fidelity display…" },
    { title: "Synthesizing Ultra-HD JPEG", desc: "Reconstructing 12MP crystal-clear display image…" },
    { title: "Rendering Canvas", desc: "Finalizing pixel buffer for smooth hardware presentation…" },
  ],
  image: [
    { title: "Streaming Master Asset", desc: "Fetching full-resolution master file from Telegram Cloud…" },
    { title: "Enhancing Dynamic Range", desc: "Processing sub-pixel clarity and contrast profiles…" },
    { title: "Rendering Ultra-HD Pixels", desc: "Assembling high-definition raster onto canvas…" },
  ],
  encrypted: [
    { title: "Authenticating Client Vault", desc: "Deriving AES-256-GCM zero-knowledge encryption key…" },
    { title: "Verifying Cryptographic Tag", desc: "Validating 128-bit authentication tag against tampering…" },
    { title: "Decompressing Decrypted Stream", desc: "Assembling decrypted data securely in browser memory…" },
  ],
  video: [
    { title: "Initializing Video Stream", desc: "Establishing low-latency stream buffer from Telegram Cloud…" },
    { title: "Demuxing Media Streams", desc: "Synchronizing high-definition video and audio tracks…" },
    { title: "Starting Hardware Player", desc: "Spinning up hardware-accelerated media pipeline…" },
  ],
  audio: [
    { title: "Buffering High-Fidelity Audio", desc: "Streaming lossless audio chunks from cloud…" },
    { title: "Demuxing Audio Codec", desc: "Preparing hardware audio output pipeline…" },
  ],
  pdf: [
    { title: "Loading Document Pages", desc: "Streaming PDF document from secure cloud…" },
    { title: "Rasterizing Vector Elements", desc: "Preparing crystal-clear document pages…" },
  ],
  text: [
    { title: "Loading Text Stream", desc: "Fetching document stream from cloud…" },
    { title: "Formatting Syntax", desc: "Preparing code and text highlights…" },
  ],
};

function InterestingLoader({ type, fileName, fileSize }: InterestingLoaderProps) {
  const steps = stepsByType[type] || stepsByType.image;
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    setStepIdx(0);
    const interval = setInterval(() => {
      setStepIdx((prev) => (prev + 1) % steps.length);
    }, 1700);
    return () => clearInterval(interval);
  }, [type, steps.length]);

  const currentStep = steps[stepIdx] || steps[0];

  return (
    <div className="relative flex flex-col items-center justify-center p-6 text-center select-none max-w-md mx-auto my-auto z-20">
      {/* Soft Ambient Neon Glow */}
      <div className="absolute w-56 h-56 rounded-full bg-teal/20 blur-3xl -z-10 animate-pulse-ring pointer-events-none" />

      {/* Holographic Center Core with concentric spinning rings */}
      <div className="relative w-28 h-28 flex items-center justify-center mb-6">
        {/* Outer counter-rotating dashed orbital ring */}
        <div className="absolute inset-0 rounded-full border border-dashed border-teal/35 animate-spin-reverse" />

        {/* Outer pulsing ring */}
        <div className="absolute inset-2 rounded-full border border-teal/20 animate-pulse-ring" />

        {/* Dynamic spinning gradient neon ring */}
        <div className="w-20 h-20 rounded-full p-[2px] bg-gradient-to-tr from-teal via-cyan-400 to-indigo-500 animate-spin shadow-[0_0_20px_rgba(79,163,160,0.35)]">
          <div className="w-full h-full bg-surface/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-inner">
            {type === "heic" || type === "image" ? (
              <div className="relative flex items-center justify-center">
                <Camera className="w-8 h-8 text-teal animate-pulse" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
              </div>
            ) : type === "video" ? (
              <Film className="w-8 h-8 text-teal animate-pulse" />
            ) : type === "encrypted" ? (
              <ShieldCheck className="w-8 h-8 text-brass animate-pulse" />
            ) : type === "audio" ? (
              <div className="flex items-end gap-1 h-6">
                <span className="w-1 bg-teal rounded-full animate-[pulse_0.8s_ease-in-out_infinite] h-4" />
                <span className="w-1 bg-cyan-400 rounded-full animate-[pulse_0.6s_ease-in-out_infinite_0.2s] h-6" />
                <span className="w-1 bg-teal rounded-full animate-[pulse_0.9s_ease-in-out_infinite_0.4s] h-3" />
                <span className="w-1 bg-indigo-400 rounded-full animate-[pulse_0.7s_ease-in-out_infinite_0.1s] h-5" />
              </div>
            ) : (
              <FileText className="w-8 h-8 text-teal animate-pulse" />
            )}
          </div>
        </div>
      </div>

      {/* Dynamic Animated Status Text with Smooth Cross-Fade */}
      <div className="min-h-[58px] flex flex-col items-center justify-center gap-1.5 px-4">
        <h4 className="text-paper text-sm sm:text-base font-semibold tracking-wide flex items-center gap-2 transition-all duration-300">
          <Sparkles className="w-4 h-4 text-teal animate-spin" />
          <span>{currentStep.title}</span>
        </h4>
        <p className="text-dim text-xs leading-relaxed max-w-xs transition-opacity duration-300">
          {currentStep.desc}
        </p>
      </div>

      {/* Sleek Gradient Shimmer Progress Bar */}
      <div className="w-52 h-1.5 bg-surface2/80 rounded-full overflow-hidden border border-line/50 relative my-4 shadow-inner">
        <div className="h-full bg-gradient-to-r from-teal via-cyan-400 to-indigo-500 rounded-full animate-shimmer-slide w-2/5" />
      </div>

      {/* File Info Pill */}
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface2/70 border border-line text-[11px] text-dim backdrop-blur-sm max-w-full">
        <span className="truncate max-w-[180px] text-paper/90 font-medium">{fileName}</span>
        {fileSize !== undefined && <span>• {formatBytes(fileSize)}</span>}
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal/15 text-teal border border-teal/30">
          {type === "heic" ? "Apple HEIC" : type === "encrypted" ? "AES-256" : "Telegram Cloud"}
        </span>
      </div>
    </div>
  );
}

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

  const isHeic =
    /\.(heic|heif)$/i.test(file.name) ||
    file.mimeType === "image/heic" ||
    file.mimeType === "image/heif";
  const isImage = file.mimeType.startsWith("image/") || isHeic;
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
    setBlobUrl(null);
  }, [file.id]);

  // Smart Preloading for next & previous images/thumbnails
  useEffect(() => {
    if (!files || activeIndex < 0) return;
    const neighbors = [activeIndex + 1, activeIndex + 2, activeIndex - 1];
    neighbors.forEach((idx) => {
      const neighbor = files[idx];
      if (neighbor) {
        const neighborIsHeic =
          /\.(heic|heif)$/i.test(neighbor.name) ||
          neighbor.mimeType === "image/heic" ||
          neighbor.mimeType === "image/heif";
        // Preload next image high resolution preview
        if ((neighbor.mimeType.startsWith("image/") || neighborIsHeic) && !neighbor.encrypted) {
          const preImg = new Image();
          preImg.src = neighborIsHeic
            ? api.filePreviewUrl(neighbor.id, password, true)
            : api.fileUrl(neighbor.id, password, true);
        }
        // Preload thumbnail for image/video
        if (neighbor.mimeType.startsWith("image/") || neighbor.mimeType.startsWith("video/") || neighborIsHeic) {
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

    (async () => {
      try {
        const res = await fetch(api.fileUrl(file.id, password), {
          headers: { Authorization: `Bearer ${localStorage.getItem("telecloud_token")}` },
        });
        if (!res.ok) throw new Error("Failed to load text file");
        const text = await res.text();
        if (!cancelled) {
          setTextContent(text);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load text preview");
        }
      } finally {
        if (!cancelled) {
          setIsTextLoading(false);
        }
      }
    })();

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
  // Dedicated high-resolution preview URL (server converts HEIC to standard JPEG on-the-fly)
  const previewUrl = isHeic ? api.filePreviewUrl(file.id, password, true) : directStreamUrl;
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
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-dim hover:text-paper hover:bg-surface2 rounded-lg transition-colors hidden sm:flex items-center justify-center"
              title="Open preview in new tab"
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
        <div className="w-full flex-1 flex flex-col items-center justify-center relative min-h-[360px] max-h-[82vh] overflow-hidden rounded-2xl bg-black/60 border border-line shadow-2xl p-2 sm:p-4">
          {error && (
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
              <AlertCircle className="w-10 h-10 text-danger mb-3" />
              <p className="text-danger text-sm font-medium mb-1">{error}</p>
              <p className="text-dim text-xs mb-4">The file could not be rendered inline.</p>
              <a
                href={directStreamUrl}
                download={file.name}
                className="px-4 py-2 bg-teal text-ink font-semibold rounded-lg text-xs hover:opacity-90 transition-opacity flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Download File</span>
              </a>
            </div>
          )}

          {/* IMAGE & APPLE HEIC PREVIEW */}
          {isImage && !error && (
            <div className="relative flex items-center justify-center w-full h-full max-h-[80vh] overflow-hidden">
              {/* Holographic scanner sweep over frame */}
              {!imageLoaded && (
                <div className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-teal/15 to-transparent pointer-events-none animate-scan z-10" />
              )}

              {/* Blurred thumbnail backdrop for instant visual feedback */}
              {cachedThumbUrl && (
                <img
                  key={`thumb-${file.id}`}
                  src={cachedThumbUrl}
                  alt=""
                  aria-hidden="true"
                  className={`absolute inset-0 w-full h-full object-contain filter blur-md scale-95 transition-opacity duration-300 pointer-events-none ${
                    imageLoaded ? "opacity-0" : "opacity-45"
                  }`}
                />
              )}

              {/* Engaging Futuristic Cosmic Loader while high-res master converts/loads */}
              {!imageLoaded && (
                <InterestingLoader
                  type={isHeic ? "heic" : file.encrypted ? "encrypted" : "image"}
                  fileName={file.name}
                  fileSize={file.size}
                />
              )}

              {/* Native full-resolution image / converted HEIC JPEG streams directly */}
              <img
                key={`full-${file.id}-${blobUrl ? "blob" : "stream"}`}
                src={blobUrl || previewUrl}
                alt={file.name}
                onLoad={() => setImageLoaded(true)}
                onError={async () => {
                  // If server preview fails for HEIC, attempt client-side fallback with multiple: true
                  if (isHeic && !blobUrl) {
                    try {
                      const res = await fetch(api.fileUrl(file.id, password), {
                        headers: { Authorization: `Bearer ${localStorage.getItem("telecloud_token")}` },
                      });
                      if (!res.ok) throw new Error("Failed to fetch image");
                      const blob = await res.blob();
                      const mod: any = await import("heic2any");
                      const heic2any = typeof mod === "function" ? mod : (mod.default || mod);
                      const converted = await heic2any({
                        blob,
                        toType: "image/jpeg",
                        quality: 0.88,
                        multiple: true,
                      });
                      const resultBlob = Array.isArray(converted) ? converted[0] : converted;
                      const fallbackUrl = URL.createObjectURL(resultBlob);
                      setBlobUrl(fallbackUrl);
                      return;
                    } catch (fallbackErr) {
                      console.warn("Client fallback also failed:", fallbackErr);
                    }
                  }
                  setImageLoaded(true);
                  setError("Failed to render image");
                }}
                className={`max-h-[78vh] sm:max-h-[80vh] max-w-full rounded-lg object-contain transition-opacity duration-300 z-10 shadow-2xl ${
                  imageLoaded ? "opacity-100" : "opacity-0 absolute pointer-events-none"
                }`}
              />
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
                  <InterestingLoader
                    type="encrypted"
                    fileName={file.name}
                    fileSize={file.size}
                  />
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
                  <InterestingLoader
                    type="encrypted"
                    fileName={file.name}
                    fileSize={file.size}
                  />
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
                  <div className="flex flex-col items-center justify-center h-full bg-surface">
                    <InterestingLoader
                      type="encrypted"
                      fileName={file.name}
                      fileSize={file.size}
                    />
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
                <InterestingLoader
                  type="text"
                  fileName={file.name}
                  fileSize={file.size}
                />
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
