import { useSyncExternalStore } from "react";
import { TransferProgress } from "./api";

export type TransferKind = "upload" | "download";
export interface Transfer {
  id: string;
  name: string;
  kind: TransferKind;
  loaded: number;
  total: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  status: "active" | "done" | "error" | "cancelled";
  error?: string;
  abort?: () => void;
}

let transfers: Transfer[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const transferStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return transfers;
  },
  start(id: string, name: string, kind: TransferKind, total: number, abort?: () => void) {
    transfers = [...transfers, { id, name, kind, loaded: 0, total, bytesPerSecond: 0, etaSeconds: null, status: "active", abort }];
    emit();
  },
  update(id: string, p: TransferProgress) {
    transfers = transfers.map((t) => (t.id === id ? { ...t, loaded: p.loaded, total: p.total || t.total, bytesPerSecond: p.bytesPerSecond, etaSeconds: p.etaSeconds } : t));
    emit();
  },
  finish(id: string) {
    transfers = transfers.map((t) => (t.id === id ? { ...t, status: "done", loaded: t.total } : t));
    emit();
    setTimeout(() => transferStore.remove(id), 3000);
  },
  fail(id: string, error: string) {
    transfers = transfers.map((t) => (t.id === id ? { ...t, status: "error", error } : t));
    emit();
    setTimeout(() => transferStore.remove(id), 6000);
  },
  cancel(id: string) {
    const t = transfers.find((x) => x.id === id);
    if (t && t.status === "active") {
      if (t.abort) t.abort();
      transfers = transfers.map((x) => (x.id === id ? { ...x, status: "cancelled", error: "Cancelled by user" } : x));
      emit();
      setTimeout(() => transferStore.remove(id), 3000);
    }
  },
  remove(id: string) {
    transfers = transfers.filter((t) => t.id !== id);
    emit();
  },
};

export function useTransfers(): Transfer[] {
  return useSyncExternalStore(transferStore.subscribe, transferStore.getSnapshot);
}
