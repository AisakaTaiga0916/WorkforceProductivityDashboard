/** Shared helpers for Job Order (J.O.) intake. */

export const JOB_ORDER_NATURE_GROUPS = [
  {
    category: "Building systems",
    options: [
      "Electrical",
      "Plumbing",
      "HVAC / Air Conditioning",
    ],
  },
  {
    category: "Structural & finishes",
    options: ["Carpentry / Civil Works", "Painting"],
  },
  {
    category: "Facilities & services",
    options: [
      "Cleaning / Janitorial",
      "Security / Access",
      "Equipment Repair",
    ],
  },
  {
    category: "Technology",
    options: ["IT / Network"],
  },
  {
    category: "Marketing",
    options: [
      "Graphic Design",
      "Print Production",
      "Video Editing",
      "Paid Advertising",
    ],
  },
  {
    category: "Other",
    options: ["Other"],
  },
] as const;

export type JobOrderNatureOption =
  (typeof JOB_ORDER_NATURE_GROUPS)[number]["options"][number];

export const JOB_ORDER_NATURE_OPTIONS: readonly JobOrderNatureOption[] =
  JOB_ORDER_NATURE_GROUPS.flatMap((group) => [...group.options]);

export type JobOrderFields = {
  natureOfConcern: string[];
  building: string;
  startDate: string;
  targetDate: string;
  expectedDuration: string;
  notes?: string;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isJobOrderNatureOption(value: string): value is JobOrderNatureOption {
  return (JOB_ORDER_NATURE_OPTIONS as readonly string[]).includes(value);
}

export function parseJobOrderNatureList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parseJobOrderNatureList(parsed);
    } catch {
      /* comma-separated fallback */
    }
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }
  return [];
}

/** Inclusive calendar-day span between YYYY-MM-DD start and target (min 1 when both valid). */
export function computeJobOrderDurationDays(startDate: string, targetDate: string): number | null {
  const start = startDate.trim();
  const target = targetDate.trim();
  if (!YMD.test(start) || !YMD.test(target)) return null;
  const a = Date.parse(`${start}T12:00:00.000Z`);
  const b = Date.parse(`${target}T12:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const days = Math.floor((b - a) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

export function formatJobOrderDurationLabel(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days) || days <= 0) return "";
  const n = Math.round(days);
  return n === 1 ? "1 day" : `${n} days`;
}

export function formatJobOrderTitle(
  fields: Pick<JobOrderFields, "building" | "natureOfConcern">,
): string {
  const building = fields.building.trim();
  const natures = fields.natureOfConcern.map((n) => n.trim()).filter(Boolean);
  const natureBit = natures.length > 0 ? natures.slice(0, 2).join(", ") : "";
  const base = building
    ? natureBit
      ? `Job Order · ${building} · ${natureBit}`
      : `Job Order · ${building}`
    : natureBit
      ? `Job Order · ${natureBit}`
      : "Job Order";
  return base.slice(0, 200);
}

export function formatJobOrderDescription(fields: JobOrderFields): string {
  const natures = fields.natureOfConcern.map((n) => n.trim()).filter(Boolean);
  const lines = [
    `Nature of concern: ${natures.join(", ")}`,
    `Building: ${fields.building.trim()}`,
    `Start date: ${fields.startDate.trim()}`,
    `Target date: ${fields.targetDate.trim()}`,
    `Expected duration: ${fields.expectedDuration.trim()}`,
  ];
  const notes = (fields.notes ?? "").trim();
  if (notes) {
    lines.push("", "Additional notes:", notes);
  }
  return lines.join("\n");
}

function fieldFromDescription(description: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(.+)$`, "im").exec(description);
  const value = match?.[1]?.trim();
  return value || null;
}

/** Parse structured job order fields from a stored description. */
export function parseJobOrderDescription(
  description: string | null | undefined,
): JobOrderFields | null {
  const raw = (description ?? "").trim();
  if (!raw) return null;
  const natureRaw = fieldFromDescription(raw, "Nature of concern");
  const building = fieldFromDescription(raw, "Building");
  const startDate = fieldFromDescription(raw, "Start date");
  const targetDate = fieldFromDescription(raw, "Target date");
  const expectedDuration = fieldFromDescription(raw, "Expected duration");
  if (!natureRaw && !building && !startDate && !targetDate && !expectedDuration) {
    return null;
  }
  const notesMatch = /(?:^|\n)Additional notes:\s*\n?([\s\S]*)$/i.exec(raw);
  return {
    natureOfConcern: parseJobOrderNatureList(natureRaw ?? ""),
    building: building ?? "",
    startDate: startDate ?? "",
    targetDate: targetDate ?? "",
    expectedDuration: expectedDuration ?? "",
    notes: notesMatch?.[1]?.trim() || undefined,
  };
}

/** Board card preview text. */
export function extractJobOrderPreview(description: string | null | undefined): string | null {
  const parsed = parseJobOrderDescription(description);
  if (!parsed) return null;
  const building = parsed.building.trim();
  const natures = parsed.natureOfConcern.filter(Boolean);
  if (building && natures.length > 0) return `${building} · ${natures[0]}`;
  return building || natures[0] || parsed.expectedDuration.trim() || null;
}

export function validateJobOrderFields(
  fields: JobOrderFields,
): { ok: true } | { ok: false; error: string } {
  const natures = fields.natureOfConcern.map((n) => n.trim()).filter(Boolean);
  if (natures.length === 0) {
    return { ok: false, error: "Select at least one Nature of Concern." };
  }
  if (natures.some((n) => n.length > 120)) {
    return { ok: false, error: "A Nature of Concern value is too long." };
  }
  if (!fields.building.trim()) {
    return { ok: false, error: "Building is required." };
  }
  if (fields.building.trim().length > 200) {
    return { ok: false, error: "Building must be at most 200 characters." };
  }
  if (!YMD.test(fields.startDate.trim())) {
    return { ok: false, error: "Start Date is required (YYYY-MM-DD)." };
  }
  if (!YMD.test(fields.targetDate.trim())) {
    return { ok: false, error: "Target Date is required (YYYY-MM-DD)." };
  }
  if (fields.targetDate.trim() < fields.startDate.trim()) {
    return { ok: false, error: "Target Date cannot be earlier than Start Date." };
  }
  if (!fields.expectedDuration.trim()) {
    return { ok: false, error: "Expected Duration is required." };
  }
  if (fields.expectedDuration.trim().length > 80) {
    return { ok: false, error: "Expected Duration must be at most 80 characters." };
  }
  if ((fields.notes ?? "").trim().length > 4000) {
    return { ok: false, error: "Additional notes are too long." };
  }
  return { ok: true };
}
