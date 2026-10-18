import { randomUUID } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { MAX_TASK_SCREENSHOT_BYTES } from "@/modules/tasks/task-screenshot-constants";
import type { TaskScreenshotMetaItem } from "@/modules/tasks/task-screenshot-meta";

function isJpegOrPng(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "image/jpeg" || type === "image/png") return true;
  return /\.(jpe?g|png)$/i.test(file.name);
}

function screenshotMime(file: File): "image/jpeg" | "image/png" {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png" || /\.png$/i.test(file.name)) return "image/png";
  return "image/jpeg";
}

export function validateTaskScreenshotFile(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size <= 0) return { ok: false, error: "Screenshot file is required." };
  if (file.size > MAX_TASK_SCREENSHOT_BYTES) {
    return { ok: false, error: "Task screenshots must not exceed 10MB." };
  }
  if (!isJpegOrPng(file)) {
    return { ok: false, error: "Task screenshots must be JPEG or PNG files only." };
  }
  return { ok: true };
}

export function taskScreenshotsUploadDir(kpiId: string): string {
  return path.join(process.cwd(), "uploads", "kpi-maintenance", kpiId);
}

export async function persistTaskScreenshot(
  kpiId: string,
  file: File,
): Promise<TaskScreenshotMetaItem> {
  const mimeType = screenshotMime(file);
  const ext = mimeType === "image/png" ? ".png" : ".jpg";
  const storedFileName = `${randomUUID()}${ext}`;
  const dir = taskScreenshotsUploadDir(kpiId);
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

/** Best-effort cleanup when a task card is deleted. */
export async function deleteTaskScreenshotsDir(kpiId: string): Promise<void> {
  try {
    await rm(taskScreenshotsUploadDir(kpiId), { recursive: true, force: true });
  } catch {
    /* uploads dir may already be absent */
  }
}
