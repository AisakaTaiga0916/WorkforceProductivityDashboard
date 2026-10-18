import { parseCsvLine } from "@/lib/csv-parse";
import type { SubKpiCompletionRequirements } from "@/modules/tasks/sub-kpi-completion-mode";
import { DEFAULT_COMPLETION_REQUIREMENTS } from "@/modules/tasks/sub-kpi-completion-mode";

export const DEPARTMENT_TASK_CSV_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUAL",
  "YEARLY",
] as const;

export type DepartmentTaskCsvFrequency = (typeof DEPARTMENT_TASK_CSV_FREQUENCIES)[number];

export type DepartmentTaskCsvSubtask = {
  title: string;
  requirements: SubKpiCompletionRequirements;
  numericalTarget: number | null;
  /** Recorded actual for numerical completion (optional on import). */
  numericalValue: number | null;
};

export type DepartmentTaskCsvTask = {
  /** Task Board main task name. */
  mainTask: string;
  frequency: DepartmentTaskCsvFrequency;
  isRecurring: boolean;
  assigneeEmail: string;
  departmentName: string | null;
  company: string | null;
  /** Checklist items; empty means pillar-only (completion on the main task). */
  subtasks: DepartmentTaskCsvSubtask[];
  /** Set when this is a pillar-only task (no subtasks). */
  pillarRequirements: SubKpiCompletionRequirements | null;
  pillarNumericalTarget: number | null;
  pillarNumericalValue: number | null;
  rowNumbers: number[];
};

export type DepartmentTaskCsvParseResult = {
  tasks: DepartmentTaskCsvTask[];
  errors: string[];
};

const HEADER_ALIASES: Record<string, string> = {
  main_task: "main_task",
  maintask: "main_task",
  /** Legacy alias — older samples used task_title; treat as main_task. */
  task_title: "main_task",
  tasktitle: "main_task",
  title: "main_task",
  frequency: "frequency",
  is_recurring: "is_recurring",
  isrecurring: "is_recurring",
  recurring: "is_recurring",
  assignee_email: "assignee_email",
  assigneeemail: "assignee_email",
  email: "assignee_email",
  department_name: "department_name",
  departmentname: "department_name",
  department: "department_name",
  company: "company",
  company_name: "company",
  subtask_title: "subtask_title",
  subtasktitle: "subtask_title",
  checklist_item: "subtask_title",
  require_checkbox: "require_checkbox",
  require_before_after_screenshots: "require_before_after_screenshots",
  require_screenshots: "require_before_after_screenshots",
  require_screenshot_upload: "require_screenshot_upload",
  require_numerical: "require_numerical",
  numerical_target: "numerical_target",
  numerical_value: "numerical_value",
  numericalvalue: "numerical_value",
  actual: "numerical_value",
  actual_value: "numerical_value",
  recorded_value: "numerical_value",
  notes: "notes",
};

function normalizeHeader(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return HEADER_ALIASES[key] ?? key;
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw == null || !String(raw).trim()) return defaultValue;
  const t = String(raw).trim().toUpperCase();
  if (["TRUE", "1", "YES", "Y"].includes(t)) return true;
  if (["FALSE", "0", "NO", "N"].includes(t)) return false;
  return defaultValue;
}

function parseFrequency(raw: string): {
  frequency: DepartmentTaskCsvFrequency;
  isRecurringHint: boolean | null;
} | null {
  const t = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (t === "ONE_OFF" || t === "ONEOFF" || t === "NON_RECURRING") {
    return { frequency: "DAILY", isRecurringHint: false };
  }
  if ((DEPARTMENT_TASK_CSV_FREQUENCIES as readonly string[]).includes(t)) {
    return { frequency: t as DepartmentTaskCsvFrequency, isRecurringHint: null };
  }
  return null;
}

function taskGroupKey(row: {
  mainTask: string;
  frequency: string;
  isRecurring: boolean;
  assigneeEmail: string;
  departmentName: string | null;
  company: string | null;
}): string {
  return [
    row.mainTask.toLowerCase(),
    row.frequency,
    row.isRecurring ? "1" : "0",
    row.assigneeEmail.toLowerCase(),
    (row.departmentName ?? "").toLowerCase(),
    (row.company ?? "").toLowerCase(),
  ].join("|");
}

type ParsedNumerical = {
  numericalTarget: number | null;
  numericalValue: number | null;
  error?: string;
};

function parseNumericalFields(args: {
  rowNum: number;
  requireNumerical: boolean;
  rawTarget: string;
  rawValue: string;
}): ParsedNumerical {
  const { rowNum, requireNumerical, rawTarget, rawValue } = args;
  if (requireNumerical) {
    const n = Number(rawTarget);
    if (!rawTarget || !Number.isFinite(n) || n === 0) {
      return {
        numericalTarget: null,
        numericalValue: null,
        error: `Row ${rowNum}: numerical_target is required (non-zero) when require_numerical=TRUE.`,
      };
    }
    let numericalValue: number | null = null;
    if (rawValue) {
      const v = Number(rawValue);
      if (!Number.isFinite(v)) {
        return {
          numericalTarget: null,
          numericalValue: null,
          error: `Row ${rowNum}: numerical_value must be a number (got "${rawValue}").`,
        };
      }
      numericalValue = v;
    }
    return { numericalTarget: n, numericalValue };
  }
  if (rawValue) {
    return {
      numericalTarget: null,
      numericalValue: null,
      error: `Row ${rowNum}: numerical_value is only allowed when require_numerical=TRUE.`,
    };
  }
  return { numericalTarget: null, numericalValue: null };
}

/** Canonical sample CSV for Departments view download. */
export function departmentTaskCsvSampleContent(): string {
  const lines = [
    [
      "main_task",
      "frequency",
      "is_recurring",
      "assignee_email",
      "department_name",
      "company",
      "subtask_title",
      "require_checkbox",
      "require_before_after_screenshots",
      "require_screenshot_upload",
      "require_numerical",
      "numerical_target",
      "numerical_value",
      "notes",
    ].join(","),
    'Operations daily checks,DAILY,TRUE,alice@example.com,Finance & Accounting,ACI,Bank recon,TRUE,FALSE,FALSE,FALSE,,,"Checkbox only"',
    'Operations daily checks,DAILY,TRUE,alice@example.com,Finance & Accounting,ACI,Site photo proof,FALSE,TRUE,FALSE,FALSE,,,"Before+after screenshots"',
    'Operations daily checks,DAILY,TRUE,alice@example.com,Finance & Accounting,ACI,Signed form upload,FALSE,FALSE,TRUE,FALSE,,,"Generic upload"',
    'Operations daily checks,DAILY,TRUE,alice@example.com,Finance & Accounting,ACI,Collections target,FALSE,FALSE,FALSE,TRUE,100,85,"Target 100 · actual 85 (partial)"',
    'Store visit pack,WEEKLY,TRUE,bob@example.com,Revenue Sales,ACI,Visit checklist,TRUE,TRUE,FALSE,FALSE,,,"Checkbox + screenshots"',
    'Store visit pack,WEEKLY,TRUE,bob@example.com,Revenue Sales,ACI,Units sold,TRUE,FALSE,FALSE,TRUE,50,50,"Target 50 · actual 50 (meets target; checkbox still required)"',
    'Month-end close,MONTHLY,TRUE,carol@example.com,Accounting,ACI,Journal pack upload,TRUE,FALSE,TRUE,FALSE,,,"Checkbox + upload"',
    'Special audit request,ONE_OFF,FALSE,dave@example.com,Internal Audit,ACI,PBC evidence,FALSE,FALSE,TRUE,FALSE,,,"Non-recurring (is_recurring=FALSE)"',
    'Daily headcount,DAILY,TRUE,alice@example.com,Finance & Accounting,ACI,,FALSE,FALSE,FALSE,TRUE,100,100,"Pillar-only — blank subtask_title; completion on main task"',
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function parseDepartmentTaskCsv(content: string): DepartmentTaskCsvParseResult {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  const errors: string[] = [];
  if (lines.length === 0) {
    return { tasks: [], errors: ["CSV is empty."] };
  }

  const headerCols = parseCsvLine(lines[0]!).map(normalizeHeader);
  const col = (name: string) => headerCols.indexOf(name);

  const required = ["main_task", "assignee_email"] as const;
  for (const name of required) {
    if (col(name) < 0) {
      errors.push(`Missing required column: ${name}`);
    }
  }
  if (errors.length > 0) return { tasks: [], errors };

  const idx = {
    mainTask: col("main_task"),
    frequency: col("frequency"),
    isRecurring: col("is_recurring"),
    assigneeEmail: col("assignee_email"),
    departmentName: col("department_name"),
    company: col("company"),
    subtaskTitle: col("subtask_title"),
    requireCheckbox: col("require_checkbox"),
    requireScreenshots: col("require_before_after_screenshots"),
    requireUpload: col("require_screenshot_upload"),
    requireNumerical: col("require_numerical"),
    numericalTarget: col("numerical_target"),
    numericalValue: col("numerical_value"),
  };

  type Acc = DepartmentTaskCsvTask & { seenSubtasks: Set<string> };
  const groups = new Map<string, Acc>();

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const cols = parseCsvLine(lines[i]!);
    const get = (j: number) => (j >= 0 ? (cols[j] ?? "").trim() : "");

    const mainTask = get(idx.mainTask);
    const assigneeEmail = get(idx.assigneeEmail).toLowerCase();
    const subtaskTitle = get(idx.subtaskTitle);
    if (!mainTask || !assigneeEmail) {
      errors.push(`Row ${rowNum}: main_task and assignee_email are required.`);
      continue;
    }

    const freqRaw = get(idx.frequency) || "DAILY";
    const parsedFreq = parseFrequency(freqRaw);
    if (!parsedFreq) {
      errors.push(
        `Row ${rowNum}: invalid frequency "${freqRaw}" (use DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI_ANNUAL, YEARLY, or ONE_OFF).`,
      );
      continue;
    }

    let isRecurring = parseBool(get(idx.isRecurring), true);
    if (parsedFreq.isRecurringHint === false) isRecurring = false;

    const requireScreenshots = parseBool(get(idx.requireScreenshots), false);
    const requireUpload = parseBool(get(idx.requireUpload), false);
    const requireNumerical = parseBool(get(idx.requireNumerical), false);
    const checkboxRaw = get(idx.requireCheckbox);
    // Omitted checkbox column: default TRUE for checklist rows, FALSE when numerical-only
    // so pillar/numerical imports are not stuck behind an invisible checkbox gate.
    const requireCheckbox = checkboxRaw
      ? parseBool(checkboxRaw, true)
      : !requireNumerical;

    const label = subtaskTitle || mainTask;
    if (!requireCheckbox && !requireScreenshots && !requireUpload && !requireNumerical) {
      errors.push(
        `Row ${rowNum}: enable at least one completion requirement for "${label}".`,
      );
      continue;
    }

    const numerical = parseNumericalFields({
      rowNum,
      requireNumerical,
      rawTarget: get(idx.numericalTarget),
      rawValue: get(idx.numericalValue),
    });
    if (numerical.error) {
      errors.push(numerical.error);
      continue;
    }

    const departmentName = get(idx.departmentName) || null;
    const company = get(idx.company) || null;

    const draft = {
      mainTask,
      frequency: parsedFreq.frequency,
      isRecurring,
      assigneeEmail,
      departmentName,
      company,
    };
    const key = taskGroupKey(draft);
    let group = groups.get(key);
    if (!group) {
      group = {
        ...draft,
        subtasks: [],
        pillarRequirements: null,
        pillarNumericalTarget: null,
        pillarNumericalValue: null,
        rowNumbers: [],
        seenSubtasks: new Set(),
      };
      groups.set(key, group);
    }

    const requirements: SubKpiCompletionRequirements = {
      checkbox: requireCheckbox,
      screenshots: requireScreenshots,
      screenshotUpload: requireUpload,
      numerical: requireNumerical,
    };

    // Blank subtask_title → pillar-only (completion on the main task).
    if (!subtaskTitle) {
      if (group.subtasks.length > 0) {
        errors.push(
          `Row ${rowNum}: cannot mix pillar-only (blank subtask_title) with subtasks for "${mainTask}".`,
        );
        continue;
      }
      if (group.pillarRequirements) {
        errors.push(
          `Row ${rowNum}: duplicate pillar-only row for "${mainTask}" (one blank-subtask row per task).`,
        );
        continue;
      }
      group.pillarRequirements = requirements;
      group.pillarNumericalTarget = numerical.numericalTarget;
      group.pillarNumericalValue = numerical.numericalValue;
      group.rowNumbers.push(rowNum);
      continue;
    }

    if (group.pillarRequirements) {
      errors.push(
        `Row ${rowNum}: cannot add subtask "${subtaskTitle}" — "${mainTask}" is already pillar-only.`,
      );
      continue;
    }

    const subKey = subtaskTitle.toLowerCase();
    if (group.seenSubtasks.has(subKey)) {
      errors.push(`Row ${rowNum}: duplicate subtask "${subtaskTitle}" in the same task group.`);
      continue;
    }
    group.seenSubtasks.add(subKey);
    group.rowNumbers.push(rowNum);

    group.subtasks.push({
      title: subtaskTitle,
      requirements,
      numericalTarget: numerical.numericalTarget,
      numericalValue: numerical.numericalValue,
    });
  }

  const tasks: DepartmentTaskCsvTask[] = [...groups.values()].map(
    ({ seenSubtasks: _s, ...task }) => task,
  );

  if (tasks.length === 0 && errors.length === 0) {
    errors.push("No task rows found after the header.");
  }

  return { tasks, errors };
}

export function defaultCompletionRequirements(): SubKpiCompletionRequirements {
  return { ...DEFAULT_COMPLETION_REQUIREMENTS };
}
