import { useState, useEffect } from "react";
import { Key, Copy, Check, ExternalLink, X, ShieldCheck, Loader2 } from "lucide-react";
import { api } from "../lib/api";

interface PersistenceModalProps {
  onClose: () => void;
}

export default function PersistenceModal({ onClose }: PersistenceModalProps) {
  const [session, setSession] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getBootstrapSession()
      .then((data: any) => {
        if (!cancelled) {
          setSession(data.bootstrapSession || "");
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err.message || "Failed to load session key");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = () => {
    if (!session) return;
    navigator.clipboard.writeText(session);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-surface border border-line rounded-2xl p-5 sm:p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-4 text-paper"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal/15 border border-teal/30 flex items-center justify-center text-teal">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-paper">Stay Logged In on Render</h3>
              <p className="text-xs text-dim">Prevent verification prompts on updates</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-dim hover:text-paper hover:bg-surface2 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Explanation */}
        <div className="text-xs text-dim leading-relaxed space-y-2">
          <p>
            Render&apos;s free tier uses an <strong>ephemeral disk</strong> that wipes when Render updates or restarts.
          </p>
          <p>
            To prevent your browser from asking for your phone number and verification code every time Render updates, add your session key to Render&apos;s Environment variables once:
          </p>
        </div>

        {/* Steps */}
        <div className="bg-surface2/60 border border-line rounded-xl p-3.5 space-y-2.5 text-xs">
          <div className="flex items-start gap-2">
            <span className="font-mono bg-teal/20 text-teal px-1.5 py-0.5 rounded text-[11px] font-bold">1</span>
            <span className="text-paper">
              Copy your encrypted session key below:
            </span>
          </div>

          {loading ? (
            <div className="py-4 flex items-center justify-center gap-2 text-dim text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-teal" />
              <span>Fetching session key…</span>
            </div>
          ) : error ? (
            <p className="text-danger text-xs">{error}</p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={session}
                className="flex-1 bg-surface border border-line rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-dim select-all focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 bg-teal text-ink font-semibold rounded-lg text-xs flex items-center gap-1.5 hover:opacity-90 transition-opacity shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied!" : "Copy"}</span>
              </button>
            </div>
          )}

          <div className="flex items-start gap-2 pt-1">
            <span className="font-mono bg-teal/20 text-teal px-1.5 py-0.5 rounded text-[11px] font-bold">2</span>
            <div className="text-paper">
              Open{" "}
              <a
                href="https://dashboard.render.com"
                target="_blank"
                rel="noreferrer"
                className="text-teal hover:underline inline-flex items-center gap-0.5"
              >
                Render Dashboard <ExternalLink className="w-3 h-3" />
              </a>{" "}
              ➔ your <strong>telecloud</strong> service ➔ <strong>Environment</strong> tab.
            </div>
          </div>

          <div className="flex items-start gap-2">
            <span className="font-mono bg-teal/20 text-teal px-1.5 py-0.5 rounded text-[11px] font-bold">3</span>
            <span className="text-paper">
              Add or edit variable:
              <br />
              <code className="text-teal font-mono font-semibold">BOOTSTRAP_TELEGRAM_SESSION</code> = <span className="text-dim">(paste key)</span>
            </span>
          </div>

          <div className="flex items-start gap-2">
            <span className="font-mono bg-teal/20 text-teal px-1.5 py-0.5 rounded text-[11px] font-bold">4</span>
            <span className="text-paper">
              Click <strong>Save Changes</strong>. You are all set forever!
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-teal flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Encrypted with your master key</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface2 text-xs font-medium text-paper transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
