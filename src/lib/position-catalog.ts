import type { PaymentApprovalStep } from "@/lib/request-for-payment-approval";
import type { ItemRequisitionApprovalStep } from "@/lib/item-requisition-approval";
import type { FundTransferApprovalStep } from "@/lib/fund-transfer-approval";
import type { JobOrderApprovalStep } from "@/lib/job-order-approval";
import {
  ACA_APPROVING_PATH_LABELS,
  ACA_RECOMMENDING_LABELS,
  type AcaApprovingPath,
  type AcaRecommendingLevel,
} from "@/lib/aca-authority-matrix";

/** Maps RFP procedural steps to position catalog codes. */
export const RFP_STEP_POSITION_CODES: Record<PaymentApprovalStep, string> = {
  NOTED_BY: "RFP_NOTED_BY",
  APPROVED_BY: "RFP_APPROVED_BY",
  APPROVED_BY_ACCOUNTING: "RFP_BOOKKEEPER",
  APPROVED_BY_FINANCE: "RFP_FINANCE",
};

/** Item Requisition Slip (RS) steps → position codes. */
export const RS_STEP_POSITION_CODES: Record<ItemRequisitionApprovalStep, string> = {
  CANVASSED_BY: "RS_CANVASSED_BY",
  APPROVED_BY: "RS_APPROVED_BY",
};

/** Fund Transfer Request steps → position codes (Prepared By is the creator). */
export const FTR_STEP_POSITION_CODES: Partial<Record<FundTransferApprovalStep, string>> = {
  RECOMMENDING_APPROVAL: "FTR_RECOMMENDING",
  APPROVED_BY: "FTR_APPROVED_BY",
};

/** Job Order steps → position codes (Submitted By is the creator). */
export const JO_STEP_POSITION_CODES: Partial<Record<JobOrderApprovalStep, string>> = {
  NOTED_BY: "JO_NOTED_BY",
  APPROVED_BY: "JO_APPROVED_BY",
  APPROVED_BY_2: "JO_APPROVED_BY_2",
};

export function acaRecommendingPositionCode(level: AcaRecommendingLevel): string {
  return level;
}

export function acaApprovingPositionCode(path: AcaApprovingPath): string {
  return path;
}

export const POSITION_CODE_LABELS: Record<string, string> = {
  ...ACA_RECOMMENDING_LABELS,
  ...ACA_APPROVING_PATH_LABELS,
  FINANCE: "Finance Manager",
  RFP_NOTED_BY: "RFP — Noted By",
  RFP_APPROVED_BY: "RFP — Approved By",
  RFP_BOOKKEEPER: "RFP — Prepared by Bookkeeper",
  RFP_FINANCE: "RFP — Approved By Accounting",
  RS_CANVASSED_BY: "RS — Canvassed By (Assignment Board)",
  RS_APPROVED_BY: "RS — Approved By (requestor company)",
  FTR_RECOMMENDING: "FTR — Recommending Approval",
  FTR_APPROVED_BY: "FTR — Approved By",
  JO_NOTED_BY: "JO — Noted By",
  JO_APPROVED_BY: "JO — Approved By (1)",
  JO_APPROVED_BY_2: "JO — Approved By (2)",
  TRAVEL_APPROVER_L2: "Travel Order — Layer 2 Approver",
  WPMA_COO: "Travel Order — Chief Operating Officer (COO)",
  WPMA_CEO: "Travel Order — Chief Executive Officer (CEO)",
};

/** Catalog sections for admin UI (order = display order). */
export type PositionCatalogGroupId =
  | "aca"
  | "rfp"
  | "rs"
  | "ftr"
  | "jo"
  | "travel"
  | "wpma"
  | "other";

export type PositionCatalogGroup = {
  id: PositionCatalogGroupId;
  label: string;
  description: string;
  /** Match position.code against these prefixes or exact codes. */
  match: (code: string) => boolean;
};

export const POSITION_CATALOG_GROUPS: PositionCatalogGroup[] = [
  {
    id: "aca",
    label: "Authority to Conduct Activity (ACA)",
    description: "Recommending (RA) and approving (AP) Authority Matrix seats",
    match: (code) =>
      code.startsWith("RA_") ||
      code.startsWith("AP_") ||
      code === "EXECOM" ||
      code === "FOUR_EXECOMS" ||
      code === "ALL_EXECOM" ||
      code === "FINANCE",
  },
  {
    id: "rfp",
    label: "Request for Payment (RFP)",
    description: "Noted By → Approved By → Bookkeeper → Finance",
    match: (code) => code.startsWith("RFP_"),
  },
  {
    id: "rs",
    label: "Item Requisition Slip (RS)",
    description: "Canvassed By (Assignment Board) → Approved By (requestor company)",
    match: (code) => code.startsWith("RS_"),
  },
  {
    id: "ftr",
    label: "Fund Transfer Request (FTR)",
    description: "Recommending Approval → Approved By",
    match: (code) => code.startsWith("FTR_"),
  },
  {
    id: "jo",
    label: "Job Order (JO)",
    description: "Noted By → Approved By ×2",
    match: (code) => code.startsWith("JO_"),
  },
  {
    id: "travel",
    label: "Travel Order (legacy)",
    description: "Org-chart layer approvers for legacy travel orders",
    match: (code) => code.startsWith("TRAVEL_"),
  },
  {
    id: "wpma",
    label: "Travel Order for Management Approval",
    description: "COO → CEO management approval seats",
    match: (code) => code === "WPMA_COO" || code === "WPMA_CEO",
  },
  {
    id: "other",
    label: "Other",
    description: "Custom or uncategorized positions",
    match: () => true,
  },
];

export function positionCatalogGroupId(code: string): PositionCatalogGroupId {
  for (const group of POSITION_CATALOG_GROUPS) {
    if (group.id === "other") continue;
    if (group.match(code)) return group.id;
  }
  return "other";
}

/** Legacy portal role → suggested primary position (soft mapping during transition). */
export const LEGACY_ROLE_POSITION_HINTS: Record<string, string> = {
  Admin: "RA_2",
  Personnel: "RA_1",
  SuperAdmin: "AP_4",
  HighAdmin: "AP_3",
};

export function positionCodeLabel(code: string): string {
  return POSITION_CODE_LABELS[code] ?? code.replaceAll("_", " ");
}
