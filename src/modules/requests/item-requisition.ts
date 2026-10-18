/** Shared helpers for Item Requisition Slip intake. */

export const REQUISITION_UNIT_OPTIONS = [
  "pcs",
  "box",
  "set",
  "pack",
  "roll",
  "unit",
  "pair",
  "ream",
  "kg",
  "liter",
  "other",
] as const;

export type RequisitionLineItem = {
  itemNumber: string;
  quantity: string;
  unit: string;
  particular: string;
  /** Filled by assignee after Assignment Board assignment. */
  priceQuotation?: string;
  unitPrice?: string;
  total?: string;
  nameOfSupplier?: string;
  terms?: string;
};

export type ItemRequisitionFields = {
  items: RequisitionLineItem[];
  purposeOfRequest: string;
};

export function emptyRequisitionLineItem(index = 0): RequisitionLineItem {
  return {
    itemNumber: String(index + 1),
    quantity: "",
    unit: "pcs",
    particular: "",
    priceQuotation: "",
    unitPrice: "",
    total: "",
    nameOfSupplier: "",
    terms: "",
  };
}

/** Prefer PRICE QUOTATION = QUANTITY × UNIT PRICE; fall back to stored quotation/total. */
export function computeRequisitionPriceQuotation(
  item: Pick<RequisitionLineItem, "quantity" | "unitPrice" | "priceQuotation" | "total">,
): string {
  const qty = Number(item.quantity);
  const unit = Number(String(item.unitPrice ?? "").replace(/[₱,\s]/g, ""));
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(unit) && unit >= 0) {
    return formatRequisitionMoney(String(qty * unit));
  }
  const fromQuote = (item.priceQuotation ?? "").trim();
  if (fromQuote && Number.isFinite(Number(fromQuote.replace(/[₱,\s]/g, "")))) {
    return formatRequisitionMoney(fromQuote);
  }
  const fromTotal = (item.total ?? "").trim();
  if (fromTotal && Number.isFinite(Number(fromTotal.replace(/[₱,\s]/g, "")))) {
    return formatRequisitionMoney(fromTotal);
  }
  return "";
}

/** @deprecated Use computeRequisitionPriceQuotation — line amount is now price quotation. */
export function computeRequisitionLineTotal(
  item: Pick<RequisitionLineItem, "quantity" | "unitPrice" | "total" | "priceQuotation">,
): string {
  return computeRequisitionPriceQuotation(item);
}

/** Grand total = sum of all Price Quotations. */
export function sumRequisitionListedItemsTotal(
  items: Array<Pick<RequisitionLineItem, "quantity" | "unitPrice" | "total" | "priceQuotation">>,
): string {
  let sum = 0;
  let any = false;
  for (const item of items) {
    const line = computeRequisitionPriceQuotation(item).trim();
    if (!line) continue;
    const n = Number(line.replace(/[₱,\s]/g, ""));
    if (!Number.isFinite(n)) continue;
    sum += n;
    any = true;
  }
  if (!any) return "";
  return formatRequisitionMoney(String(sum));
}

/** Keep an existing unit price; no longer derived from total ÷ quantity. */
export function computeRequisitionUnitPrice(
  item: Pick<RequisitionLineItem, "quantity" | "total" | "priceQuotation" | "unitPrice">,
): string {
  const existing = (item.unitPrice ?? "").trim();
  return existing ? formatRequisitionMoney(existing) : "";
}

function formatRequisitionMoney(raw: string): string {
  const n = Number(String(raw).replace(/[₱,\s]/g, "").trim());
  if (!Number.isFinite(n)) return String(raw).trim();
  return n.toFixed(2);
}

/** Display money with peso sign, thousands separators, and two decimals (e.g. ₱1,000.00). */
export function formatRequisitionPeso(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const n = Number(v.replace(/[₱,\s]/g, ""));
  if (!Number.isFinite(n)) return v;
  return `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Normalize a typed money value to two decimal places (no currency symbol). */
export function normalizeRequisitionMoneyInput(raw: string): string {
  const v = raw.replace(/[₱,\s]/g, "").trim();
  if (!v) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toFixed(2);
}

/** Allow only float characters while typing (digits, one `.`; strips ₱ and commas). */
export function sanitizeRequisitionFloatInput(raw: string): string {
  const cleaned = raw.replace(/[₱,\s]/g, "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot < 0) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

/** Allow only non-negative integer characters while typing. */
export function sanitizeRequisitionIntegerInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isRequisitionFloatValue(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  return /^(?:\d+\.?\d*|\.\d+)$/.test(v) && Number.isFinite(Number(v));
}

export function isRequisitionIntegerValue(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  return /^\d+$/.test(v);
}

export function parseRequisitionFloat(raw: string): number | null {
  const v = raw.replace(/[₱,\s]/g, "").trim();
  if (!v || !isRequisitionFloatValue(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseRequisitionInteger(raw: string): number | null {
  const v = raw.trim();
  if (!v || !isRequisitionIntegerValue(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Apply PRICE QUOTATION = QUANTITY × UNIT PRICE (unit price is the editable input). */
export function applyRequisitionPricingDerivedFields(
  item: RequisitionLineItem,
): RequisitionLineItem {
  const unitPrice = computeRequisitionUnitPrice(item);
  const withUnit = {
    ...item,
    unitPrice,
    nameOfSupplier: (item.nameOfSupplier ?? "").trim(),
    terms: (item.terms ?? "").trim(),
  };
  const priceQuotation = computeRequisitionPriceQuotation(withUnit);
  return {
    ...withUnit,
    priceQuotation,
    // Keep total aligned with price quotation for backward-compatible stored descriptions.
    total: priceQuotation,
  };
}

export function formatItemRequisitionTitle(fields: ItemRequisitionFields): string {
  const purpose = fields.purposeOfRequest.trim();
  const count = fields.items.filter((i) => i.particular.trim() || i.quantity.trim()).length;
  const base = purpose || "Item requisition";
  const withCount = count > 0 ? `${base} · ${count} item${count === 1 ? "" : "s"}` : base;
  return withCount.slice(0, 200);
}

export function formatItemRequisitionDescription(fields: ItemRequisitionFields): string {
  const lines: string[] = ["Requisition items:"];
  fields.items.forEach((item, index) => {
    const n = index + 1;
    lines.push(
      `Item ${n}:`,
      `  ITEM #: ${item.itemNumber.trim() || String(n)}`,
      `  QUANTITY: ${item.quantity.trim()}`,
      `  UNIT: ${item.unit.trim()}`,
      `  PARTICULAR/MATERIAL/SPECIFICATION: ${item.particular.trim()}`,
    );
    const derived = applyRequisitionPricingDerivedFields(item);
    const priceQuotation = (derived.priceQuotation ?? "").trim();
    const unitPrice = (derived.unitPrice ?? "").trim();
    const nameOfSupplier = (item.nameOfSupplier ?? "").trim();
    const terms = (item.terms ?? "").trim();
    if (priceQuotation || unitPrice || nameOfSupplier || terms) {
      lines.push(
        `  PRICE QUOTATION: ${priceQuotation}`,
        `  UNIT PRICE: ${unitPrice}`,
        `  NAME OF SUPPLIER: ${nameOfSupplier}`,
        `  TERMS: ${terms}`,
      );
    }
  });
  const purpose = fields.purposeOfRequest.trim();
  if (purpose) {
    lines.push("", "PURPOSE OF REQUEST:", purpose);
  }
  return lines.join("\n");
}

function fieldFromBlock(block: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^\\s*${escaped}:\\s*(.*)$`, "im").exec(block);
  return match?.[1]?.trim() ?? "";
}

/** Parse structured requisition fields from a stored description (or null if not a requisition body). */
export function parseItemRequisitionDescription(
  description: string | null | undefined,
): ItemRequisitionFields | null {
  const raw = (description ?? "").trim();
  if (!raw || !/^Requisition items:/im.test(raw)) return null;

  const purposeMatch = /(?:^|\n)PURPOSE OF REQUEST:\s*\n?([\s\S]*)$/i.exec(raw);
  let purposeOfRequest = purposeMatch?.[1]?.trim() ?? "";
  // Legacy slip-level supplier/terms lived after purpose — strip from purpose text.
  const legacySupplier = /(?:^|\n)NAME OF SUPPLIER:\s*(.*)$/im.exec(purposeOfRequest)?.[1]?.trim() ?? "";
  const legacyTerms = /(?:^|\n)TERMS:\s*(.*)$/im.exec(purposeOfRequest)?.[1]?.trim() ?? "";
  purposeOfRequest = purposeOfRequest
    .replace(/(?:^|\n)NAME OF SUPPLIER:\s*.*$/gim, "")
    .replace(/(?:^|\n)TERMS:\s*.*$/gim, "")
    .trim();

  const itemsSection = purposeMatch ? raw.slice(0, purposeMatch.index) : raw;

  const itemBlocks = itemsSection.split(/(?=^Item \d+:)/im).filter((b) => /^Item \d+:/im.test(b.trim()));
  const items: RequisitionLineItem[] = itemBlocks.map((block, index) => ({
    itemNumber: fieldFromBlock(block, "ITEM #") || String(index + 1),
    quantity: fieldFromBlock(block, "QUANTITY"),
    unit: fieldFromBlock(block, "UNIT"),
    particular: fieldFromBlock(block, "PARTICULAR/MATERIAL/SPECIFICATION"),
    priceQuotation: fieldFromBlock(block, "PRICE QUOTATION"),
    unitPrice: fieldFromBlock(block, "UNIT PRICE"),
    total: fieldFromBlock(block, "TOTAL"),
    nameOfSupplier: fieldFromBlock(block, "NAME OF SUPPLIER"),
    terms: fieldFromBlock(block, "TERMS"),
  }));

  // Migrate legacy slip-level supplier/terms onto the first line if items lack them.
  if ((legacySupplier || legacyTerms) && items.length > 0) {
    const first = items[0]!;
    if (!(first.nameOfSupplier ?? "").trim() && legacySupplier) first.nameOfSupplier = legacySupplier;
    if (!(first.terms ?? "").trim() && legacyTerms) first.terms = legacyTerms;
  }

  if (items.length === 0 && !purposeOfRequest) return null;
  return {
    items: items.length > 0 ? items : [emptyRequisitionLineItem()],
    purposeOfRequest,
  };
}

export function validateItemRequisitionFields(
  fields: ItemRequisitionFields,
): { ok: true } | { ok: false; error: string } {
  if (!fields.purposeOfRequest.trim()) {
    return { ok: false, error: "Purpose of request is required." };
  }
  if (fields.purposeOfRequest.trim().length > 2000) {
    return { ok: false, error: "Purpose of request must be at most 2000 characters." };
  }
  if (!fields.items.length) {
    return { ok: false, error: "Add at least one requisition line item." };
  }
  for (let i = 0; i < fields.items.length; i++) {
    const item = fields.items[i]!;
    const label = `Item ${i + 1}`;
    if (!item.itemNumber.trim()) {
      return { ok: false, error: `${label}: ITEM # is required.` };
    }
    if (!item.quantity.trim()) {
      return { ok: false, error: `${label}: QUANTITY is required.` };
    }
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: `${label}: QUANTITY must be a positive number.` };
    }
    if (!item.unit.trim()) {
      return { ok: false, error: `${label}: UNIT is required.` };
    }
    if (!item.particular.trim()) {
      return { ok: false, error: `${label}: PARTICULAR/MATERIAL/SPECIFICATION is required.` };
    }
    if (item.itemNumber.trim().length > 80) {
      return { ok: false, error: `${label}: ITEM # is too long.` };
    }
    if (item.unit.trim().length > 40) {
      return { ok: false, error: `${label}: UNIT is too long.` };
    }
    if (item.particular.trim().length > 1000) {
      return { ok: false, error: `${label}: PARTICULAR/MATERIAL/SPECIFICATION is too long.` };
    }
    if ((item.priceQuotation ?? "").trim()) {
      const priceQuotation = parseRequisitionFloat(item.priceQuotation ?? "");
      if (priceQuotation === null || priceQuotation < 0) {
        return { ok: false, error: `${label}: PRICE QUOTATION must be a non-negative float.` };
      }
    }
    if ((item.nameOfSupplier ?? "").trim().length > 200) {
      return { ok: false, error: `${label}: NAME OF SUPPLIER is too long.` };
    }
    if ((item.terms ?? "").trim()) {
      const terms = parseRequisitionInteger(item.terms ?? "");
      if (terms === null || terms < 0) {
        return { ok: false, error: `${label}: TERMS must be a non-negative integer.` };
      }
    }
    if ((item.unitPrice ?? "").trim()) {
      const unitPrice = parseRequisitionFloat(item.unitPrice ?? "");
      if (unitPrice === null || unitPrice < 0) {
        return { ok: false, error: `${label}: UNIT PRICE must be a non-negative float.` };
      }
    }
    if ((item.total ?? "").trim()) {
      const total = parseRequisitionFloat(item.total ?? "");
      if (total === null || total < 0) {
        return { ok: false, error: `${label}: TOTAL must be a non-negative float.` };
      }
    }
  }
  return { ok: true };
}

/** Pricing/supplier fields validation for assignee updates (does not re-check intake-required fields). */
export function validateItemRequisitionPricing(
  items: RequisitionLineItem[],
): { ok: true } | { ok: false; error: string } {
  if (!items.length) {
    return { ok: false, error: "No requisition line items to update." };
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const label = `Item ${i + 1}`;
    if ((item.priceQuotation ?? "").trim()) {
      const priceQuotation = parseRequisitionFloat(item.priceQuotation ?? "");
      if (priceQuotation === null || priceQuotation < 0) {
        return { ok: false, error: `${label}: PRICE QUOTATION must be a non-negative float.` };
      }
    }
    if ((item.nameOfSupplier ?? "").trim().length > 200) {
      return { ok: false, error: `${label}: NAME OF SUPPLIER is too long.` };
    }
    if ((item.terms ?? "").trim()) {
      const terms = parseRequisitionInteger(item.terms ?? "");
      if (terms === null || terms < 0) {
        return { ok: false, error: `${label}: TERMS must be a non-negative integer.` };
      }
    }
    if ((item.unitPrice ?? "").trim()) {
      const unitPrice = parseRequisitionFloat(item.unitPrice ?? "");
      if (unitPrice === null || unitPrice < 0) {
        return { ok: false, error: `${label}: UNIT PRICE must be a non-negative float.` };
      }
    }
    if ((item.total ?? "").trim()) {
      const total = parseRequisitionFloat(item.total ?? "");
      if (total === null || total < 0) {
        return { ok: false, error: `${label}: TOTAL must be a non-negative float.` };
      }
    }
  }
  return { ok: true };
}

/** Normalize items from JSON body or form payload. */
export function parseRequisitionItemsPayload(raw: unknown): RequisitionLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row, index) => {
    const o = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    return {
      itemNumber: typeof o.itemNumber === "string" ? o.itemNumber : String(o.itemNumber ?? index + 1),
      quantity: typeof o.quantity === "string" ? o.quantity : String(o.quantity ?? ""),
      unit: typeof o.unit === "string" ? o.unit : String(o.unit ?? ""),
      particular: typeof o.particular === "string" ? o.particular : String(o.particular ?? ""),
      priceQuotation:
        typeof o.priceQuotation === "string" ? o.priceQuotation : String(o.priceQuotation ?? ""),
      unitPrice: typeof o.unitPrice === "string" ? o.unitPrice : String(o.unitPrice ?? ""),
      total: typeof o.total === "string" ? o.total : String(o.total ?? ""),
      nameOfSupplier:
        typeof o.nameOfSupplier === "string" ? o.nameOfSupplier : String(o.nameOfSupplier ?? ""),
      terms: typeof o.terms === "string" ? o.terms : String(o.terms ?? ""),
    };
  });
}
