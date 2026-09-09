/**
 * Job Order attachment sections — Planning vs Job Output.
 * Client-safe (no Node builtins).
 */
import type { IntakeScreenshotMetaItem } from "@/lib/ticket-intake-screenshots-meta";

export const JOB_ORDER_ATTACHMENT_SECTIONS = ["planning", "job_output"] as const;
export type JobOrderAttachmentSection = (typeof JOB_ORDER_ATTACHMENT_SECTIONS)[number];

export const JOB_ORDER_ATTACHMENT_SECTION_LABELS: Record<JobOrderAttachmentSection, string> = {
  planning: "Planning Section",
  job_output: "Job Output",
};

export function isJobOrderAttachmentSection(value: unknown): value is JobOrderAttachmentSection {
  return value === "planning" || value === "job_output";
}

export function normalizeJobOrderAttachmentSection(
  value: unknown,
  fallback: JobOrderAttachmentSection = "planning",
): JobOrderAttachmentSection {
  return isJobOrderAttachmentSection(value) ? value : fallback;
}

export function partitionJobOrderAttachments(items: IntakeScreenshotMetaItem[]): {
  planning: IntakeScreenshotMetaItem[];
  jobOutput: IntakeScreenshotMetaItem[];
} {
  const planning: IntakeScreenshotMetaItem[] = [];
  const jobOutput: IntakeScreenshotMetaItem[] = [];
  for (const item of items) {
    if (item.section === "job_output") jobOutput.push(item);
    else planning.push(item);
  }
  return { planning, jobOutput };
}

export function hasJobOrderJobOutputUploaded(items: IntakeScreenshotMetaItem[]): boolean {
  return items.some((item) => item.section === "job_output");
}
