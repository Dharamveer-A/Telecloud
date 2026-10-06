import { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";

interface ThumbnailProps {
  fileId: string;
  mimeType: string;
  password?: string;
}

// Module-level cache for blob object URLs so re-renders/navigation reuse cached images instantly
const thumbBlobCache = new Map<string, string>();
const failedThumbSet = new Set<string>();

export default function Thumbnail({ fileId, mimeType, password }: ThumbnailProps) {
  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");

  if (!isImage && !isVideo) return null;

  const [isVisible, setIsVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(() => thumbBlobCache.get(fileId) || null);
  const [loaded, setLoaded] = useState(() => thumbBlobCache.has(fileId));
  const [error, setError] = useState(() => failedThumbSet.has(fileId));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // If already cached or marked as failed, no need to observe
    if (thumbBlobCache.has(fileId)) {
      setSrc(thumbBlobCache.get(fileId)!);
      setLoaded(true);
      return;
    }
    if (failedThumbSet.has(fileId)) {
      setError(true);
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    if (!("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [fileId]);

  useEffect(() => {
    if (!isVisible || thumbBlobCache.has(fileId) || failedThumbSet.has(fileId)) return;

    const controller = new AbortController();
    const url = api.thumbnailUrl(fileId, password);

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        thumbBlobCache.set(fileId, objectUrl);
        setSrc(objectUrl);
        setLoaded(true);
      })
      .catch((err) => {
        if (err.name === "AbortError" || controller.signal.aborted) {
          return; // Cancelled intentionally because component unmounted or was navigated away
        }
        failedThumbSet.add(fileId);
        setError(true);
      });

    return () => {
      // Abort in-flight network request immediately when navigating away or unmounting!
      controller.abort();
    };
  }, [isVisible, fileId, password]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden flex items-center justify-center">
      {src && !error && (
        <img
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      {/* Video Indicator Overlay */}
      {isVideo && loaded && !error && (
        <div className="absolute bottom-1 right-1 bg-black/70 backdrop-blur-sm text-white text-[9px] px-1 py-0.5 rounded flex items-center gap-0.5 font-medium pointer-events-none shadow">
          <span>▶</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {isVisible && !loaded && !error && (
        <div className="absolute inset-0 bg-surface2/50 animate-pulse" />
      )}
    </div>
  );
}
