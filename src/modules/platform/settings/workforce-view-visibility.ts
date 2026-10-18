export const WORKFORCE_VIEW_VISIBILITY_KEY = "workforce_view_visibility";

export const WORKFORCE_VIEW_IDS = ["list", "activity", "sections"] as const;
export type WorkforceViewId = (typeof WORKFORCE_VIEW_IDS)[number];

export type WorkforceViewVisibility = {
  /** Views hidden from the Workforce page toggle for everyone. */
  hiddenViews: WorkforceViewId[];
};

export const WORKFORCE_VIEW_LABELS: Record<WorkforceViewId, string> = {
  list: "ListView",
  activity: "Activity",
  sections: "Org. Chart",
};

export function isWorkforceViewId(value: unknown): value is WorkforceViewId {
  return value === "list" || value === "activity" || value === "sections";
}

export function parseWorkforceViewVisibility(raw: unknown): WorkforceViewVisibility {
  const ids = new Set<WorkforceViewId>();
  if (raw && typeof raw === "object" && Array.isArray((raw as { hiddenViews?: unknown }).hiddenViews)) {
    for (const id of (raw as { hiddenViews: unknown[] }).hiddenViews) {
      if (isWorkforceViewId(id)) ids.add(id);
    }
  }
  return { hiddenViews: [...ids] };
}

/** At least one view must remain visible. */
export function normalizeWorkforceViewVisibility(
  next: WorkforceViewVisibility,
): WorkforceViewVisibility {
  const hidden = new Set(parseWorkforceViewVisibility(next).hiddenViews);
  if (hidden.size >= WORKFORCE_VIEW_IDS.length) {
    hidden.delete("list");
  }
  return { hiddenViews: WORKFORCE_VIEW_IDS.filter((id) => hidden.has(id)) };
}

export function isWorkforceViewVisible(
  visibility: WorkforceViewVisibility,
  view: WorkforceViewId,
): boolean {
  return !visibility.hiddenViews.includes(view);
}

export function firstVisibleWorkforceView(
  visibility: WorkforceViewVisibility,
  preferred?: string | null,
): WorkforceViewId {
  if (preferred && isWorkforceViewId(preferred) && isWorkforceViewVisible(visibility, preferred)) {
    return preferred;
  }
  for (const id of WORKFORCE_VIEW_IDS) {
    if (isWorkforceViewVisible(visibility, id)) return id;
  }
  return "list";
}
