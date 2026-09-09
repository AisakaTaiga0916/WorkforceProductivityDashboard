import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  isAllowedIntakeAttachment,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_COUNT,
} from "./ticket-intake-screenshots-constants";
import type { IntakeScreenshotMetaItem } from "./ticket-intake-screenshots-meta";

function isProbablyImageFile(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name);
}

export function isAllowedIntakeAttachmentFile(file: File): boolean {
  return isAllowedIntakeAttachment(file.type || "", file.name);
}

export function validateScreenshotFiles(
  files: File[],
  opts?: { maxCount?: number },
): { ok: true } | { ok: false; error: string } {
  const maxCount = opts?.maxCount ?? MAX_SCREENSHOT_COUNT;
  if (files.length > maxCount) {
    return {
      ok: false,
      error:
        maxCount <= 0
          ? `You can attach at most ${MAX_SCREENSHOT_COUNT} files.`
          : `You can attach at most ${maxCount} more file${maxCount === 1 ? "" : "s"} (${MAX_SCREENSHOT_COUNT} total).`,
    };
  }
  for (const f of files) {
    if (f.size > MAX_SCREENSHOT_BYTES) {
      return { ok: false, error: "Each attachment must be at most 5MB." };
    }
    if (f.size > 0 && !isAllowedIntakeAttachmentFile(f)) {
      return {
        ok: false,
        error: "Attachments must be images or documents (PDF, Word, Excel, CSV, TXT).",
      };
    }
  }
  return { ok: true };
}

function guessExt(mime: string, fallbackName: string): string {
  const fromName = path.extname(fallbackName);
  if (fromName && fromName.length <= 8) return fromName;
  const t = mime.toLowerCase();
  if (t.includes("png")) return ".png";
  if (t.includes("jpeg") || t.includes("jpg")) return ".jpg";
  if (t.includes("gif")) return ".gif";
  if (t.includes("webp")) return ".webp";
  if (t.includes("pdf")) return ".pdf";
  if (t.includes("wordprocessingml") || t.includes("msword")) return ".docx";
  if (t.includes("spreadsheetml") || t.includes("ms-excel")) return ".xlsx";
  if (t.includes("csv")) return ".csv";
  if (t.includes("text/plain")) return ".txt";
  return ".bin";
}

function resolveStoredMime(file: File): string {
  const t = (file.type || "").trim();
  if (t) return t;
  const name = file.name.toLowerCase();
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.docx$/i.test(name))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.doc$/i.test(name)) return "application/msword";
  if (/\.xlsx$/i.test(name))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.xls$/i.test(name)) return "application/vnd.ms-excel";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.txt$/i.test(name)) return "text/plain";
  if (isProbablyImageFile(file)) return "image/jpeg";
  return "application/octet-stream";
}

export function ticketScreenshotsUploadDir(ticketId: string): string {
  return path.join(process.cwd(), "uploads", "tickets", ticketId);
}

export async function persistTicketScreenshots(
  ticketId: string,
  files: File[],
  opts?: {
    section?: IntakeScreenshotMetaItem["section"];
    uploadedByAgentId?: string | null;
  },
): Promise<IntakeScreenshotMetaItem[]> {
  const nonEmpty = files.filter((f) => f.size > 0);
  if (nonEmpty.length === 0) return [];
  const dir = ticketScreenshotsUploadDir(ticketId);
  await mkdir(dir, { recursive: true });
  const meta: IntakeScreenshotMetaItem[] = [];
  const uploadedAt = new Date().toISOString();
  const uploadedByAgentId = opts?.uploadedByAgentId?.trim() || null;
  for (const file of nonEmpty) {
    const mimeType = resolveStoredMime(file);
    const ext = guessExt(mimeType, file.name);
    const storedFileName = `${randomUUID()}${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, storedFileName), buf);
    meta.push({
      storedFileName,
      originalName: file.name.slice(0, 200) || storedFileName,
      mimeType,
      size: file.size,
      ...(opts?.section ? { section: opts.section } : {}),
      ...(uploadedByAgentId ? { uploadedByAgentId } : {}),
      uploadedAt,
    });
  }
  return meta;
}
