import { randomUUID } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { MAX_TASK_SCREENSHOT_BYTES } from "@/modules/tasks/task-screenshot-constants";
import type { TaskScreenshotMetaItem } from "@/modules/tasks/task-screenshot-meta";
import { validateTaskScreenshotFile } from "@/modules/tasks/task-screenshots";
import {
  MAX_SCREENSHOT_BYTES,
  isAllowedIntakeAttachment,
} from "@/modules/requests/ticket-intake-screenshots-constants";
import type { TravelOrderFileAttachment } from "@/modules/work-plans/travel-order";
import { MAX_TRAVEL_ORDER_ATTACHMENTS } from "@/modules/work-plans/travel-order";

export { MAX_TRAVEL_ORDER_ATTACHMENTS };

export function travelOrderUploadDir(kpiId: string, travelOrderId: string): string {
  return path.join(process.cwd(), "uploads", "kpi-maintenance", kpiId, "travel-order", travelOrderId);
}

/** Best-effort cleanup when Field Assignment create rolls back after partial uploads. */
export async function removeTravelOrderUploadDir(
  kpiId: string,
  travelOrderId: string,
): Promise<void> {
  await rm(travelOrderUploadDir(kpiId, travelOrderId), { recursive: true, force: true });
}

export async function persistTravelOrderImage(
  kpiId: string,
  travelOrderId: string,
  file: File,
): Promise<TaskScreenshotMetaItem | { error: string }> {
  const validated = validateTaskScreenshotFile(file);
  if (!validated.ok) return { error: validated.error };
  if (file.size > MAX_TASK_SCREENSHOT_BYTES) {
    return { error: "Images must not exceed 10MB." };
  }
  const type = (file.type || "").toLowerCase();
  const mimeType: "image/jpeg" | "image/png" =
    type === "image/png" || /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
  const ext = mimeType === "image/png" ? ".png" : ".jpg";
  const storedFileName = `${randomUUID()}${ext}`;
  const dir = travelOrderUploadDir(kpiId, travelOrderId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedFileName), Buffer.from(await file.arrayBuffer()));
  return {
    storedFileName,
    originalName: file.name.slice(0, 200) || storedFileName,
    mimeType,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

function guessAttachmentExt(mime: string, fallbackName: string): string {
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
  if (t.includes("presentationml") || t.includes("ms-powerpoint")) return ".pptx";
  if (t.includes("csv")) return ".csv";
  if (t.includes("text/plain")) return ".txt";
  if (t.includes("rtf")) return ".rtf";
  return ".bin";
}

function resolveAttachmentMime(file: File): string {
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
  if (/\.pptx$/i.test(name))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (/\.ppt$/i.test(name)) return "application/vnd.ms-powerpoint";
  if (/\.csv$/i.test(name)) return "text/csv";
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.(heic|heif)$/i.test(name)) return "image/heic";
  return "application/octet-stream";
}

/** Order-level supporting file (image or document). */
export async function persistTravelOrderAttachment(
  kpiId: string,
  travelOrderId: string,
  file: File,
): Promise<TravelOrderFileAttachment | { error: string }> {
  if (file.size <= 0) {
    return { error: "Empty files cannot be attached." };
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return { error: "Each attachment must be at most 5MB." };
  }
  const mimeType = resolveAttachmentMime(file);
  if (!isAllowedIntakeAttachment(mimeType, file.name)) {
    return {
      error: "Attachments must be images or documents (PDF, Word, Excel, PowerPoint, CSV, TXT).",
    };
  }
  const ext = guessAttachmentExt(mimeType, file.name);
  const storedFileName = `${randomUUID()}${ext}`;
  const dir = travelOrderUploadDir(kpiId, travelOrderId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedFileName), Buffer.from(await file.arrayBuffer()));
  return {
    storedFileName,
    originalName: file.name.slice(0, 200) || storedFileName,
    mimeType,
    size: file.size,
    uploadedAt: new Date().toISOString(),
  };
}
