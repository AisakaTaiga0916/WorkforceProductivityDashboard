/** Intake request kinds shown before the create form. */
export const REQUEST_TYPES = [
  {
    id: "ISSUE_CONCERN_TICKET",
    label: "ISSUE/CONCERN TICKET",
    acronym: "TICKET",
    description: "Report an issue or concern using the standard ticketing form.",
  },
  {
    id: "REQUEST_FOR_PAYMENT",
    label: "REQUEST FOR PAYMENT",
    acronym: "R.F.P.",
    description: "Submit a payment request for processing.",
  },
  {
    id: "ITEM_REQUISITION_SLIP",
    label: "ITEM REQUISITION SLIP",
    acronym: "R.S.",
    description: "Request items or supplies for your team.",
  },
  {
    id: "FUND_TRANSFER_REQUEST",
    label: "FUND TRANSFER REQUEST FORM",
    acronym: "F.T.R.",
    description: "Request a fund transfer between accounts or cost centers.",
  },
  {
    id: "JOB_ORDER",
    label: "JOB ORDER",
    acronym: "J.O.",
    description: "Submit a job order for project or task work (building, dates, and nature of concern).",
  },
] as const;

export type RequestTypeId = (typeof REQUEST_TYPES)[number]["id"];

export const DEFAULT_REQUEST_TYPE: RequestTypeId = "ISSUE_CONCERN_TICKET";

/** RFP / IRS / FTR run on approval seats — never credited to the board assignee as handling work. */
export const PROCEDURAL_REQUEST_TYPES = [
  "REQUEST_FOR_PAYMENT",
  "ITEM_REQUISITION_SLIP",
  "FUND_TRANSFER_REQUEST",
] as const satisfies readonly RequestTypeId[];

export function isRequestTypeId(value: unknown): value is RequestTypeId {
  return typeof value === "string" && REQUEST_TYPES.some((t) => t.id === value);
}

export function parseRequestTypeId(value: unknown): RequestTypeId {
  return isRequestTypeId(value) ? value : DEFAULT_REQUEST_TYPE;
}

/**
 * Recommended destination department name for intake “Send request to (department)”.
 * Matched against Manage departments names (case-insensitive).
 */
export function recommendedSendToDepartmentName(
  requestType: RequestTypeId | null | undefined,
): string | null {
  switch (requestType) {
    case "ITEM_REQUISITION_SLIP":
      return "PROCUREMENT";
    case "FUND_TRANSFER_REQUEST":
      return "FINANCE";
    case "REQUEST_FOR_PAYMENT":
      return "ACCOUNTING";
    case "JOB_ORDER":
      return "GENERAL SERVICES";
    default:
      return null;
  }
}

export function requestTypeLabel(id: string | null | undefined): string {
  const found = REQUEST_TYPES.find((t) => t.id === id);
  return found?.label ?? (id?.trim() || "ISSUE/CONCERN TICKET");
}

/** Short badge text for boards (TICKET, R.F.P., R.S., F.T.R., J.O.). */
export function requestTypeAcronym(idOrLabel: string | null | undefined): string {
  const raw = (idOrLabel ?? "").trim();
  if (!raw) return "TICKET";
  const byId = REQUEST_TYPES.find((t) => t.id === raw);
  if (byId) return byId.acronym;
  const normalized = raw.toUpperCase();
  // Legacy acronym before R.S. rename.
  if (normalized === "I.R.S." || normalized === "IRS") {
    return "R.S.";
  }
  const byLabel = REQUEST_TYPES.find(
    (t) =>
      t.label === normalized ||
      t.acronym === normalized ||
      t.acronym === raw ||
      t.label.toUpperCase() === normalized,
  );
  if (byLabel) return byLabel.acronym;
  return "TICKET";
}

export function isIssueConcernTicket(id: string | null | undefined): boolean {
  return parseRequestTypeId(id) === "ISSUE_CONCERN_TICKET";
}

/** Procedural request types that use approval chains instead of personnel transfer. */
export function requestTypeSupportsTransfer(id: string | null | undefined): boolean {
  const type = (id ?? "").trim();
  if (!type) return true;
  return (
    type !== "REQUEST_FOR_PAYMENT" &&
    type !== "FUND_TRANSFER_REQUEST" &&
    type !== "JOB_ORDER"
  );
}
