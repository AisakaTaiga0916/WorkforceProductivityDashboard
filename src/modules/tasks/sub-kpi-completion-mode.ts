import type { SubKpiItem } from "@/modules/tasks/kpi-subkpis";

export type SubKpiCompletionMode = "checkbox" | "screenshots" | "both";

export type SubKpiCompletionRequirements = {
  checkbox: boolean;
  /** Before/after screenshots on each sub-task. */
  screenshots: boolean;
  /** Generic screenshot uploads on each sub-task. */
  screenshotUpload: boolean;
  numerical: boolean;
};

export const DEFAULT_COMPLETION_REQUIREMENTS: SubKpiCompletionRequirements = {
  checkbox: true,
  screenshots: false,
  screenshotUpload: false,
  numerical: false,
};

export const SUB_KPI_COMPLETION_MODE_OPTIONS: Array<{
  value: SubKpiCompletionMode;
  label: string;
}> = [
  { value: "checkbox", label: "Checkbox only" },
  { value: "screenshots", label: "Before/after screenshots only" },
  { value: "both", label: "Checkbox and screenshots" },
];

export function isSubKpiCompletionMode(value: unknown): value is SubKpiCompletionMode {
  return value === "checkbox" || value === "screenshots" || value === "both";
}

export function normalizeCompletionRequirements(
  value: unknown,
): SubKpiCompletionRequirements | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const checkbox = raw.checkbox === true;
  const screenshots = raw.screenshots === true;
  const screenshotUpload = raw.screenshotUpload === true;
  const numerical = raw.numerical === true;
  if (!checkbox && !screenshots && !screenshotUpload && !numerical) return null;
  return { checkbox, screenshots, screenshotUpload, numerical };
}

export function completionRequirementsFromLegacyMode(
  mode: SubKpiCompletionMode,
): SubKpiCompletionRequirements {
  return {
    checkbox: mode === "checkbox" || mode === "both",
    screenshots: mode === "screenshots" || mode === "both",
    screenshotUpload: false,
    numerical: false,
  };
}

/** Sub-task completion requirements persisted on each checklist item. */
export function subKpiStoredCompletionRequirements(
  requirements: SubKpiCompletionRequirements,
): Pick<SubKpiCompletionRequirements, "checkbox" | "screenshots" | "screenshotUpload" | "numerical"> {
  return {
    checkbox: requirements.checkbox,
    screenshots: requirements.screenshots,
    screenshotUpload: requirements.screenshotUpload,
    numerical: requirements.numerical,
  };
}

export function resolveSubKpiCompletionRequirements(
  item: Pick<SubKpiItem, "completionRequirements" | "completionMode" | "screenshotsEnabled" | "beforeScreenshot" | "afterScreenshot">,
): SubKpiCompletionRequirements {
  const normalized = normalizeCompletionRequirements(item.completionRequirements);
  if (normalized) return normalized;
  return completionRequirementsFromLegacyMode(resolveSubKpiCompletionMode(item));
}

export function resolveSubKpiCompletionMode(
  item: Pick<SubKpiItem, "completionMode" | "screenshotsEnabled" | "beforeScreenshot" | "afterScreenshot">,
): SubKpiCompletionMode {
  if (isSubKpiCompletionMode(item.completionMode)) return item.completionMode;
  const legacyScreenshots =
    item.screenshotsEnabled === true ||
    (item.beforeScreenshot?.length ?? 0) > 0 ||
    (item.afterScreenshot?.length ?? 0) > 0;
  return legacyScreenshots ? "both" : "checkbox";
}

export function subKpiRequiresCheckbox(requirements: SubKpiCompletionRequirements): boolean {
  return requirements.checkbox;
}

export function subKpiRequiresScreenshots(requirements: SubKpiCompletionRequirements): boolean {
  return requirements.screenshots;
}

export function subKpiRequiresScreenshotUpload(requirements: SubKpiCompletionRequirements): boolean {
  return requirements.screenshotUpload;
}

/** @deprecated use subKpiRequiresScreenshotUpload */
export function subKpiRequiresPillarScreenshotUpload(requirements: SubKpiCompletionRequirements): boolean {
  return subKpiRequiresScreenshotUpload(requirements);
}

export function hasScreenshotUpload(item: Pick<SubKpiItem, "uploadScreenshot">): boolean {
  return (item.uploadScreenshot?.length ?? 0) > 0;
}

export function subKpiRequiresNumerical(requirements: SubKpiCompletionRequirements): boolean {
  return requirements.numerical;
}

/** @deprecated use resolveSubKpiCompletionRequirements */
export function subKpiRequiresCheckboxFromMode(mode: SubKpiCompletionMode): boolean {
  return mode === "checkbox" || mode === "both";
}

/** @deprecated use resolveSubKpiCompletionRequirements */
export function subKpiRequiresScreenshotsFromMode(mode: SubKpiCompletionMode): boolean {
  return mode === "screenshots" || mode === "both";
}

export function hasBeforeAndAfterScreenshots(
  item: Pick<SubKpiItem, "beforeScreenshot" | "afterScreenshot">,
): boolean {
  return (item.beforeScreenshot?.length ?? 0) > 0 && (item.afterScreenshot?.length ?? 0) > 0;
}

export function hasNumericalRecord(item: Pick<SubKpiItem, "numericalValue">): boolean {
  return typeof item.numericalValue === "number" && Number.isFinite(item.numericalValue);
}

/** Progress for numerical records: `(actual / target) * 100`, rounded. */
export function numericalRecordProgressPercent(
  actual: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (target == null || !Number.isFinite(target) || target === 0) return null;
  const act = typeof actual === "number" && Number.isFinite(actual) ? actual : 0;
  return Math.round((act / target) * 100);
}

/**
 * Total recorded-data percent across sub-tasks with a numerical target:
 * `sum(actual) / sum(target) * 100` (missing actuals count as 0).
 */
export function totalRecordedDataPercent(
  items: ReadonlyArray<
    Pick<
      SubKpiItem,
      | "completionRequirements"
      | "completionMode"
      | "screenshotsEnabled"
      | "beforeScreenshot"
      | "afterScreenshot"
      | "numericalValue"
      | "numericalTarget"
    >
  >,
): number | null {
  let sumActual = 0;
  let sumTarget = 0;
  let counted = 0;
  for (const item of items) {
    const target = item.numericalTarget;
    if (target == null || !Number.isFinite(target) || target === 0) continue;
    const req = resolveSubKpiCompletionRequirements(item);
    const hasValue = hasNumericalRecord(item);
    if (!req.numerical && !hasValue) continue;
    counted += 1;
    sumTarget += target;
    sumActual += hasValue ? (item.numericalValue as number) : 0;
  }
  if (counted === 0 || sumTarget === 0) return null;
  return Math.round((sumActual / sumTarget) * 100);
}

/** Sub-task progress (0–1+) averaged across enabled completion requirements. */
export function subKpiItemProgressFraction(
  item: Pick<
    SubKpiItem,
    | "done"
    | "completionRequirements"
    | "completionMode"
    | "screenshotsEnabled"
    | "beforeScreenshot"
    | "afterScreenshot"
    | "uploadScreenshot"
    | "numericalValue"
    | "numericalTarget"
  >,
): number {
  const req = resolveSubKpiCompletionRequirements(item);
  const parts: number[] = [];
  if (req.checkbox) parts.push(item.done ? 1 : 0);
  if (req.screenshots) parts.push(hasBeforeAndAfterScreenshots(item) ? 1 : 0);
  if (req.screenshotUpload) parts.push(hasScreenshotUpload(item) ? 1 : 0);
  if (req.numerical) {
    const pct = numericalRecordProgressPercent(item.numericalValue, item.numericalTarget);
    parts.push(pct != null ? pct / 100 : 0);
  }
  if (parts.length === 0) return item.done ? 1 : 0;
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

export function subKpiRequirementsMet(
  item: Pick<
    SubKpiItem,
    | "done"
    | "completionRequirements"
    | "completionMode"
    | "screenshotsEnabled"
    | "beforeScreenshot"
    | "afterScreenshot"
    | "uploadScreenshot"
    | "numericalValue"
    | "numericalTarget"
  >,
): boolean {
  const req = resolveSubKpiCompletionRequirements(item);
  if (!req.checkbox && !req.screenshots && !req.screenshotUpload && !req.numerical) return Boolean(item.done);
  if (req.checkbox && !item.done) return false;
  if (req.screenshots && !hasBeforeAndAfterScreenshots(item)) return false;
  if (req.screenshotUpload && !hasScreenshotUpload(item)) return false;
  if (req.numerical) {
    if (!hasNumericalRecord(item)) return false;
    const pct = numericalRecordProgressPercent(item.numericalValue, item.numericalTarget);
    if (pct != null && pct < 100) return false;
  }
  return true;
}

export function applySubKpiCompletionMode(item: SubKpiItem, mode: SubKpiCompletionMode): SubKpiItem {
  const requirements = completionRequirementsFromLegacyMode(mode);
  return applySubKpiCompletionRequirements(item, requirements);
}

export function applySubKpiCompletionRequirements(
  item: SubKpiItem,
  requirements: SubKpiCompletionRequirements,
): SubKpiItem {
  const next: SubKpiItem = {
    ...item,
    completionRequirements: requirements,
  };
  if (requirements.screenshots) {
    next.screenshotsEnabled = true;
  } else {
    delete next.screenshotsEnabled;
  }
  if (!requirements.checkbox && !subKpiRequirementsMet({ ...next, done: false })) {
    next.done = false;
  }
  if (requirements.screenshots && next.done && !hasBeforeAndAfterScreenshots(next)) {
    next.done = false;
  }
  if (requirements.screenshotUpload && next.done && !hasScreenshotUpload(next)) {
    next.done = false;
  }
  if (requirements.numerical && next.done && !hasNumericalRecord(next)) {
    next.done = false;
  }
  return next;
}

export function completionRequirementsToPersist(
  requirements: SubKpiCompletionRequirements,
): SubKpiItem["completionRequirements"] {
  return subKpiStoredCompletionRequirements(requirements);
}
