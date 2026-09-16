import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function PreviewModal({
  file,
  password,
  onClose,
}: {
  file: { id: string; name: string; mimeType: string; encrypted?: boolean };
  password?: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  const isImage = file.mimeType.startsWith("image/");
  const isVideo = file.mimeType.startsWith("video/");
  const isAudio = file.mimeType.startsWith("audio/");
  const isPdf = file.mimeType === "application/pdf";

  // Video/audio in unlocked folders stream natively - the browser makes
  // its own Range requests to the backend, so playback starts immediately
  // and seeking works, even on very large files, without ever holding the
  // whole thing in memory here. Encrypted files can't be range-sliced
  // safely (see the route's comment), so they fall back to a full fetch.
  const canStreamNatively = (isVideo || isAudio) && !file.encrypted;

  useEffect(() => {
    if (canStreamNatively) return; // native <video>/<audio> src handles it directly
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
        setError(e.message);
      }
    })();
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [file.id]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="max-w-4xl w-full max-h-full flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-full flex items-center justify-between mb-3">
          <span className="text-paper text-sm truncate">{file.name}</span>
          <div className="flex gap-3 items-center">
            {(blobUrl || canStreamNatively) && (
              <a
                href={canStreamNatively ? api.fileUrl(file.id, password, true) : blobUrl!}
                download={file.name}
                className="text-teal text-sm"
              >
                Download
              </a>
            )}
            <button onClick={onClose} className="text-dim hover:text-paper text-sm">Close</button>
          </div>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}
        {!error && !blobUrl && !canStreamNatively && <p className="text-dim text-sm">Loading preview…</p>}

        {canStreamNatively && isVideo && (
          <video
            src={api.fileUrl(file.id, password, true)}
            controls
            autoPlay
            className="max-h-[80vh] rounded border border-line"
          />
        )}
        {canStreamNatively && isAudio && (
          <audio src={api.fileUrl(file.id, password, true)} controls className="w-full" />
        )}

        {!canStreamNatively && blobUrl && isImage && <img src={blobUrl} className="max-h-[80vh] rounded border border-line" />}
        {!canStreamNatively && blobUrl && isVideo && <video src={blobUrl} controls autoPlay className="max-h-[80vh] rounded border border-line" />}
        {!canStreamNatively && blobUrl && isAudio && <audio src={blobUrl} controls className="w-full" />}
        {blobUrl && isPdf && <iframe src={blobUrl} className="w-full h-[80vh] bg-white rounded" />}
        {blobUrl && !isImage && !isVideo && !isAudio && !isPdf && (
          <p className="text-dim text-sm">No inline preview for this file type — use Download above.</p>
        )}
        {!file.encrypted && (isVideo) && (
          <p className="text-dim text-xs mt-2">Streaming directly — seeking works even on large files.</p>
        )}
        {file.encrypted && (isVideo || isAudio) && (
          <p className="text-dim text-xs mt-2">This file is in a locked folder, so it has to fully download before playing (no seeking-ahead until it's loaded).</p>
        )}
      </div>
    </div>
  );
}
