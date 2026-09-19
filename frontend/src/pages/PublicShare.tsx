import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api, saveBlob, TransferProgress } from "../lib/api";

function formatBytes(n: number) {
  if (!n || n < 1024) return `${n || 0} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function iconFor(mime?: string, isFolder?: boolean) {
  if (isFolder) return "📁";
  if (!mime) return "📦";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("zip") || mime.includes("archive") || mime.includes("tar")) return "🗜️";
  return "📦";
}

export default function PublicShare() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [shareData, setShareData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  // Password unlock
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // Download state
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<TransferProgress | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    async function load() {
      setLoading(true);
      setError(null);
      setIsExpired(false);
      try {
        const data = await api.getPublicShare(token!);
        setShareData(data);
        if (!data.requiresPassword) {
          setUnlocked(true);
        }
      } catch (err: any) {
        if (err.status === 410 || err.expired) {
          setIsExpired(true);
        } else {
          setError(err.message || "Failed to load shared item");
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !password) return;
    setVerifying(true);
    setPasswordError("");
    try {
      await api.verifyPublicSharePassword(token, password);
      setUnlocked(true);
    } catch (err: any) {
      setPasswordError(err.message || "Incorrect password");
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = async () => {
    if (!token || !shareData) return;
    setDownloading(true);
    setDownloadProgress({ loaded: 0, total: shareData.size || 0, percent: 0, speed: "0 B/s" });

    try {
      const filename =
        shareData.targetType === "folder"
          ? `${shareData.name}.zip`
          : shareData.name;

      const blob = await api.downloadPublicShareWithProgress(
        token,
        password || undefined,
        (p) => setDownloadProgress(p)
      );

      saveBlob(blob, filename);
    } catch (err: any) {
      alert(err.message || "Download failed. Please try again.");
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  const isVideo = shareData?.mimeType?.startsWith("video/");
  const isAudio = shareData?.mimeType?.startsWith("audio/");
  const isImage = shareData?.mimeType?.startsWith("image/");
  const isPdf = shareData?.mimeType === "application/pdf";
  const canPreview = unlocked && shareData?.targetType === "file" && (isVideo || isAudio || isImage || isPdf);

  const mediaStreamUrl =
    token && unlocked
      ? api.publicShareDownloadUrl(token, password || undefined, false)
      : "";

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col selection:bg-teal selection:text-ink font-sans">
      {/* Header */}
      <header className="border-b border-line bg-surface/50 backdrop-blur sticky top-0 z-30 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">☁️</span>
          <span className="font-display font-bold tracking-tight text-paper text-lg">
            TeleCloud
          </span>
          <span className="text-xs bg-teal/10 text-teal border border-teal/20 px-2 py-0.5 rounded-full font-medium ml-1">
            Shared Link
          </span>
        </div>
        <button
          onClick={handleCopyLink}
          className="text-xs text-dim hover:text-paper bg-surface2 hover:bg-surface border border-line rounded px-3 py-1.5 transition-colors flex items-center gap-1.5 font-medium"
        >
          <span>{copied ? "✓" : "🔗"}</span>
          <span>{copied ? "Link Copied!" : "Copy Link"}</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {loading ? (
            <div className="bg-surface border border-line rounded-2xl p-12 text-center shadow-2xl space-y-4">
              <div className="w-10 h-10 border-2 border-teal border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-dim text-sm">Loading shared item...</p>
            </div>
          ) : isExpired ? (
            <div className="bg-surface border border-line rounded-2xl p-10 text-center shadow-2xl space-y-4">
              <div className="w-16 h-16 bg-danger/10 text-danger rounded-2xl flex items-center justify-center text-3xl mx-auto border border-danger/20">
                ⏳
              </div>
              <h1 className="font-display text-2xl font-bold text-paper">Link Expired</h1>
              <p className="text-sm text-dim max-w-md mx-auto">
                This share link has expired and is no longer accessible. Please ask the sender to generate a new share link.
              </p>
            </div>
          ) : error ? (
            <div className="bg-surface border border-line rounded-2xl p-10 text-center shadow-2xl space-y-4">
              <div className="w-16 h-16 bg-surface2 text-dim rounded-2xl flex items-center justify-center text-3xl mx-auto border border-line">
                🔍
              </div>
              <h1 className="font-display text-2xl font-bold text-paper">Item Not Found</h1>
              <p className="text-sm text-dim max-w-md mx-auto">
                {error}. This link may have been revoked or the file may have been moved or deleted.
              </p>
            </div>
          ) : !unlocked ? (
            /* Password Protection Gate */
            <div className="bg-surface border border-line rounded-2xl p-8 shadow-2xl max-w-md mx-auto space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 bg-brass/10 text-brass rounded-2xl flex items-center justify-center text-2xl mx-auto border border-brass/20">
                  🔒
                </div>
                <h1 className="font-display text-xl font-bold text-paper">Password Protected</h1>
                <p className="text-xs text-dim">
                  This shared {shareData.targetType} is protected with a password. Enter the password below to access it.
                </p>
              </div>

              <form onSubmit={handleVerifyPassword} className="space-y-4">
                {passwordError && (
                  <div className="bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2 rounded-md text-center">
                    {passwordError}
                  </div>
                )}

                <div>
                  <input
                    type="password"
                    autoFocus
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-surface2 border border-line rounded-lg px-3.5 py-2.5 text-sm text-paper focus:outline-none focus:border-teal"
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifying || !password}
                  className="w-full bg-teal text-ink font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
                >
                  {verifying ? (
                    <>
                      <span className="w-4 h-4 border-2 border-ink border-t-transparent rounded-full animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Unlock & View"
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* Unlocked Shared Item View */
            <div className="bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden divide-y divide-line">
              {/* Hero Item Details */}
              <div className="p-8 space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-surface2 border border-line flex items-center justify-center text-3xl shrink-0 shadow-inner">
                    {iconFor(shareData.mimeType, shareData.targetType === "folder")}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h1 className="font-display text-2xl font-bold text-paper break-words leading-tight">
                      {shareData.name}
                    </h1>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-dim">
                      {shareData.targetType === "folder" ? (
                        <>
                          <span className="bg-surface2 px-2 py-0.5 rounded text-paper font-medium">
                            📁 {shareData.fileCount || 0} files
                          </span>
                          {shareData.folderCount > 0 && (
                            <span className="bg-surface2 px-2 py-0.5 rounded text-paper font-medium">
                              📂 {shareData.folderCount} subfolders
                            </span>
                          )}
                          <span>•</span>
                          <span>{formatBytes(shareData.totalSize || 0)}</span>
                        </>
                      ) : (
                        <>
                          <span className="bg-surface2 px-2 py-0.5 rounded text-paper font-medium">
                            {formatBytes(shareData.size || 0)}
                          </span>
                          {shareData.mimeType && (
                            <>
                              <span>•</span>
                              <span className="truncate max-w-[200px]">{shareData.mimeType}</span>
                            </>
                          )}
                        </>
                      )}

                      <span>•</span>
                      <span>
                        Shared {new Date(shareData.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Inline Media Preview */}
                {canPreview && (
                  <div className="rounded-xl overflow-hidden bg-surface2/60 border border-line">
                    {isVideo && (
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        src={mediaStreamUrl}
                        className="w-full max-h-[480px] bg-black"
                      />
                    )}

                    {isAudio && (
                      <div className="p-6 flex flex-col items-center justify-center gap-3">
                        <span className="text-4xl">🎵</span>
                        <audio controls preload="metadata" src={mediaStreamUrl} className="w-full max-w-md" />
                      </div>
                    )}

                    {isImage && (
                      <div className="p-4 flex items-center justify-center bg-black/40">
                        <img
                          src={mediaStreamUrl}
                          alt={shareData.name}
                          className="max-h-[500px] object-contain rounded"
                        />
                      </div>
                    )}

                    {isPdf && (
                      <iframe
                        src={mediaStreamUrl}
                        title={shareData.name}
                        className="w-full h-[500px] border-0"
                      />
                    )}
                  </div>
                )}

                {/* Download Status / Progress */}
                {downloading && downloadProgress && (
                  <div className="bg-surface2/80 border border-line rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-paper flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                        Downloading...
                      </span>
                      <div className="flex items-center gap-3 text-dim font-mono">
                        <span>{downloadProgress.speed}</span>
                        <span>{downloadProgress.percent}%</span>
                      </div>
                    </div>

                    <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal transition-all duration-200"
                        style={{ width: `${downloadProgress.percent}%` }}
                      />
                    </div>

                    <div className="text-[11px] text-dim flex justify-between">
                      <span>{formatBytes(downloadProgress.loaded)}</span>
                      <span>{formatBytes(downloadProgress.total)}</span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex-1 bg-teal hover:opacity-90 disabled:opacity-50 text-ink font-semibold rounded-xl py-3 px-6 text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-teal/10 cursor-pointer"
                  >
                    <span>⬇️</span>
                    <span>
                      {shareData.targetType === "folder" ? "Download as ZIP" : "Download File"}
                    </span>
                    <span className="opacity-75 font-normal text-xs">
                      ({formatBytes(shareData.targetType === "folder" ? shareData.totalSize : shareData.size)})
                    </span>
                  </button>

                  <a
                    href={api.publicShareDownloadUrl(token!, password || undefined, true)}
                    download={shareData.name}
                    className="sm:w-auto px-5 py-3 rounded-xl border border-line bg-surface2 hover:bg-surface text-paper text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                    title="Direct browser download fallback"
                  >
                    Direct Download
                  </a>
                </div>
              </div>

              {/* Footer Metadata Info */}
              <div className="px-8 py-4 bg-surface2/30 flex flex-wrap items-center justify-between gap-3 text-xs text-dim">
                <div className="flex items-center gap-4">
                  <span>📥 {shareData.downloadsCount || 0} downloads</span>
                  {shareData.expiresAt && (
                    <span>
                      ⏱️ Expires{" "}
                      {new Date(shareData.expiresAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>

                <div className="text-[11px] opacity-70">
                  Powered by TeleCloud • Telegram as Unlimited Cloud Storage
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
