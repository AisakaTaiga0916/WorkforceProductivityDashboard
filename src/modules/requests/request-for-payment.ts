/** Shared helpers for Request for Payment intake. */

export const MODE_OF_PAYMENT_OPTIONS = [
  "Check",
  "For Manager's Check Issuance",
  "Online direct to Payee's Bank Account #",
  "Payroll",
  "Auto Debit",
] as const;

export const DELIVERY_OF_CHECK_OPTIONS = [
  "Pickup",
  "Encashment",
  "Online Deposit",
] as const;

export const MODE_OF_PAYMENT_CHECK = "Check";
export const MODE_OF_PAYMENT_ONLINE_DIRECT = "Online direct to Payee's Bank Account #";
export const DELIVERY_OF_CHECK_ONLINE_DEPOSIT = "Online Deposit";

/** Show bank name / account number for online deposit paths. */
export function paymentModeShowsBankDetails(
  modeOfPayment: string,
  deliveryOfCheck?: string | null,
): boolean {
  const mode = modeOfPayment.trim();
  if (mode === MODE_OF_PAYMENT_ONLINE_DIRECT) return true;
  return (
    mode === MODE_OF_PAYMENT_CHECK &&
    (deliveryOfCheck ?? "").trim() === DELIVERY_OF_CHECK_ONLINE_DEPOSIT
  );
}

/** Bank name / account number is required only for online direct to payee. */
export function paymentModeRequiresBankDetails(
  modeOfPayment: string,
  _deliveryOfCheck?: string | null,
): boolean {
  return modeOfPayment.trim() === MODE_OF_PAYMENT_ONLINE_DIRECT;
}

export type PaymentRequestFields = {
  payee: string;
  inPaymentOf: string;
  accountTitle: string;
  amount: string;
  modeOfPayment: string;
  deliveryOfCheck?: string;
  bankNameAccountNumber?: string;
  notes?: string;
};

/** Display amount with peso sign, thousands separators, and two decimals (e.g. ₱10,000.00). */
export function formatPaymentPeso(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const n = Number(v.replace(/[₱,\s]/g, ""));
  if (!Number.isFinite(n)) return v;
  return `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Normalize typed amount to two decimal places (no currency symbol). */
export function normalizePaymentAmountInput(raw: string): string {
  const v = raw.replace(/[₱,\s]/g, "").trim();
  if (!v) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toFixed(2);
}

export function formatPaymentRequestTitle(
  fields: Pick<PaymentRequestFields, "payee" | "inPaymentOf" | "amount">,
): string {
  const of = fields.inPaymentOf.trim();
  const payee = fields.payee.trim();
  const amount = formatPaymentPeso(fields.amount) || fields.amount.trim();
  const base = of || payee || "Request for payment";
  const withAmount = amount ? `${base} · ${amount}` : base;
  return withAmount.slice(0, 200);
}

export function formatPaymentRequestDescription(fields: PaymentRequestFields): string {
  const amountDisplay = formatPaymentPeso(fields.amount) || fields.amount.trim();
  const lines = [
    `Payee: ${fields.payee.trim()}`,
    `In payment of: ${fields.inPaymentOf.trim()}`,
  ];
  const accountTitle = fields.accountTitle.trim();
  if (accountTitle) {
    lines.push(`Account title: ${accountTitle}`);
  }
  lines.push(`Amount: ${amountDisplay}`);
  const mode = fields.modeOfPayment.trim();
  if (mode) {
    lines.push(`Mode of payment: ${mode}`);
  }
  const delivery = (fields.deliveryOfCheck ?? "").trim();
  if (delivery) {
    lines.push(`Delivery of check: ${delivery}`);
  }
  const bank = (fields.bankNameAccountNumber ?? "").trim();
  if (bank) {
    lines.push(`Bank name / account number: ${bank}`);
  }
  const notes = (fields.notes ?? "").trim();
  if (notes) {
    lines.push("", "Additional notes:", notes);
  }
  return lines.join("\n");
}

/** Pull Account title from a formatted payment description (for board card previews). */
export function extractPaymentAccountTitle(description: string | null | undefined): string | null {
  const raw = (description ?? "").trim();
  if (!raw) return null;
  const match = /^Account title:\s*(.+)$/im.exec(raw);
  const value = match?.[1]?.trim();
  return value || null;
}

/** Ticket-board preview for RFP: In payment of + Amount only. */
export function extractPaymentBoardPreview(description: string | null | undefined): string | null {
  const parsed = parsePaymentRequestDescription(description);
  if (!parsed) return null;
  const of = parsed.inPaymentOf.trim();
  const amount = formatPaymentPeso(parsed.amount) || parsed.amount.trim();
  if (of && amount) return `${of} · ${amount}`;
  return of || amount || null;
}

function fieldFromDescription(description: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(.+)$`, "im").exec(description);
  const value = match?.[1]?.trim();
  return value || null;
}

/** Parse structured payment fields from a stored description (or return null if not a payment body). */
export function parsePaymentRequestDescription(
  description: string | null | undefined,
): PaymentRequestFields | null {
  const raw = (description ?? "").trim();
  if (!raw) return null;
  const payee = fieldFromDescription(raw, "Payee");
  const inPaymentOf = fieldFromDescription(raw, "In payment of");
  const accountTitle = fieldFromDescription(raw, "Account title");
  const amount = fieldFromDescription(raw, "Amount");
  const modeOfPayment = fieldFromDescription(raw, "Mode of payment");
  if (!payee && !inPaymentOf && !accountTitle && !amount) {
    return null;
  }
  const notesMatch = /(?:^|\n)Additional notes:\s*\n([\s\S]*)$/i.exec(raw);
  return {
    payee: payee ?? "",
    inPaymentOf: inPaymentOf ?? "",
    accountTitle: accountTitle ?? "",
    amount: amount ?? "",
    modeOfPayment: modeOfPayment ?? "",
    deliveryOfCheck: fieldFromDescription(raw, "Delivery of check") ?? undefined,
    bankNameAccountNumber: fieldFromDescription(raw, "Bank name / account number") ?? undefined,
    notes: notesMatch?.[1]?.trim() || undefined,
  };
}

export type PaymentModePatch = {
  modeOfPayment: string;
  deliveryOfCheck?: string;
  bankNameAccountNumber?: string;
};

/** Validate mode / delivery / bank fields filled at APPROVED BY ACCOUNTING. */
export function validatePaymentModeFields(
  patch: PaymentModePatch,
): { ok: true; fields: PaymentModePatch } | { ok: false; error: string } {
  const modeOfPayment = patch.modeOfPayment.trim();
  const deliveryOfCheck = (patch.deliveryOfCheck ?? "").trim();
  const bankNameAccountNumber = (patch.bankNameAccountNumber ?? "").trim();
  if (!modeOfPayment) {
    return { ok: false, error: "Mode of payment is required." };
  }
  if (!(MODE_OF_PAYMENT_OPTIONS as readonly string[]).includes(modeOfPayment)) {
    return { ok: false, error: "Invalid mode of payment." };
  }
  if (modeOfPayment === MODE_OF_PAYMENT_CHECK) {
    if (!deliveryOfCheck) {
      return { ok: false, error: "Delivery of check is required when Mode of payment is Check." };
    }
    if (!(DELIVERY_OF_CHECK_OPTIONS as readonly string[]).includes(deliveryOfCheck)) {
      return { ok: false, error: "Invalid delivery of check." };
    }
  }
  if (paymentModeRequiresBankDetails(modeOfPayment, deliveryOfCheck) && !bankNameAccountNumber) {
    return {
      ok: false,
      error:
        "Bank name / account number is required for Online direct to Payee's Bank Account #.",
    };
  }
  if (
    modeOfPayment.length > 120 ||
    deliveryOfCheck.length > 80 ||
    bankNameAccountNumber.length > 200
  ) {
    return { ok: false, error: "A payment mode field exceeds the maximum length." };
  }
  return {
    ok: true,
    fields: {
      modeOfPayment,
      deliveryOfCheck: modeOfPayment === MODE_OF_PAYMENT_CHECK ? deliveryOfCheck : "",
      bankNameAccountNumber: paymentModeShowsBankDetails(modeOfPayment, deliveryOfCheck)
        ? bankNameAccountNumber
        : "",
    },
  };
}

/** Merge mode-of-payment fields into an existing RFP description body. */
export function applyPaymentModeToFields(
  existing: PaymentRequestFields,
  patch: PaymentModePatch,
): PaymentRequestFields {
  const mode = patch.modeOfPayment.trim();
  const delivery =
    mode === MODE_OF_PAYMENT_CHECK ? (patch.deliveryOfCheck ?? "").trim() : "";
  const bank = paymentModeShowsBankDetails(mode, delivery)
    ? (patch.bankNameAccountNumber ?? "").trim()
    : "";
  return {
    ...existing,
    modeOfPayment: mode,
    deliveryOfCheck: delivery || undefined,
    bankNameAccountNumber: bank || undefined,
  };
}
