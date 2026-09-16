const BASE = "/api";

function token() {
  return localStorage.getItem("telecloud_token") || "";
}

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export interface TransferProgress {
  loaded: number;
  total: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
}

// Shared speed estimator: called with cumulative bytes transferred over
// time, keeps a short rolling window so the reported speed reacts to
// recent throughput rather than being diluted by the whole transfer's
// average (which reads misleadingly low right after a slow start).
function makeSpeedTracker(total: number) {
  const WINDOW_MS = 2000;
  const samples: { t: number; loaded: number }[] = [];
  return (loaded: number): TransferProgress => {
    const now = performance.now();
    samples.push({ t: now, loaded });
    while (samples.length > 1 && now - samples[0].t > WINDOW_MS) samples.shift();

    const first = samples[0];
    const elapsed = (now - first.t) / 1000;
    const bytesInWindow = loaded - first.loaded;
    const bytesPerSecond = elapsed > 0 ? bytesInWindow / elapsed : 0;
    const remaining = total - loaded;
    const etaSeconds = bytesPerSecond > 0 ? remaining / bytesPerSecond : null;
    return { loaded, total, bytesPerSecond, etaSeconds };
  };
}

export const api = {
  requestCode: (phone: string) => request("/auth/request-code", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyCode: (phone: string, code: string) => request("/auth/verify-code", { method: "POST", body: JSON.stringify({ phone, code }) }),
  verifyPassword: (phone: string, password: string) => request("/auth/verify-password", { method: "POST", body: JSON.stringify({ phone, password }) }),

  getRoot: () => request("/folders/"),
  getAllFolders: () => request("/folders/tree/all"),
  getFolder: (id: string, password?: string) => request(`/folders/${id}${password ? `?password=${encodeURIComponent(password)}` : ""}`),
  createFolder: (parentId: string, name: string) => request("/folders", { method: "POST", body: JSON.stringify({ parentId, name }) }),
  lockFolder: (id: string, password: string) => request(`/folders/${id}/lock`, { method: "POST", body: JSON.stringify({ password }) }),
  unlockFolder: (id: string, password: string) => request(`/folders/${id}/unlock`, { method: "POST", body: JSON.stringify({ password }) }),
  checkFolderPassword: (id: string, password: string) => request(`/folders/${id}/unlock-check`, { method: "POST", body: JSON.stringify({ password }) }),
  deleteFolder: (id: string) => request(`/folders/${id}`, { method: "DELETE" }),
  moveFolder: (id: string, newParentId: string) => request(`/folders/${id}/move`, { method: "POST", body: JSON.stringify({ newParentId }) }),
  renameFolder: (id: string, name: string) => request(`/folders/${id}/rename`, { method: "POST", body: JSON.stringify({ name }) }),

  uploadFile: (
    folderId: string,
    file: File,
    password: string | undefined,
    onProgress?: (p: TransferProgress) => void,
    displayName?: string,
    signal?: AbortSignal
  ) => {
    return new Promise((resolve, reject) => {
      const progressId = Math.random().toString(36).slice(2);
      const form = new FormData();
      form.append("folderId", folderId);
      if (password) form.append("password", password);
      if (displayName) form.append("name", displayName);
      form.append("progressId", progressId);
      form.append("file", file);

      const track = makeSpeedTracker(file.size);
      
      let es: EventSource | null = null;
      if (onProgress) {
        const url = `${BASE}/files/upload-progress/${progressId}${token() ? `?token=${token()}` : ''}`;
        es = new EventSource(url);
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.progress !== undefined) {
              onProgress(track(data.progress * file.size));
            }
          } catch {}
        };
      }

      const xhr = new XMLHttpRequest();
      if (signal) {
        signal.addEventListener("abort", () => {
          xhr.abort();
          if (es) es.close();
          reject(new Error("Upload cancelled"));
        });
      }
      xhr.open("POST", `${BASE}/files/upload`);
      if (token()) xhr.setRequestHeader("Authorization", `Bearer ${token()}`);
      xhr.onload = () => {
        if (es) es.close();
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || "Upload failed"));
        } catch {
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = () => {
        if (es) es.close();
        reject(new Error("Upload failed"));
      };
      xhr.send(form);
    });
  },

  // `includeToken` embeds the auth token as a query param, needed for
  // <video>/<audio>/<img> tags which can't send an Authorization header -
  // used for direct native streaming, not for the blob-fetch preview path.
  fileUrl: (id: string, password?: string, includeToken = false) => {
    const params = new URLSearchParams();
    if (password) params.set("password", password);
    if (includeToken) params.set("token", localStorage.getItem("telecloud_token") || "");
    const qs = params.toString();
    return `${BASE}/files/${id}/download${qs ? `?${qs}` : ""}`;
  },
  folderZipUrl: (id: string, password?: string) => `${BASE}/folders/${id}/download-zip${password ? `?password=${encodeURIComponent(password)}` : ""}`,
  deleteFile: (id: string) => request(`/files/${id}`, { method: "DELETE" }),
  moveFile: (id: string, folderId: string) => request(`/files/${id}/move`, { method: "POST", body: JSON.stringify({ folderId }) }),
  renameFile: (id: string, name: string) => request(`/files/${id}/rename`, { method: "POST", body: JSON.stringify({ name }) }),

  // Downloads a URL with byte-level progress + live speed, used for the
  // "Download" context-menu action on both single files and whole
  // folders (zip). Falls back to Content-Length for the total; if the
  // server didn't send one (rare here), progress just won't show a %.
  async downloadWithProgress(url: string, onProgress?: (p: TransferProgress) => void): Promise<Blob> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Download failed (${res.status})`);
    }
    const total = parseInt(res.headers.get("Content-Length") || "0", 10);
    if (!res.body || !total) return res.blob();

    const track = makeSpeedTracker(total);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (onProgress) onProgress(track(loaded));
    }
    return new Blob(chunks as BlobPart[]);
  },
};

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function setToken(t: string) {
  localStorage.setItem("telecloud_token", t);
}
export function clearToken() {
  localStorage.removeItem("telecloud_token");
}
export function isLoggedIn() {
  return !!token();
}
