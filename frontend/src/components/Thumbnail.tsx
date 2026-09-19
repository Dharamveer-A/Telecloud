import { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";

interface ThumbnailProps {
  fileId: string;
  mimeType: string;
  password?: string;
}

export default function Thumbnail({ fileId, mimeType, password }: ThumbnailProps) {
  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");

  if (!isImage && !isVideo) return null;

  const [isVisible, setIsVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      { rootMargin: "250px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [fileId]);

  const thumbUrl = isVisible ? api.thumbnailUrl(fileId, password) : undefined;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden flex items-center justify-center">
      {thumbUrl && !error && (
        <img
          src={thumbUrl}
          alt=""
          loading="lazy"
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
