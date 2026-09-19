import { useSyncExternalStore } from "react";
import { TransferProgress } from "./api";

export type TransferKind = "upload" | "download";
export type TransferStatus = "queued" | "active" | "paused" | "done" | "error" | "cancelled";
export type TransferViewMode = "bottom" | "top" | "minimized";

export interface Transfer {
  id: string;
  name: string;
  kind: TransferKind;
  loaded: number;
  total: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  status: TransferStatus;
  error?: string;
  abort?: () => void;
}

let transfers: Transfer[] = [];
const listeners = new Set<() => void>();
let autoClearTimeout: ReturnType<typeof setTimeout> | null = null;
let viewMode: TransferViewMode = "bottom";

function emit() {
  for (const l of listeners) l();
}

function checkAutoClear() {
  if (autoClearTimeout) {
    clearTimeout(autoClearTimeout);
    autoClearTimeout = null;
  }
  const hasPending = transfers.some(
    (t) => t.status === "active" || t.status === "queued" || t.status === "paused"
  );
  if (!hasPending && transfers.length > 0) {
    // If all completed successfully without errors or cancellations, auto-clear after 5s
    const allDone = transfers.every((t) => t.status === "done");
    if (allDone) {
      autoClearTimeout = setTimeout(() => {
        transfers = [];
        viewMode = "bottom";
        emit();
      }, 5000);
    }
  }
}

export const transferStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return transfers;
  },
  get(id: string) {
    return transfers.find((t) => t.id === id);
  },
  getViewMode(): TransferViewMode {
    return viewMode;
  },
  setViewMode(mode: TransferViewMode) {
    if (viewMode !== mode) {
      viewMode = mode;
      emit();
    }
  },
  isDocked() {
    return viewMode !== "bottom";
  },
  setDocked(val: boolean) {
    viewMode = val ? "minimized" : "bottom";
    emit();
  },
  toggleDocked() {
    viewMode = viewMode === "bottom" ? "minimized" : "bottom";
    emit();
  },
  isCancelled(id: string) {
    const t = transfers.find((x) => x.id === id);
    return !t || t.status === "cancelled";
  },
  isPaused(id: string) {
    const t = transfers.find((x) => x.id === id);
    return t?.status === "paused";
  },
  isAllPaused() {
    const pending = transfers.filter(
      (t) => t.status === "active" || t.status === "queued" || t.status === "paused"
    );
    return pending.length > 0 && pending.every((t) => t.status === "paused");
  },
  queueBatch(items: { id: string; name: string; kind: TransferKind; total: number }[]) {
    if (autoClearTimeout) {
      clearTimeout(autoClearTimeout);
      autoClearTimeout = null;
    }
    if (transfers.length === 0) {
      viewMode = "bottom";
    }
    const newTransfers: Transfer[] = items.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      loaded: 0,
      total: item.total,
      bytesPerSecond: 0,
      etaSeconds: null,
      status: "queued",
    }));
    transfers = [...newTransfers, ...transfers];
    emit();
  },
  queue(id: string, name: string, kind: TransferKind, total: number) {
    if (autoClearTimeout) {
      clearTimeout(autoClearTimeout);
      autoClearTimeout = null;
    }
    if (transfers.length === 0) {
      viewMode = "bottom";
    }
    transfers = [
      { id, name, kind, loaded: 0, total, bytesPerSecond: 0, etaSeconds: null, status: "queued" },
      ...transfers,
    ];
    emit();
  },
  start(id: string, name: string, kind: TransferKind, total: number, abort?: () => void) {
    if (autoClearTimeout) {
      clearTimeout(autoClearTimeout);
      autoClearTimeout = null;
    }
    const existingIndex = transfers.findIndex((t) => t.id === id);
    if (existingIndex >= 0) {
      transfers = transfers.map((t, idx) =>
        idx === existingIndex
          ? { ...t, status: "active", loaded: t.loaded || 0, total, abort }
          : t
      );
    } else {
      transfers = [
        { id, name, kind, loaded: 0, total, bytesPerSecond: 0, etaSeconds: null, status: "active", abort },
        ...transfers,
      ];
    }
    emit();
  },
  pause(id: string) {
    const t = transfers.find((x) => x.id === id);
    if (t && (t.status === "active" || t.status === "queued")) {
      if (t.abort) {
        try {
          t.abort();
        } catch {}
      }
      transfers = transfers.map((x) =>
        x.id === id
          ? { ...x, status: "paused", bytesPerSecond: 0, etaSeconds: null }
          : x
      );
      emit();
    }
  },
  resume(id: string) {
    const t = transfers.find((x) => x.id === id);
    if (t && t.status === "paused") {
      transfers = transfers.map((x) =>
        x.id === id ? { ...x, status: "queued" } : x
      );
      emit();
    }
  },
  pauseAll() {
    transfers = transfers.map((t) => {
      if (t.status === "active" || t.status === "queued") {
        if (t.abort) {
          try {
            t.abort();
          } catch {}
        }
        return { ...t, status: "paused", bytesPerSecond: 0, etaSeconds: null };
      }
      return t;
    });
    emit();
  },
  resumeAll() {
    transfers = transfers.map((t) => {
      if (t.status === "paused") {
        return { ...t, status: "queued" };
      }
      return t;
    });
    emit();
  },
  update(id: string, p: TransferProgress) {
    transfers = transfers.map((t) =>
      t.id === id
        ? {
            ...t,
            loaded: p.loaded,
            total: p.total || t.total,
            bytesPerSecond: p.bytesPerSecond,
            etaSeconds: p.etaSeconds,
          }
        : t
    );
    emit();
  },
  finish(id: string) {
    transfers = transfers.map((t) =>
      t.id === id ? { ...t, status: "done", loaded: t.total } : t
    );
    emit();
    checkAutoClear();
  },
  fail(id: string, error: string) {
    transfers = transfers.map((t) =>
      t.id === id ? { ...t, status: "error", error } : t
    );
    emit();
    checkAutoClear();
  },
  cancel(id: string) {
    const t = transfers.find((x) => x.id === id);
    if (t && (t.status === "active" || t.status === "queued" || t.status === "paused")) {
      if (t.abort) {
        try {
          t.abort();
        } catch {}
      }
      transfers = transfers.map((x) =>
        x.id === id ? { ...x, status: "cancelled", error: "Cancelled by user" } : x
      );
      emit();
      checkAutoClear();
    }
  },
  cancelAll() {
    transfers = transfers.map((t) => {
      if (t.status === "active" || t.status === "queued" || t.status === "paused") {
        if (t.abort) {
          try {
            t.abort();
          } catch {}
        }
        return { ...t, status: "cancelled", error: "Cancelled by user" };
      }
      return t;
    });
    emit();
    checkAutoClear();
  },
  clearAll() {
    if (autoClearTimeout) {
      clearTimeout(autoClearTimeout);
      autoClearTimeout = null;
    }
    transfers = [];
    emit();
  },
  remove(id: string) {
    transfers = transfers.filter((t) => t.id !== id);
    emit();
    checkAutoClear();
  },
};

export function useTransfers(): Transfer[] {
  return useSyncExternalStore(transferStore.subscribe, transferStore.getSnapshot);
}

export function useTransferViewMode(): TransferViewMode {
  return useSyncExternalStore(transferStore.subscribe, transferStore.getViewMode);
}

