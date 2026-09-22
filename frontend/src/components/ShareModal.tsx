import React, { useState, useEffect } from "react";
import { api } from "../lib/api";

export interface ShareTargetItem {
  kind: "file" | "folder";
  id: string;
  name: string;
  locked?: boolean;
  size?: number;
  mimeType?: string;
}

interface Props {
  item: ShareTargetItem;
  folderPassword?: string;
  onClose: () => void;
}

export default function ShareModal({ item, folderPassword, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [existingShare, setExistingShare] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  // Tunnel state
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [useWorldwideLink, setUseWorldwideLink] = useState(true);

  // Create form state
  const [expiresIn, setExpiresIn] = useState<number | null>(24); // 24 hours default
  const [usePassword, setUsePassword] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [fPassword, setFPassword] = useState(folderPassword || "");
  const [shareMode, setShareMode] = useState<"preview_and_zip" | "zip_only">("preview_and_zip");

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [shareRes, tunnelRes] = await Promise.all([
          api.getShareForTarget(item.id).catch(() => ({ share: null })),
          api.getTunnelStatus().catch(() => ({ active: false, url: null })),
        ]);

        if (shareRes.share) {
          setExistingShare(shareRes.share);
        }

        if (tunnelRes.url) {
          setTunnelUrl(tunnelRes.url);
        }
      } catch (err: any) {
        console.error("Failed to load share data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [item.id]);

  const handleStartTunnel = async () => {
    setTunnelLoading(true);
    setError("");
    try {
      const res = await api.startTunnel();
      if (res.url) {
        setTunnelUrl(res.url);
        setUseWorldwideLink(true);
      }
    } catch (err: any) {
      setError("Failed to create public tunnel: " + (err.message || ""));
    } finally {
      setTunnelLoading(false);
    }
  };

  const effectiveOrigin =
    useWorldwideLink && tunnelUrl ? tunnelUrl : window.location.origin;

  const shareUrl = existingShare
    ? `${effectiveOrigin}/share/${existingShare.token}`
    : "";

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCreate = async () => {
    setError("");
    if (usePassword && (!sharePassword.trim() || sharePassword.length < 4)) {
      setError("Password must be at least 4 characters.");
      return;
    }

    setCreating(true);
    try {
      const res = await api.createShare({
        targetType: item.kind,
        targetId: item.id,
        expiresInHours: expiresIn,
        password: usePassword ? sharePassword.trim() : undefined,
        folderPassword: item.locked ? fPassword : undefined,
        shareMode: item.kind === "folder" ? shareMode : undefined,
      });
      setExistingShare(res.share);

      // If tunnel is not active yet, trigger it automatically so they get a public link
      if (!tunnelUrl) {
        handleStartTunnel().catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || "Failed to create share link");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!existingShare) return;
    if (
      !confirm(
        "Revoke this public link? Anyone with the link will lose access immediately."
      )
    )
      return;
    try {
      await api.revokeShare(existingShare.id);
      setExistingShare(null);
      setSharePassword("");
      setUsePassword(false);
    } catch (err: any) {
      alert(err.message || "Failed to revoke share link");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line rounded-xl w-full max-w-lg p-5 sm:p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-line mb-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{item.kind === "folder" ? "📁" : "📄"}</span>
            <div>
              <h2 className="font-display text-base font-semibold text-paper truncate max-w-[320px]">
                Share "{item.name}"
              </h2>
              <p className="text-xs text-dim">Generate a public link anyone can access worldwide</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-dim hover:text-paper p-1 rounded-md hover:bg-surface2 transition-colors"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-danger/10 border border-danger/30 text-danger text-xs px-3 py-2 rounded-md">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-dim text-sm flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-teal border-t-transparent rounded-full animate-spin" />
            Loading share details...
          </div>
        ) : existingShare ? (
          /* Active Share View */
          <div className="space-y-4">
            {/* Worldwide vs Local indicator */}
            <div className="flex items-center justify-between text-xs bg-surface2/40 border border-line/60 rounded-lg px-3 py-2">
              {tunnelUrl ? (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                  <span className="font-medium text-teal">
                    {useWorldwideLink ? "🌐 Worldwide Online Link (Active)" : "💻 Local Network Link"}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-dim">Local link only</span>
                </div>
              )}

              {tunnelUrl ? (
                <button
                  type="button"
                  onClick={() => setUseWorldwideLink(!useWorldwideLink)}
                  className="text-[11px] text-dim hover:text-paper underline"
                >
                  {useWorldwideLink ? "Use local link" : "Use worldwide link"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartTunnel}
                  disabled={tunnelLoading}
                  className="text-xs bg-teal text-ink font-semibold rounded px-2.5 py-1 hover:opacity-90 flex items-center gap-1 transition-opacity disabled:opacity-50"
                >
                  {tunnelLoading ? (
                    <>
                      <span className="w-3 h-3 border-2 border-ink border-t-transparent rounded-full animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      <span>Go Worldwide</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="bg-surface2/60 border border-line rounded-lg p-3.5 space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-dim block">
                {useWorldwideLink && tunnelUrl ? "Worldwide Share URL" : "Share URL"}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="w-full bg-surface border border-line rounded px-3 py-1.5 text-xs text-paper focus:outline-none select-all font-mono"
                />
                <button
                  onClick={handleCopy}
                  className={`shrink-0 px-3.5 py-1.5 rounded text-xs font-medium transition-all ${
                    copied
                      ? "bg-teal text-ink font-semibold"
                      : "bg-surface2 hover:bg-surface border border-line text-paper"
                  }`}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-surface2/40 border border-line/60 rounded-lg p-3">
                <span className="text-dim block text-[11px] mb-0.5">Status</span>
                {existingShare.isExpired ? (
                  <span className="text-danger font-medium flex items-center gap-1">
                    <span>⚠️</span> Expired
                  </span>
                ) : (
                  <span className="text-teal font-medium flex items-center gap-1">
                    <span>✓</span> Active
                  </span>
                )}
              </div>

              <div className="bg-surface2/40 border border-line/60 rounded-lg p-3">
                <span className="text-dim block text-[11px] mb-0.5">Protection</span>
                <span className="text-paper font-medium flex items-center gap-1">
                  {existingShare.hasPassword ? "🔒 Password required" : "🔓 Public (No password)"}
                </span>
              </div>

              <div className="bg-surface2/40 border border-line/60 rounded-lg p-3">
                <span className="text-dim block text-[11px] mb-0.5">Downloads</span>
                <span className="text-paper font-medium">
                  {existingShare.downloadsCount || 0} times
                </span>
              </div>

              <div className="bg-surface2/40 border border-line/60 rounded-lg p-3">
                <span className="text-dim block text-[11px] mb-0.5">Expires</span>
                <span className="text-paper font-medium">
                  {existingShare.expiresAt
                    ? new Date(existingShare.expiresAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Never"}
                </span>
              </div>

              {item.kind === "folder" && (
                <div className="col-span-2 bg-surface2/40 border border-line/60 rounded-lg p-2.5 flex items-center justify-between">
                  <span className="text-dim text-[11px]">Share Format</span>
                  <span className="text-paper font-medium text-xs">
                    {existingShare.shareMode === "zip_only" ? "🗜️ ZIP Download Only" : "👁️ Preview & ZIP"}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-between gap-3 border-t border-line mt-4">
              <button
                onClick={handleRevoke}
                className="text-xs text-danger hover:bg-danger/10 border border-danger/30 rounded px-3 py-1.5 transition-colors font-medium"
              >
                Revoke Link
              </button>

              <button
                onClick={onClose}
                className="text-xs bg-surface2 hover:bg-surface border border-line rounded px-4 py-1.5 text-paper font-medium"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Create Share View */
          <div className="space-y-4">
            {/* Worldwide status preview */}
            <div className="flex items-center justify-between text-xs bg-surface2/40 border border-line/60 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    tunnelUrl ? "bg-teal animate-pulse" : "bg-amber-400"
                  }`}
                />
                <span className="text-dim">
                  {tunnelUrl
                    ? "Worldwide link enabled"
                    : "Worldwide link will connect automatically"}
                </span>
              </div>
              {!tunnelUrl && (
                <button
                  type="button"
                  onClick={handleStartTunnel}
                  disabled={tunnelLoading}
                  className="text-xs text-teal hover:underline font-medium"
                >
                  {tunnelLoading ? "Connecting..." : "Connect now"}
                </button>
              )}
            </div>

            {item.kind === "folder" && (
              <div>
                <label className="text-xs font-semibold text-paper block mb-1.5">
                  Folder Share Format
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setShareMode("preview_and_zip")}
                    className={`py-2 px-3 rounded border text-left transition-colors flex flex-col gap-0.5 ${
                      shareMode === "preview_and_zip"
                        ? "bg-teal/20 border-teal text-teal font-medium"
                        : "bg-surface2 border-line text-dim hover:text-paper"
                    }`}
                  >
                    <span className="font-semibold text-xs flex items-center gap-1.5">
                      <span>👁️</span> Preview & ZIP
                    </span>
                    <span className="text-[10px] opacity-75">
                      Recipients can browse files, preview media, & download ZIP
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareMode("zip_only")}
                    className={`py-2 px-3 rounded border text-left transition-colors flex flex-col gap-0.5 ${
                      shareMode === "zip_only"
                        ? "bg-teal/20 border-teal text-teal font-medium"
                        : "bg-surface2 border-line text-dim hover:text-paper"
                    }`}
                  >
                    <span className="font-semibold text-xs flex items-center gap-1.5">
                      <span>🗜️</span> ZIP Only
                    </span>
                    <span className="text-[10px] opacity-75">
                      Direct single-click ZIP archive download
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-paper block mb-1.5">
                Link Expiration
              </label>
              <div className="grid grid-cols-4 gap-1.5 text-xs">
                {[
                  { label: "1 Hour", value: 1 },
                  { label: "24 Hours", value: 24 },
                  { label: "7 Days", value: 168 },
                  { label: "Never", value: null },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setExpiresIn(opt.value)}
                    className={`py-1.5 px-2 rounded border text-center transition-colors ${
                      expiresIn === opt.value
                        ? "bg-teal/20 border-teal text-teal font-medium"
                        : "bg-surface2 border-line text-dim hover:text-paper"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-line/60 rounded-lg p-3 bg-surface2/30 space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-paper">
                <input
                  type="checkbox"
                  checked={usePassword}
                  onChange={(e) => setUsePassword(e.target.checked)}
                  className="rounded border-line bg-surface text-teal focus:ring-teal"
                />
                Require password to access
              </label>

              {usePassword && (
                <input
                  type="password"
                  placeholder="Set recipient password (min 4 chars)"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                  className="w-full bg-surface border border-line rounded px-3 py-1.5 text-xs text-paper focus:outline-none focus:border-teal"
                  autoFocus
                />
              )}
            </div>

            {item.locked && !folderPassword && (
              <div className="border border-brass/30 bg-brass/10 rounded-lg p-3 space-y-2">
                <label className="text-xs font-semibold text-brass flex items-center gap-1">
                  <span>🔒</span> Unlock Folder to Share
                </label>
                <p className="text-[11px] text-dim">
                  This item is encrypted. Enter its folder password so TeleCloud can grant share access.
                </p>
                <input
                  type="password"
                  placeholder="Folder password"
                  value={fPassword}
                  onChange={(e) => setFPassword(e.target.value)}
                  className="w-full bg-surface border border-brass/40 rounded px-3 py-1.5 text-xs text-paper focus:outline-none focus:border-brass"
                />
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-line rounded px-3 py-2 text-xs text-dim hover:text-paper"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 bg-teal text-ink font-semibold rounded px-3 py-2 text-xs hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {creating ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-ink border-t-transparent rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Link"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
