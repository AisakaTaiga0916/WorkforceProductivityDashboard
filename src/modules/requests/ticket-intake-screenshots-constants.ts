/** Shared limits for ticket intake attachments (safe to import from client components). */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_SCREENSHOT_COUNT = 15;

/** File input `accept` for images + common document types. */
export const INTAKE_ATTACHMENT_ACCEPT = [
  "image/*",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".rtf",
  ".odt",
  ".ods",
  ".odp",
].join(",");

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const DOCUMENT_EXT =
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods|odp)$/i;

const DOCUMENT_MIME_PREFIXES = [
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.oasis.opendocument.",
  "application/rtf",
  "text/plain",
  "text/csv",
  "text/rtf",
] as const;

export function isIntakeImageMimeOrName(mimeType: string, fileName: string): boolean {
  const t = (mimeType || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  return IMAGE_EXT.test(fileName);
}

export function isIntakeDocumentMimeOrName(mimeType: string, fileName: string): boolean {
  const t = (mimeType || "").toLowerCase();
  if (DOCUMENT_MIME_PREFIXES.some((p) => t.startsWith(p) || t === p)) return true;
  return DOCUMENT_EXT.test(fileName);
}

/** Images and common office/PDF documents allowed on intake. */
export function isAllowedIntakeAttachment(mimeType: string, fileName: string): boolean {
  return (
    isIntakeImageMimeOrName(mimeType, fileName) ||
    isIntakeDocumentMimeOrName(mimeType, fileName)
  );
}
