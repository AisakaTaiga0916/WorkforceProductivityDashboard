/** Platform setting: Task Board / Task Management completion verification gate. */

export const TASK_VERIFICATION_SETTING_KEY = "task_completion_verification";

export type TaskVerificationSettings = {
  /** When false, completing a task/sub-task goes straight to Done (no pending verification). */
  enabled: boolean;
};

export const DEFAULT_TASK_VERIFICATION_SETTINGS: TaskVerificationSettings = {
  enabled: true,
};

export function parseTaskVerificationSettings(raw: unknown): TaskVerificationSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TASK_VERIFICATION_SETTINGS };
  const enabled = (raw as { enabled?: unknown }).enabled;
  if (typeof enabled === "boolean") return { enabled };
  return { ...DEFAULT_TASK_VERIFICATION_SETTINGS };
}
