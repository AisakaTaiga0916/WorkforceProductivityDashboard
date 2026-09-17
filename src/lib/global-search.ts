import type { RequestTypeId } from "@/lib/request-types";
import { flattenStaffNavItems } from "@/lib/staff-navigation";

export type GlobalSearchResultKind =
  | "ticket"
  | "task"
  | "travel_order"
  | "user"
  | "project"
  | "action"
  | "recent";

export type GlobalSearchResult = {
  id: string;
  kind: GlobalSearchResultKind;
  title: string;
  subtitle?: string;
  href: string;
  status?: string;
  requestType?: RequestTypeId | string;
  badge?: string;
};

export type GlobalSearchGroupKey =
  | "Tickets"
  | "Tasks"
  | "Travel Orders"
  | "Projects"
  | "Users"
  | "Actions"
  | "Recent";

export type GlobalSearchResponse = {
  query: string;
  results: GlobalSearchResult[];
  groups: Partial<Record<GlobalSearchGroupKey, GlobalSearchResult[]>>;
};

export type QuickAction = {
  id: string;
  label: string;
  subtitle?: string;
  href: string;
  keywords?: string[];
};

const RECENT_KEY = "global-search-recent-v1";
const RECENT_LIMIT = 8;

export function groupLabelForKind(kind: GlobalSearchResultKind): GlobalSearchGroupKey {
  switch (kind) {
    case "ticket":
      return "Tickets";
    case "task":
      return "Tasks";
    case "travel_order":
      return "Travel Orders";
    case "project":
      return "Projects";
    case "user":
      return "Users";
    case "action":
      return "Actions";
    case "recent":
      return "Recent";
    default:
      return "Tickets";
  }
}

export function groupSearchResults(
  results: GlobalSearchResult[],
): Partial<Record<GlobalSearchGroupKey, GlobalSearchResult[]>> {
  const groups: Partial<Record<GlobalSearchGroupKey, GlobalSearchResult[]>> = {};
  for (const row of results) {
    const key = groupLabelForKind(row.kind);
    const list = groups[key] ?? [];
    list.push(row);
    groups[key] = list;
  }
  return groups;
}

export function readRecentSearchItems(): GlobalSearchResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is GlobalSearchResult =>
          row != null &&
          typeof row === "object" &&
          typeof (row as GlobalSearchResult).id === "string" &&
          typeof (row as GlobalSearchResult).href === "string" &&
          typeof (row as GlobalSearchResult).title === "string",
      )
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function rememberSearchItem(item: Omit<GlobalSearchResult, "kind"> & { kind?: GlobalSearchResultKind }) {
  if (typeof window === "undefined") return;
  const preservedKind =
    item.kind && item.kind !== "recent" && item.kind !== "action" ? item.kind : "ticket";
  const next: GlobalSearchResult = {
    ...item,
    kind: preservedKind,
  };
  const prev = readRecentSearchItems().filter((row) => row.id !== next.id || row.href !== next.href);
  const merged = [next, ...prev].slice(0, RECENT_LIMIT);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(merged));
}

const NAV_ACTION_KEYWORDS: Record<string, string[]> = {
  home: ["home", "dashboard", "main"],
  create: ["create", "new", "request", "intake"],
  "my-assigned": ["my work", "assigned", "queue", "my assigned"],
  "my-requests": ["my requests", "submitted"],
  "assignment-board": ["assignment", "board", "triage", "manual"],
  "task-board": ["tasks", "kanban", "kpi", "task board"],
  "travel-orders": ["travel", "field assignment"],
  unassigned: ["unassigned", "triage"],
  kpi: ["metrics", "reports", "insights", "kpi"],
  process: ["process", "sop", "guide", "controls"],
  settings: ["settings", "org chart", "superadmin", "superadmin settings", "priority alerts", "access controls", "faq"],
  "superadmin-settings": ["superadmin", "settings", "priority alerts", "access controls", "faq", "escalation"],
  workforce: ["workforce", "users", "positions", "personnel", "activities"],
  "priority-alerts": ["alerts", "priority", "escalation"],
  sectioning: ["sections", "sectioning", "departments", "either or", "link relations", "org chart"],
  "access-controls": ["access", "permissions", "roles", "controls"],
  faq: ["faq", "help", "sign-in"],
  account: ["account", "profile", "my account"],
};

/** Command-palette shortcuts aligned with the staff sidebar, plus typed create flows. */
export function buildQuickActions(role: string | undefined): QuickAction[] {
  const staff = role === "SuperAdmin" || role === "HighAdmin" || role === "Admin" || role === "Personnel";
  const actions: QuickAction[] = [];

  for (const item of flattenStaffNavItems(role)) {
    actions.push({
      id: `nav-${item.id}`,
      label: item.label,
      subtitle: "Navigate",
      href: item.href,
      keywords: NAV_ACTION_KEYWORDS[item.id] ?? [item.label.toLowerCase()],
    });
  }

  if (staff) {
    actions.push(
      {
        id: "create-ticket",
        label: "Create Issue/Concern Ticket",
        subtitle: "Standard support request",
        href: "/tickets/new?type=ISSUE_CONCERN_TICKET",
        keywords: ["new", "issue", "concern", "ticket"],
      },
      {
        id: "create-rfp",
        label: "Create Request for Payment",
        subtitle: "R.F.P. intake form",
        href: "/tickets/new?type=REQUEST_FOR_PAYMENT",
        keywords: ["payment", "rfp", "request for payment"],
      },
      {
        id: "create-job-order",
        label: "Create Job Order",
        subtitle: "J.O. intake form",
        href: "/tickets/new?type=JOB_ORDER",
        keywords: ["job order", "jo"],
      },
      {
        id: "create-work-plan",
        label: "Create Travel Order",
        subtitle: "Open Tasks board · Travel Orders",
        href: "/agent/tasks",
        keywords: ["travel", "work plan", "travel order", "field assignment"],
      },
    );
  }

  return actions;
}

export function filterQuickActions(actions: QuickAction[], query: string): QuickAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return actions;
  return actions.filter((action) => {
    const hay = [action.label, action.subtitle ?? "", ...(action.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function splitHighlight(text: string, query: string): Array<{ text: string; match: boolean }> {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor);
    if (idx === -1) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) parts.push({ text: text.slice(cursor, idx), match: false });
    parts.push({ text: text.slice(idx, idx + q.length), match: true });
    cursor = idx + q.length;
  }
  return parts.length > 0 ? parts : [{ text, match: false }];
}
