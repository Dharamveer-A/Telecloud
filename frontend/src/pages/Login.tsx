import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";

type Step = "phone" | "code" | "password";

export default function Login() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setError(""); setBusy(true);
    try {
      await api.requestCode(phone);
      setStep("code");
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function verifyCode() {
    setError(""); setBusy(true);
    try {
      const res: any = await api.verifyCode(phone, code);
      if (res.status === "need_password") {
        setStep("password");
      } else {
        setToken(res.token);
        nav("/");
      }
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function verifyPassword() {
    setError(""); setBusy(true);
    try {
      const res: any = await api.verifyPassword(phone, password);
      setToken(res.token);
      nav("/");
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <h1 className="font-display text-4xl text-paper mb-2">TeleCloud</h1>
          <p className="text-dim text-sm leading-relaxed">
            A private archive built on your own Telegram account. Sign in with your phone number to continue.
          </p>
        </div>

        {step === "phone" && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-xs text-dim uppercase tracking-wide">Phone number</span>
              <input
                className="mt-1 w-full bg-surface border border-line rounded px-3 py-2.5 text-paper placeholder:text-dim/60 focus:outline-none focus:border-teal"
                placeholder="+1 555 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
              />
            </label>
            <button onClick={sendCode} disabled={busy || !phone} className="w-full bg-teal text-ink font-medium rounded px-3 py-2.5 disabled:opacity-40">
              {busy ? "Sending…" : "Send code"}
            </button>
          </div>
        )}

        {step === "code" && (
          <div className="space-y-4">
            <p className="text-sm text-dim">Enter the code sent to your Telegram app for {phone}.</p>
            <input
              className="w-full bg-surface border border-line rounded px-3 py-2.5 text-paper tracking-[0.3em] text-center focus:outline-none focus:border-teal"
              placeholder="12345"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verifyCode()}
            />
            <button onClick={verifyCode} disabled={busy || !code} className="w-full bg-teal text-ink font-medium rounded px-3 py-2.5 disabled:opacity-40">
              {busy ? "Verifying…" : "Continue"}
            </button>
          </div>
        )}

        {step === "password" && (
          <div className="space-y-4">
            <p className="text-sm text-dim">This account has two-step verification. Enter your Telegram password.</p>
            <input
              type="password"
              className="w-full bg-surface border border-line rounded px-3 py-2.5 text-paper focus:outline-none focus:border-teal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verifyPassword()}
            />
            <button onClick={verifyPassword} disabled={busy || !password} className="w-full bg-teal text-ink font-medium rounded px-3 py-2.5 disabled:opacity-40">
              {busy ? "Verifying…" : "Continue"}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
