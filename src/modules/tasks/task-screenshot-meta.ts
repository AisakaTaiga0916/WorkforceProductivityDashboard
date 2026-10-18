export type TaskScreenshotSlot = "before" | "after" | "general";

export type TaskScreenshotMetaItem = {
  storedFileName: string;
  originalName: string;
  mimeType: "image/jpeg" | "image/png";
  size: number;
  uploadedAt: string;
};

function isSafeStoredFileName(name: string): boolean {
  if (!name || name.includes("..")) return false;
  return !name.includes("/") && !name.includes("\\");
}

export function parseTaskScreenshotMeta(raw: unknown): TaskScreenshotMetaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const storedFileName = typeof o.storedFileName === "string" ? o.storedFileName : "";
  const mimeType = typeof o.mimeType === "string" ? o.mimeType : "";
  if (!isSafeStoredFileName(storedFileName)) return null;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") return null;
  return {
    storedFileName,
    originalName: typeof o.originalName === "string" ? o.originalName : storedFileName,
    mimeType,
    size: typeof o.size === "number" ? o.size : 0,
    uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "",
  };
}

export function parseTaskScreenshotMetaList(raw: unknown): TaskScreenshotMetaItem[] {
  if (Array.isArray(raw)) {
    return raw.map(parseTaskScreenshotMeta).filter((item): item is TaskScreenshotMetaItem => item != null);
  }
  const single = parseTaskScreenshotMeta(raw);
  return single ? [single] : [];
}
