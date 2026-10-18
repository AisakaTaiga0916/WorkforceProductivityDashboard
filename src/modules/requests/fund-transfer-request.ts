/** Shared helpers for Fund Transfer Request Form intake. */

export type FundTransferRequestFields = {
  requestingDepartmentBusinessUnit: string;
  fundTransferAmount: string;
  fromAccountName: string;
  fromAccountNumber: string;
  toAccountName: string;
  toAccountNumber: string;
  bankName: string;
  bankAddress: string;
  reason?: string;
};

export function formatFundTransferRequestTitle(
  fields: Pick<FundTransferRequestFields, "fundTransferAmount" | "fromAccountName" | "toAccountName">,
): string {
  const amount = fields.fundTransferAmount.trim();
  const from = fields.fromAccountName.trim();
  const to = fields.toAccountName.trim();
  const base =
    from && to
      ? `${from} → ${to}`
      : from || to || "Fund transfer request";
  const withAmount = amount ? `${base} · ${amount}` : base;
  return withAmount.slice(0, 200);
}

export function formatFundTransferRequestDescription(fields: FundTransferRequestFields): string {
  const lines: string[] = [];
  const dept = fields.requestingDepartmentBusinessUnit.trim();
  if (dept) {
    lines.push(`Requesting department: ${dept}`);
  }
  lines.push(
    `Fund transfer amount: ${fields.fundTransferAmount.trim()}`,
    `From account name: ${fields.fromAccountName.trim()}`,
    `From account number: ${fields.fromAccountNumber.trim()}`,
    `To account name: ${fields.toAccountName.trim()}`,
    `To account number: ${fields.toAccountNumber.trim()}`,
    `Bank name: ${fields.bankName.trim()}`,
    `Bank address: ${fields.bankAddress.trim()}`,
  );
  const reason = (fields.reason ?? "").trim();
  if (reason) {
    lines.push("", "Reason for the transfer / special instruction:", reason);
  }
  return lines.join("\n");
}

/** Display amount with peso sign, thousands separators, and two decimals (e.g. ₱150,000.00). */
export function formatFundTransferPeso(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const n = Number(v.replace(/[₱,\s]/g, ""));
  if (!Number.isFinite(n)) return v;
  return `₱${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pull purpose/reason (preferred) or amount for board card previews. */
export function extractFundTransferPreview(description: string | null | undefined): string | null {
  const raw = (description ?? "").trim();
  if (!raw) return null;
  const parsed = parseFundTransferRequestDescription(raw);
  const purpose = parsed?.reason?.trim();
  if (purpose) return purpose.slice(0, 120);
  const amount = /^Fund transfer amount:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  if (amount) return amount;
  const from = /^From account name:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  const to = /^To account name:\s*(.+)$/im.exec(raw)?.[1]?.trim();
  if (from && to) return `${from} → ${to}`;
  return from || to || null;
}

function fieldFromDescription(description: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(.+)$`, "im").exec(description);
  const value = match?.[1]?.trim();
  return value || null;
}

/** Parse structured fund transfer fields from a stored description. */
export function parseFundTransferRequestDescription(
  description: string | null | undefined,
): FundTransferRequestFields | null {
  const raw = (description ?? "").trim();
  if (!raw) return null;
  const requestingDepartmentBusinessUnit = fieldFromDescription(
    raw,
    "Requesting department",
  );
  const fundTransferAmount = fieldFromDescription(raw, "Fund transfer amount");
  const fromAccountName = fieldFromDescription(raw, "From account name");
  const fromAccountNumber = fieldFromDescription(raw, "From account number");
  const toAccountName = fieldFromDescription(raw, "To account name");
  const toAccountNumber = fieldFromDescription(raw, "To account number");
  const bankName = fieldFromDescription(raw, "Bank name");
  const bankAddress = fieldFromDescription(raw, "Bank address");
  if (
    !requestingDepartmentBusinessUnit &&
    !fundTransferAmount &&
    !fromAccountName &&
    !fromAccountNumber &&
    !toAccountName &&
    !toAccountNumber &&
    !bankName &&
    !bankAddress
  ) {
    return null;
  }
  const reasonMatch =
    /(?:^|\n)Reason for the transfer \/ special instruction:\s*\n?([\s\S]*)$/i.exec(raw);
  return {
    requestingDepartmentBusinessUnit: requestingDepartmentBusinessUnit ?? "",
    fundTransferAmount: fundTransferAmount ?? "",
    fromAccountName: fromAccountName ?? "",
    fromAccountNumber: fromAccountNumber ?? "",
    toAccountName: toAccountName ?? "",
    toAccountNumber: toAccountNumber ?? "",
    bankName: bankName ?? "",
    bankAddress: bankAddress ?? "",
    reason: reasonMatch?.[1]?.trim() || undefined,
  };
}

export function validateFundTransferRequestFields(
  fields: FundTransferRequestFields,
): { ok: true } | { ok: false; error: string } {
  if (fields.requestingDepartmentBusinessUnit.trim().length > 200) {
    return { ok: false, error: "Requesting department is too long." };
  }
  if (!fields.fundTransferAmount.trim()) {
    return { ok: false, error: "Fund transfer amount is required." };
  }
  const amount = Number(fields.fundTransferAmount.trim().replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Fund transfer amount must be a positive number." };
  }
  if (!fields.fromAccountName.trim()) {
    return { ok: false, error: "From account name is required." };
  }
  if (!fields.fromAccountNumber.trim()) {
    return { ok: false, error: "From account number is required." };
  }
  if (!fields.toAccountName.trim()) {
    return { ok: false, error: "To account name is required." };
  }
  if (!fields.toAccountNumber.trim()) {
    return { ok: false, error: "To account number is required." };
  }
  if (!fields.bankName.trim()) {
    return { ok: false, error: "Bank name is required." };
  }
  if (!fields.bankAddress.trim()) {
    return { ok: false, error: "Bank address is required." };
  }
  if (fields.fromAccountName.trim().length > 200) {
    return { ok: false, error: "From account name is too long." };
  }
  if (fields.fromAccountNumber.trim().length > 80) {
    return { ok: false, error: "From account number is too long." };
  }
  if (fields.toAccountName.trim().length > 200) {
    return { ok: false, error: "To account name is too long." };
  }
  if (fields.toAccountNumber.trim().length > 80) {
    return { ok: false, error: "To account number is too long." };
  }
  if (fields.bankName.trim().length > 200) {
    return { ok: false, error: "Bank name is too long." };
  }
  if (fields.bankAddress.trim().length > 500) {
    return { ok: false, error: "Bank address is too long." };
  }
  if ((fields.reason ?? "").trim().length > 4000) {
    return { ok: false, error: "Reason / special instruction is too long." };
  }
  return { ok: true };
}
