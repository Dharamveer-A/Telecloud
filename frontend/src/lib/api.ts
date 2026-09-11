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

export const api = {
  requestCode: (phone: string) => request("/auth/request-code", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyCode: (phone: string, code: string) => request("/auth/verify-code", { method: "POST", body: JSON.stringify({ phone, code }) }),
  verifyPassword: (phone: string, password: string) => request("/auth/verify-password", { method: "POST", body: JSON.stringify({ phone, password }) }),

  getRoot: () => request("/folders/"),
  getFolder: (id: string, password?: string) => request(`/folders/${id}${password ? `?password=${encodeURIComponent(password)}` : ""}`),
  createFolder: (parentId: string, name: string) => request("/folders", { method: "POST", body: JSON.stringify({ parentId, name }) }),
  lockFolder: (id: string, password: string) => request(`/folders/${id}/lock`, { method: "POST", body: JSON.stringify({ password }) }),
  checkFolderPassword: (id: string, password: string) => request(`/folders/${id}/unlock-check`, { method: "POST", body: JSON.stringify({ password }) }),
  deleteFolder: (id: string) => request(`/folders/${id}`, { method: "DELETE" }),

  uploadFile: (folderId: string, file: File, password: string | undefined, onProgress?: (pct: number) => void) => {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("folderId", folderId);
      if (password) form.append("password", password);
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/files/upload`);
      if (token()) xhr.setRequestHeader("Authorization", `Bearer ${token()}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else reject(new Error(data.error || "Upload failed"));
        } catch {
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(form);
    });
  },

  fileUrl: (id: string, password?: string) => `${BASE}/files/${id}/download${password ? `?password=${encodeURIComponent(password)}` : ""}`,
  deleteFile: (id: string) => request(`/files/${id}`, { method: "DELETE" }),
};

export function setToken(t: string) {
  localStorage.setItem("telecloud_token", t);
}
export function clearToken() {
  localStorage.removeItem("telecloud_token");
}
export function isLoggedIn() {
  return !!token();
}
