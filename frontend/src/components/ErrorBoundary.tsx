import React, { Component, ErrorInfo, ReactNode } from "react";
import Logo from "./Logo";
import { RefreshCw, RotateCcw, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { clearToken } from "../lib/api";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[TeleCloud ErrorBoundary] Uncaught runtime error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleHardReset = async () => {
    try {
      // Clear token and custom filters
      clearToken();
      localStorage.removeItem("telecloud_custom_filters");
      
      // Clear all service worker caches
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
      
      // Unregister service workers
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
    } catch (e) {
      console.warn("Reset error:", e);
    } finally {
      window.location.href = "/login";
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-ink text-paper flex items-center justify-center p-4 sm:p-6 select-none">
          <div className="w-full max-w-md bg-surface border border-line rounded-2xl shadow-2xl p-6 sm:p-8 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
            {/* Logo */}
            <div className="mb-4">
              <Logo className="w-12 h-12" />
            </div>

            {/* Error Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-danger/10 border border-danger/25 text-danger text-xs font-medium mb-3">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Application Error</span>
            </div>

            {/* Heading */}
            <h1 className="text-xl sm:text-2xl font-display font-bold text-paper mb-2">
              Something went wrong
            </h1>
            <p className="text-xs sm:text-sm text-dim mb-6 leading-relaxed max-w-sm">
              TeleCloud encountered an unexpected error while rendering. You can reload the page or reset the app cache to resolve it.
            </p>

            {/* Action Buttons */}
            <div className="w-full flex flex-col sm:flex-row gap-2.5 mb-5">
              <button
                onClick={this.handleReload}
                className="flex-1 bg-teal hover:bg-teal/90 text-ink font-medium px-4 py-2.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Page</span>
              </button>
              <button
                onClick={this.handleHardReset}
                className="flex-1 bg-surface2 hover:bg-line text-paper font-medium px-4 py-2.5 rounded-xl text-sm transition-all border border-line flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-dim" />
                <span>Reset & Sign In</span>
              </button>
            </div>

            {/* Expandable Technical Details */}
            <div className="w-full border-t border-line/60 pt-4">
              <button
                onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                className="text-xs text-dim hover:text-paper flex items-center justify-center gap-1 mx-auto transition-colors cursor-pointer"
              >
                <span>Technical details</span>
                {this.state.showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {this.state.showDetails && (
                <div className="mt-3 text-left bg-surface2/60 border border-line rounded-lg p-3 text-[11px] font-mono text-dim overflow-x-auto max-h-48 overflow-y-auto select-text">
                  <div className="text-danger font-semibold mb-1">
                    {this.state.error?.name}: {this.state.error?.message}
                  </div>
                  {this.state.error?.stack && (
                    <pre className="whitespace-pre-wrap leading-tight text-[10px] text-dim/80">
                      {this.state.error.stack}
                    </pre>
                  )}
                  {this.state.errorInfo?.componentStack && (
                    <pre className="mt-2 whitespace-pre-wrap leading-tight text-[10px] text-dim/60 border-t border-line/40 pt-2">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
