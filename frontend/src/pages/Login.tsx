import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";
import { COUNTRIES, Country, detectCountry } from "../lib/countries";

type Step = "phone" | "code" | "password";

export default function Login() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("phone");

  // Initial detection from browser timezone / locale
  const initialCountry = useMemo(() => detectCountry(), []);
  const [countryCode, setCountryCode] = useState(initialCountry.dialCode);
  const [countryFlag, setCountryFlag] = useState(initialCountry.flag);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [searchCountry, setSearchCountry] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const [fullPhone, setFullPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Close country picker on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowCountryPicker(false);
      }
    }
    if (showCountryPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showCountryPicker]);

  // Filter countries for search dropdown
  const filteredCountries = useMemo(() => {
    const q = searchCountry.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [searchCountry]);

  function handleCountryCodeChange(val: string) {
    let clean = val.trim();
    if (!clean.startsWith("+")) {
      clean = "+" + clean.replace(/\D/g, "");
    } else {
      clean = "+" + clean.slice(1).replace(/\D/g, "");
    }
    setCountryCode(clean);

    // Auto-update flag if matches a known country
    const match = COUNTRIES.find((c) => c.dialCode === clean);
    if (match) {
      setCountryFlag(match.flag);
    } else {
      setCountryFlag("🌐");
    }
  }

  function selectCountry(country: Country) {
    setCountryCode(country.dialCode);
    setCountryFlag(country.flag);
    setShowCountryPicker(false);
    setSearchCountry("");
  }

  function handlePhoneNumberChange(val: string) {
    // If user pastes full number with country code starting with '+'
    if (val.startsWith("+")) {
      for (const c of COUNTRIES) {
        if (val.startsWith(c.dialCode)) {
          setCountryCode(c.dialCode);
          setCountryFlag(c.flag);
          setPhoneNumber(val.slice(c.dialCode.length).trim());
          return;
        }
      }
    }
    setPhoneNumber(val);
  }

  async function sendCode() {
    setError("");
    const cleanDigits = phoneNumber.replace(/\D/g, "");
    if (!cleanDigits) {
      setError("Please enter your mobile phone number");
      return;
    }

    const cleanCode = countryCode.trim();
    if (!cleanCode || cleanCode === "+") {
      setError("Please enter a valid country code (e.g. +91, +1)");
      return;
    }

    const completePhone = `${cleanCode}${cleanDigits}`;
    setFullPhone(completePhone);
    setBusy(true);

    try {
      await api.requestCode(completePhone);
      setStep("code");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError("");
    setBusy(true);
    try {
      const res: any = await api.verifyCode(fullPhone, code.trim());
      if (res.status === "need_password") {
        setStep("password");
      } else {
        setToken(res.token);
        nav("/");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyPassword() {
    setError("");
    setBusy(true);
    try {
      const res: any = await api.verifyPassword(fullPhone, password);
      setToken(res.token);
      nav("/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
              <span className="text-xs text-dim uppercase tracking-wide">Mobile Number</span>
              <div className="mt-1 flex gap-2 relative">
                {/* Editable Country Code with Flag Dropdown */}
                <div className="relative shrink-0" ref={pickerRef}>
                  <div className="flex items-center bg-surface border border-line rounded focus-within:border-teal px-2 py-1 h-[42px] transition-colors">
                    <button
                      type="button"
                      onClick={() => setShowCountryPicker(!showCountryPicker)}
                      className="text-base mr-1 hover:scale-110 transition-transform cursor-pointer select-none"
                      title="Select country"
                    >
                      {countryFlag}
                    </button>
                    <input
                      type="text"
                      value={countryCode}
                      onChange={(e) => handleCountryCodeChange(e.target.value)}
                      className="w-14 bg-transparent text-paper font-mono text-sm focus:outline-none"
                      placeholder="+1"
                      title="Country code (editable)"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCountryPicker(!showCountryPicker)}
                      className="text-dim text-[10px] ml-0.5 hover:text-paper cursor-pointer select-none"
                      title="Browse countries"
                    >
                      ▾
                    </button>
                  </div>

                  {/* Dropdown Country Picker */}
                  {showCountryPicker && (
                    <div className="absolute left-0 top-full mt-1 w-64 max-h-64 bg-surface border border-line rounded-lg shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-1">
                      <div className="p-2 border-b border-line bg-surface2">
                        <input
                          type="text"
                          placeholder="Search country or code..."
                          value={searchCountry}
                          onChange={(e) => setSearchCountry(e.target.value)}
                          className="w-full bg-surface border border-line rounded px-2.5 py-1 text-xs text-paper focus:outline-none focus:border-teal"
                          autoFocus
                        />
                      </div>
                      <div className="overflow-y-auto flex-1 divide-y divide-line/30">
                        {filteredCountries.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => selectCountry(c)}
                            className="w-full px-3 py-2 text-left text-xs hover:bg-surface2 flex items-center justify-between text-paper transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-sm">{c.flag}</span>
                              <span className="truncate">{c.name}</span>
                            </div>
                            <span className="font-mono text-dim ml-2 shrink-0">{c.dialCode}</span>
                          </button>
                        ))}
                        {filteredCountries.length === 0 && (
                          <div className="p-3 text-xs text-dim text-center">No countries found</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Mobile Digits Input */}
                <div className="flex-1">
                  <input
                    type="tel"
                    className="w-full bg-surface border border-line rounded px-3 py-2.5 text-paper placeholder:text-dim/60 focus:outline-none focus:border-teal font-mono text-sm h-[42px]"
                    placeholder="98765 43210"
                    value={phoneNumber}
                    onChange={(e) => handlePhoneNumberChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendCode()}
                    autoFocus
                  />
                </div>
              </div>
            </label>
            <button
              onClick={sendCode}
              disabled={busy || !phoneNumber.trim()}
              className="w-full bg-teal text-ink font-medium rounded px-3 py-2.5 disabled:opacity-40 transition-opacity cursor-pointer"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </div>
        )}

        {step === "code" && (
          <div className="space-y-4">
            <p className="text-sm text-dim">
              Enter the code sent to your Telegram app for <span className="text-paper font-mono">{fullPhone}</span>.
            </p>
            <input
              className="w-full bg-surface border border-line rounded px-3 py-2.5 text-paper tracking-[0.3em] text-center focus:outline-none focus:border-teal font-mono text-lg"
              placeholder="12345"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verifyCode()}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError("");
                }}
                className="w-1/3 bg-surface hover:bg-surface2 text-dim hover:text-paper border border-line rounded px-3 py-2.5 text-xs transition-colors cursor-pointer"
              >
                Change number
              </button>
              <button
                onClick={verifyCode}
                disabled={busy || !code.trim()}
                className="w-2/3 bg-teal text-ink font-medium rounded px-3 py-2.5 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                {busy ? "Verifying…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {step === "password" && (
          <div className="space-y-4">
            <p className="text-sm text-dim">This account has two-step verification. Enter your Telegram password.</p>
            <input
              type="password"
              className="w-full bg-surface border border-line rounded px-3 py-2.5 text-paper focus:outline-none focus:border-teal font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verifyPassword()}
              autoFocus
            />
            <button
              onClick={verifyPassword}
              disabled={busy || !password}
              className="w-full bg-teal text-ink font-medium rounded px-3 py-2.5 disabled:opacity-40 transition-opacity cursor-pointer"
            >
              {busy ? "Verifying…" : "Continue"}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
