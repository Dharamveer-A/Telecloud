import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api, saveBlob, TransferProgress } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";

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

function PublicFileThumbnail({
  token,
  fileId,
  mimeType,
  password,
}: {
  token: string;
  fileId: string;
  mimeType: string;
  password?: string;
}) {
  const isImage = mimeType?.startsWith("image/");
  const isVideo = mimeType?.startsWith("video/");
  if (!isImage && !isVideo) return <span className="text-2xl">{iconFor(mimeType)}</span>;

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const url = api.publicShareThumbnailUrl(token, fileId, password);

  if (error) return <span className="text-2xl">{iconFor(mimeType)}</span>;

  return (
    <div className="w-full h-full relative flex items-center justify-center overflow-hidden bg-surface2/40">
      <img
        src={url}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      {isVideo && loaded && (
        <div className="absolute bottom-1 right-1 bg-black/70 backdrop-blur-sm text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-0.5 font-medium pointer-events-none shadow">
          <span>▶</span>
        </div>
      )}
      {!loaded && <div className="absolute inset-0 bg-surface2/50 animate-pulse" />}
    </div>
  );
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

interface DownloadProgressState extends TransferProgress {
  percent: number;
  speed: string;
}

  // Download state
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null);
  const [copied, setCopied] = useState(false);

  // Folder contents & browsing
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [folderContents, setFolderContents] = useState<{
    currentFolder: { id: string; name: string; isRoot: boolean };
    breadcrumbs: { id: string; name: string }[];
    subfolders: any[];
    files: any[];
  } | null>(null);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [contentsError, setContentsError] = useState<string | null>(null);

  // File preview modal
  const [previewFile, setPreviewFile] = useState<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
  } | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

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

  // Fetch folder contents when unlocked and target is a folder with preview enabled
  useEffect(() => {
    if (!token || !unlocked || shareData?.targetType !== "folder" || shareData?.shareMode === "zip_only") return;
    let active = true;
    async function fetchContents() {
      setContentsLoading(true);
      setContentsError(null);
      try {
        const data = await api.getPublicShareContents(token!, currentFolderId, password || undefined);
        if (active) setFolderContents(data);
      } catch (err: any) {
        if (active) setContentsError(err.message || "Failed to load folder contents");
      } finally {
        if (active) setContentsLoading(false);
      }
    }
    fetchContents();
    return () => {
      active = false;
    };
  }, [token, unlocked, currentFolderId, shareData?.targetType, shareData?.shareMode, password]);

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

  const handleDownloadZip = async (targetFolderId?: string, folderName?: string) => {
    if (!token || !shareData) return;
    setDownloading(true);
    const targetSize = shareData.totalSize || shareData.size || 0;
    setDownloadProgress({
      loaded: 0,
      total: targetSize,
      bytesPerSecond: 0,
      etaSeconds: null,
      percent: 0,
      speed: "0 B/s",
    });

    try {
      const filename = `${folderName || folderContents?.currentFolder?.name || shareData.name}.zip`;

      const blob = await api.downloadPublicShareWithProgress(
        token,
        password || undefined,
        (p) => {
          const percent = p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
          setDownloadProgress({
            ...p,
            percent,
            speed: `${formatBytes(p.bytesPerSecond)}/s`,
          });
        },
        targetFolderId || currentFolderId
      );

      saveBlob(blob, filename);
    } catch (err: any) {
      alert(err.message || "Download failed. Please try again.");
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleDownloadSingleFile = (file: { id: string; name: string }) => {
    if (!token) return;
    const url = api.publicShareFileUrl(token, file.id, password || undefined, true);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const isVideo = shareData?.mimeType?.startsWith("video/");
  const isAudio = shareData?.mimeType?.startsWith("audio/");
  const isImage = shareData?.mimeType?.startsWith("image/");
  const isPdf = shareData?.mimeType === "application/pdf";
  const canPreviewSingleFile = unlocked && shareData?.targetType === "file" && (isVideo || isAudio || isImage || isPdf);

  const mediaStreamUrl =
    token && unlocked
      ? api.publicShareDownloadUrl(token, password || undefined, false)
      : "";

  const isFolderWithPreview =
    shareData?.targetType === "folder" && shareData?.shareMode !== "zip_only";

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col selection:bg-teal selection:text-ink font-sans">
      {/* Top Header */}
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
        <div className="flex items-center gap-2">
          {isFolderWithPreview && unlocked && (
            <button
              onClick={() => handleDownloadZip()}
              disabled={downloading}
              className="text-xs bg-teal text-ink font-semibold rounded px-3 py-1.5 hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
              title="Download entire folder as a ZIP archive"
            >
              <span>⬇️</span>
              <span className="hidden sm:inline">Download as ZIP</span>
              <span className="sm:hidden">ZIP</span>
            </button>
          )}
          <button
            onClick={handleCopyLink}
            className="text-xs text-dim hover:text-paper bg-surface2 hover:bg-surface border border-line rounded px-3 py-1.5 transition-colors flex items-center gap-1.5 font-medium"
          >
            <span>{copied ? "✓" : "🔗"}</span>
            <span>{copied ? "Copied!" : "Copy Link"}</span>
          </button>
          <ThemeToggle compact />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className={`w-full ${isFolderWithPreview && unlocked ? "max-w-5xl" : "max-w-2xl"}`}>
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
                {error}. This link may have been revoked or the item may have been moved or deleted.
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
          ) : isFolderWithPreview ? (
            /* ========================================================= */
            /* FOLDER PREVIEW & BROWSER VIEW (With ZIP download option)   */
            /* ========================================================= */
            <div className="bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden flex flex-col">
              {/* Folder Header & Breadcrumbs */}
              <div className="p-6 border-b border-line bg-surface2/40 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">📁</span>
                    <div>
                      <h1 className="font-display text-xl sm:text-2xl font-bold text-paper">
                        {folderContents?.currentFolder?.name || shareData.name}
                      </h1>
                      <p className="text-xs text-dim mt-0.5">
                        {shareData.fileCount || 0} files • {formatBytes(shareData.totalSize || 0)}
                        {shareData.folderCount > 0 && ` • ${shareData.folderCount} subfolders`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownloadZip()}
                      disabled={downloading}
                      className="bg-teal hover:opacity-90 disabled:opacity-50 text-ink font-semibold rounded-xl py-2.5 px-4 text-xs flex items-center gap-2 transition-all shadow-md shadow-teal/10"
                    >
                      <span>⬇️</span>
                      <span>Download as ZIP</span>
                      <span className="opacity-75 text-[11px] font-normal">
                        ({formatBytes(shareData.totalSize)})
                      </span>
                    </button>

                    {/* View mode toggle */}
                    <div className="flex items-center border border-line rounded-lg overflow-hidden bg-surface">
                      <button
                        onClick={() => setViewMode("grid")}
                        className={`p-2 text-xs transition-colors ${
                          viewMode === "grid" ? "bg-teal/20 text-teal font-bold" : "text-dim hover:text-paper"
                        }`}
                        title="Grid view"
                      >
                        ⊞
                      </button>
                      <button
                        onClick={() => setViewMode("list")}
                        className={`p-2 text-xs transition-colors ${
                          viewMode === "list" ? "bg-teal/20 text-teal font-bold" : "text-dim hover:text-paper"
                        }`}
                        title="List view"
                      >
                        ☰
                      </button>
                    </div>
                  </div>
                </div>

                {/* Breadcrumbs Navigation */}
                {folderContents?.breadcrumbs && folderContents.breadcrumbs.length > 1 && (
                  <div className="flex items-center gap-1.5 text-xs text-dim overflow-x-auto py-1">
                    {folderContents.breadcrumbs.map((crumb, idx) => {
                      const isLast = idx === folderContents.breadcrumbs.length - 1;
                      return (
                        <React.Fragment key={crumb.id}>
                          {idx > 0 && <span className="opacity-50">/</span>}
                          {isLast ? (
                            <span className="text-paper font-semibold">{crumb.name}</span>
                          ) : (
                            <button
                              onClick={() => setCurrentFolderId(idx === 0 ? undefined : crumb.id)}
                              className="text-teal hover:underline font-medium truncate max-w-[140px]"
                            >
                              {crumb.name}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Download Progress Bar */}
              {downloading && downloadProgress && (
                <div className="bg-surface2 border-b border-line p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-paper flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                      Creating and downloading ZIP archive...
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

              {/* Folder Browser Contents */}
              <div className="p-6 min-h-[300px]">
                {contentsLoading ? (
                  <div className="py-16 text-center text-dim text-sm space-y-3">
                    <div className="w-8 h-8 border-2 border-teal border-t-transparent rounded-full animate-spin mx-auto" />
                    <p>Loading files & folders...</p>
                  </div>
                ) : contentsError ? (
                  <div className="py-12 text-center text-danger text-sm">
                    {contentsError}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Subfolders Section */}
                    {folderContents?.subfolders && folderContents.subfolders.length > 0 && (
                      <div className="space-y-2.5">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-dim">
                          Folders ({folderContents.subfolders.length})
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                          {folderContents.subfolders.map((sub) => (
                            <div
                              key={sub.id}
                              onClick={() => setCurrentFolderId(sub.id)}
                              className="bg-surface2/50 hover:bg-surface2 border border-line rounded-xl p-3.5 flex items-center justify-between cursor-pointer transition-all hover:border-teal/50 group"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-2xl group-hover:scale-110 transition-transform">📁</span>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-paper truncate group-hover:text-teal transition-colors">
                                    {sub.name}
                                  </p>
                                  <p className="text-[11px] text-dim">
                                    {sub.fileCount || 0} items • {formatBytes(sub.totalSize || 0)}
                                  </p>
                                </div>
                              </div>
                              <span className="text-dim text-xs group-hover:text-teal transition-colors">➔</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Files Section */}
                    {folderContents?.files && folderContents.files.length > 0 ? (
                      <div className="space-y-2.5">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-dim">
                          Files ({folderContents.files.length})
                        </h2>

                        {viewMode === "grid" ? (
                          /* Grid View */
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {folderContents.files.map((file) => (
                              <div
                                key={file.id}
                                onClick={() => setPreviewFile(file)}
                                className="group bg-surface2/40 hover:bg-surface2/80 border border-line rounded-xl overflow-hidden cursor-pointer transition-all hover:border-teal/50 flex flex-col shadow-sm"
                              >
                                <div className="aspect-[4/3] w-full bg-surface2/60 relative flex items-center justify-center overflow-hidden">
                                  <PublicFileThumbnail
                                    token={token!}
                                    fileId={file.id}
                                    mimeType={file.mimeType}
                                    password={password}
                                  />
                                </div>
                                <div className="p-3 flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-paper truncate group-hover:text-teal transition-colors" title={file.name}>
                                      {file.name}
                                    </p>
                                    <p className="text-[10px] text-dim mt-0.5">
                                      {formatBytes(file.size)}
                                    </p>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownloadSingleFile(file);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-dim hover:text-teal p-1.5 rounded hover:bg-surface transition-all text-xs shrink-0"
                                    title="Download file"
                                  >
                                    ⬇️
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          /* List View */
                          <div className="border border-line rounded-xl overflow-hidden divide-y divide-line">
                            {folderContents.files.map((file) => (
                              <div
                                key={file.id}
                                onClick={() => setPreviewFile(file)}
                                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-surface2/60 cursor-pointer transition-colors group"
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <span className="text-xl shrink-0">{iconFor(file.mimeType)}</span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-paper truncate group-hover:text-teal transition-colors">
                                      {file.name}
                                    </p>
                                    <p className="text-[10px] text-dim">{formatBytes(file.size)}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewFile(file);
                                    }}
                                    className="text-xs text-dim hover:text-teal px-2 py-1 rounded hover:bg-surface transition-colors"
                                  >
                                    Preview
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownloadSingleFile(file);
                                    }}
                                    className="text-xs bg-surface2 hover:bg-surface border border-line text-paper px-2.5 py-1 rounded transition-colors"
                                  >
                                    Download
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      (!folderContents?.subfolders || folderContents.subfolders.length === 0) && (
                        <div className="py-16 text-center text-dim text-sm space-y-2">
                          <span className="text-4xl block">📂</span>
                          <p>This folder is empty</p>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Footer info */}
              <div className="px-6 py-3.5 bg-surface2/30 border-t border-line flex items-center justify-between text-xs text-dim">
                <span>📥 {shareData.downloadsCount || 0} downloads</span>
                <span className="text-[11px] opacity-70">
                  Powered by TeleCloud • Telegram as Unlimited Cloud Storage
                </span>
              </div>
            </div>
          ) : (
            /* ========================================================= */
            /* SINGLE FILE OR ZIP-ONLY FOLDER VIEW                       */
            /* ========================================================= */
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

                {/* Inline Media Preview for single file */}
                {canPreviewSingleFile && (
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
                    onClick={() => handleDownloadZip()}
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

      {/* Full-Screen File Preview Modal */}
      {previewFile && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-6"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="max-w-4xl w-full max-h-[90vh] flex flex-col bg-surface border border-line rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3 border-b border-line flex items-center justify-between bg-surface2 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 mr-3">
                <span className="text-xl shrink-0">{iconFor(previewFile.mimeType)}</span>
                <span className="text-paper text-sm font-medium truncate">{previewFile.name}</span>
                <span className="text-xs text-dim shrink-0">({formatBytes(previewFile.size)})</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleDownloadSingleFile(previewFile)}
                  className="text-xs bg-teal text-ink font-semibold rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <span>⬇️</span>
                  <span>Download</span>
                </button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="text-dim hover:text-paper p-1 rounded-md hover:bg-surface transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body with media renderers */}
            <div className="flex-1 p-4 flex items-center justify-center min-h-[300px] overflow-auto bg-black/50">
              {previewFile.mimeType.startsWith("video/") && (
                <video
                  controls
                  autoPlay
                  playsInline
                  src={api.publicShareFileUrl(token!, previewFile.id, password || undefined, false)}
                  className="max-h-[70vh] max-w-full rounded shadow-lg"
                />
              )}
              {previewFile.mimeType.startsWith("audio/") && (
                <div className="p-8 flex flex-col items-center gap-4">
                  <span className="text-6xl animate-bounce">🎵</span>
                  <audio
                    controls
                    autoPlay
                    src={api.publicShareFileUrl(token!, previewFile.id, password || undefined, false)}
                    className="w-full max-w-md"
                  />
                </div>
              )}
              {previewFile.mimeType.startsWith("image/") && (
                <img
                  src={api.publicShareFileUrl(token!, previewFile.id, password || undefined, false)}
                  alt={previewFile.name}
                  className="max-h-[70vh] max-w-full object-contain rounded shadow-lg"
                />
              )}
              {previewFile.mimeType === "application/pdf" && (
                <iframe
                  src={api.publicShareFileUrl(token!, previewFile.id, password || undefined, false)}
                  title={previewFile.name}
                  className="w-full h-[70vh] border-0 rounded bg-white"
                />
              )}
              {!previewFile.mimeType.startsWith("video/") &&
                !previewFile.mimeType.startsWith("audio/") &&
                !previewFile.mimeType.startsWith("image/") &&
                previewFile.mimeType !== "application/pdf" && (
                  <div className="text-center py-12 space-y-3">
                    <span className="text-5xl block">📦</span>
                    <p className="text-paper font-medium text-sm">{previewFile.name}</p>
                    <p className="text-xs text-dim">No inline preview available for this file type.</p>
                    <button
                      onClick={() => handleDownloadSingleFile(previewFile)}
                      className="bg-teal text-ink font-semibold rounded-lg px-4 py-2 text-xs hover:opacity-90"
                    >
                      Download File ({formatBytes(previewFile.size)})
                    </button>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
