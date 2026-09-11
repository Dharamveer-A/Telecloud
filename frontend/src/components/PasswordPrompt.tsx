import { useState } from "react";

export default function PasswordPrompt({
  folderName,
  onSubmit,
  onCancel,
  error,
}: {
  folderName: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
  error?: string;
}) {
  const [password, setPassword] = useState("");
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-6">
      <div className="bg-surface border border-line rounded w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9A24B" strokeWidth="2">
            <rect x="4" y="10" width="16" height="10" rx="1" />
            <path d="M8 10V7a4 4 0 018 0v3" />
          </svg>
          <h2 className="font-display text-lg text-paper">{folderName}</h2>
        </div>
        <p className="text-sm text-dim mb-4">This folder is locked. Enter its password to continue.</p>
        <input
          autoFocus
          type="password"
          className="w-full bg-surface2 border border-line rounded px-3 py-2 text-paper focus:outline-none focus:border-brass"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(password)}
        />
        {error && <p className="text-danger text-sm mt-2">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 border border-line rounded px-3 py-2 text-dim hover:text-paper">Cancel</button>
          <button onClick={() => onSubmit(password)} className="flex-1 bg-brass text-ink rounded px-3 py-2 font-medium">Unlock</button>
        </div>
      </div>
    </div>
  );
}
