import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Thumbnail({ fileId, mimeType, password }: { fileId: string; mimeType: string; password?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!mimeType.startsWith("image/")) return;
    let revoke = "";
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(api.fileUrl(fileId, password), {
          headers: { Authorization: `Bearer ${localStorage.getItem("telecloud_token")}` },
        });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        revoke = objUrl;
        if (!cancelled) setUrl(objUrl);
      } catch {
        /* fall back to icon */
      }
    })();
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [fileId]);

  if (!url) return null;
  return <img src={url} className="w-full h-full object-cover" loading="lazy" />;
}
