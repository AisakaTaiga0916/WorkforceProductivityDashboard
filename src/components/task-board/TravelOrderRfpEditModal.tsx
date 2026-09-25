"use client";

import { useEffect, useState } from "react";
import { AmountCalculatorButton } from "@/components/task-board/AmountCalculatorModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  DELIVERY_OF_CHECK_OPTIONS,
  MODE_OF_PAYMENT_CHECK,
  MODE_OF_PAYMENT_OPTIONS,
  paymentModeRequiresBankDetails,
  paymentModeShowsBankDetails,
  type PaymentRequestFields,
} from "@/lib/request-for-payment";
import { TO_RFP_DEFAULT_IN_PAYMENT_OF } from "@/lib/travel-order-rfp-constants";

type TravelOrderRfpEditModalProps = {
  open: boolean;
  taskId: string | null;
  travelOrderId: string | null;
  initialTicketId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

type LinkedRfpLoad = {
  id: string;
  ticketNumber: string;
  awaitingTravelOrderApproval?: boolean;
  contactName?: string | null;
};

type CompanyOpt = { id: string; name: string };
type BookkeeperOpt = {
  id: string;
  name: string;
  sectionId?: string | null;
  sectionName?: string | null;
};

const emptyFields = (): PaymentRequestFields => ({
  payee: "",
  inPaymentOf: TO_RFP_DEFAULT_IN_PAYMENT_OF,
  accountTitle: "",
  amount: "",
  modeOfPayment: MODE_OF_PAYMENT_CHECK,
  deliveryOfCheck: "Encashment",
  bankNameAccountNumber: "",
  notes: "",
});

const fieldClass =
  "mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function TravelOrderRfpEditModal({
  open,
  taskId,
  travelOrderId,
  initialTicketId = null,
  onClose,
  onSaved,
}: TravelOrderRfpEditModalProps) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(initialTicketId);
  const [held, setHeld] = useState(true);
  const [requestedByName, setRequestedByName] = useState("");
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [requestBudgetFromCompanyTeamId, setRequestBudgetFromCompanyTeamId] =
    useState("");
  const [branch, setBranch] = useState("");
  const [bookkeeper, setBookkeeper] = useState<BookkeeperOpt | null>(null);
  const [fields, setFields] = useState<PaymentRequestFields>(emptyFields);
  const [letAccountingHandlePaymentMode, setLetAccountingHandlePaymentMode] =
    useState(false);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    setCompaniesLoading(true);
    void fetch("/api/public/companies", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: CompanyOpt[]) => {
        if (!ignore && Array.isArray(list)) setCompanies(list);
      })
      .catch(() => {
        if (!ignore) setCompanies([]);
      })
      .finally(() => {
        if (!ignore) setCompaniesLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !taskId || !travelOrderId) return;
    let ignore = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await fetch(
          `/api/kpi-maintenance/${taskId}/travel-orders/${travelOrderId}/linked-rfp`,
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          linkedRfp?: LinkedRfpLoad | null;
          paymentFields?: PaymentRequestFields | null;
          deferPaymentModeToAccounting?: boolean;
          requestBudgetFromCompanyTeamId?: string | null;
          bookkeeper?: BookkeeperOpt | null;
          requestedByName?: string | null;
          branch?: string | null;
        };
        if (!res.ok) {
          if (!ignore) setError(body.error ?? "Could not load Request for Payment.");
          return;
        }

        let linked = body.linkedRfp;
        let paymentFields = body.paymentFields;
        let deferMode = body.deferPaymentModeToAccounting === true;
        let budgetCompanyId = (body.requestBudgetFromCompanyTeamId ?? "").trim();
        let bookkeeperRow = body.bookkeeper ?? null;
        let branchValue = (body.branch ?? "").trim();
        let requestedBy =
          (body.linkedRfp?.contactName ?? body.requestedByName ?? "").trim();

        if (!linked) {
          const createRes = await fetch(
            `/api/kpi-maintenance/${taskId}/travel-orders/${travelOrderId}/linked-rfp`,
            { method: "POST" },
          );
          const created = (await createRes.json().catch(() => ({}))) as {
            error?: string;
            linkedRfp?: LinkedRfpLoad;
            paymentFields?: PaymentRequestFields | null;
            deferPaymentModeToAccounting?: boolean;
            requestBudgetFromCompanyTeamId?: string | null;
            bookkeeper?: BookkeeperOpt | null;
            branch?: string | null;
          };
          if (!createRes.ok || !created.linkedRfp) {
            if (!ignore) {
              setError(created.error ?? "Could not create Request for Payment.");
            }
            return;
          }
          linked = created.linkedRfp;
          paymentFields = created.paymentFields;
          deferMode = created.deferPaymentModeToAccounting === true;
          budgetCompanyId = (created.requestBudgetFromCompanyTeamId ?? "").trim();
          bookkeeperRow = created.bookkeeper ?? null;
          branchValue = (created.branch ?? "").trim();
          requestedBy = (created.linkedRfp.contactName ?? "").trim();
        }

        if (ignore || !linked) return;
        setTicketId(linked.id);
        setTicketNumber(linked.ticketNumber);
        setHeld(linked.awaitingTravelOrderApproval !== false);
        setRequestedByName(requestedBy || (linked.contactName ?? "").trim());
        setRequestBudgetFromCompanyTeamId(budgetCompanyId);
        setBranch(branchValue);
        setBookkeeper(bookkeeperRow);
        setLetAccountingHandlePaymentMode(deferMode);
        setFields({
          ...emptyFields(),
          ...(paymentFields ?? {}),
          payee:
            (paymentFields?.payee ?? "").trim() ||
            requestedBy ||
            (linked.contactName ?? "").trim(),
          inPaymentOf:
            (paymentFields?.inPaymentOf ?? "").trim() || TO_RFP_DEFAULT_IN_PAYMENT_OF,
          modeOfPayment: deferMode
            ? ""
            : paymentFields?.modeOfPayment || MODE_OF_PAYMENT_CHECK,
          deliveryOfCheck: deferMode
            ? ""
            : paymentFields?.deliveryOfCheck || "Encashment",
        });
      } catch {
        if (!ignore) setError("Could not load Request for Payment.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [open, taskId, travelOrderId, initialTicketId]);

  // Resolve bookkeeper from Request Budget From company (TO-RFP section is auto-defaulted).
  useEffect(() => {
    if (!open || !held || !taskId || !travelOrderId) return;
    if (!requestBudgetFromCompanyTeamId) {
      setBookkeeper(null);
      return;
    }
    let ignore = false;
    const params = new URLSearchParams({
      requestBudgetFromCompanyTeamId,
    });
    void fetch(
      `/api/kpi-maintenance/${taskId}/travel-orders/${travelOrderId}/linked-rfp?${params}`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { bookkeeper?: BookkeeperOpt | null } | null) => {
        if (ignore) return;
        setBookkeeper(data?.bookkeeper ?? null);
      })
      .catch(() => {
        if (!ignore) setBookkeeper(null);
      });
    return () => {
      ignore = true;
    };
  }, [open, held, taskId, travelOrderId, requestBudgetFromCompanyTeamId]);

  async function save() {
    if (!taskId || !travelOrderId) return;
    if (!requestBudgetFromCompanyTeamId.trim()) {
      setError("Request Budget From (company) is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...fields,
        payee: requestedByName || fields.payee,
        modeOfPayment: letAccountingHandlePaymentMode ? "" : fields.modeOfPayment,
        deliveryOfCheck: letAccountingHandlePaymentMode ? "" : fields.deliveryOfCheck,
        bankNameAccountNumber: letAccountingHandlePaymentMode
          ? ""
          : fields.bankNameAccountNumber,
        deferPaymentModeToAccounting: letAccountingHandlePaymentMode,
        requestBudgetFromCompanyTeamId,
        branch: branch.trim(),
      };
      const res = await fetch(
        `/api/kpi-maintenance/${taskId}/travel-orders/${travelOrderId}/linked-rfp`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        bookkeeper?: BookkeeperOpt | null;
      };
      if (!res.ok) {
        setError(body.error ?? "Could not save Request for Payment.");
        return;
      }
      if (body.bookkeeper) setBookkeeper(body.bookkeeper);
      onSaved?.();
      onClose();
    } catch {
      setError("Could not save Request for Payment.");
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !held;
  const selectedCompanyName =
    companies.find((c) => c.id === requestBudgetFromCompanyTeamId)?.name ?? null;

  return (
    <Dialog
      open={open && Boolean(taskId) && Boolean(travelOrderId)}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        overlayClassName="z-[400]"
        className={cn(
          "!fixed !inset-x-0 !top-[max(1rem,4dvh)] !bottom-auto !mx-auto !max-h-[min(calc(100dvh-2rem),920px)] !translate-x-0 !translate-y-0",
          "!flex w-[calc(100vw-1.25rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl",
          "z-[400]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-zinc-200 px-4 py-4 dark:border-zinc-800 sm:px-5">
          <DialogTitle className="text-base font-bold tracking-tight text-orange-600 dark:text-orange-400 sm:text-lg">
            {ticketNumber
              ? `REQUEST FOR PAYMENT · ${ticketNumber}`
              : "REQUEST FOR PAYMENT"}
          </DialogTitle>
          <DialogDescription className="text-sm text-zinc-600 dark:text-zinc-400">
            {held
              ? "Review and edit the payment request linked to this Work Plan. It stays held until the Work Plan is fully approved."
              : "This payment request has been released for approval. Open the ticket workspace for further changes."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
          {loading ? (
            <p className="py-6 text-sm text-zinc-600 dark:text-zinc-400">
              Loading payment request…
            </p>
          ) : (
            <div className="space-y-4">
              {error ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              {ticketId ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Ticket id: <span className="font-mono">{ticketId}</span>
                  {held ? " · awaiting Work Plan approval" : " · released"}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block min-w-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  REQUESTED BY:
                  <div className="mt-1.5 flex h-10 items-center truncate rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100">
                    {requestedByName || "—"}
                  </div>
                </label>
                <label className="block min-w-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Request Budget From:
                  <Select
                    value={requestBudgetFromCompanyTeamId}
                    disabled={readOnly || busy || companiesLoading}
                    onChange={(e) => {
                      setRequestBudgetFromCompanyTeamId(e.target.value);
                      setBookkeeper(null);
                    }}
                    className={fieldClass}
                  >
                    <option value="">
                      {companiesLoading ? "Loading companies…" : "Select company"}
                    </option>
                    {companies.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              <label className="block min-w-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Branch{" "}
                <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                <Input
                  maxLength={120}
                  placeholder="e.g. Main Office, Cebu Branch"
                  value={branch}
                  disabled={readOnly || busy}
                  onChange={(e) => setBranch(e.target.value)}
                  className={fieldClass}
                />
              </label>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-950/40">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                  Prepared by Bookkeeper
                </p>
                {bookkeeper ? (
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {bookkeeper.name}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">
                      {bookkeeper.sectionName ? ` · ${bookkeeper.sectionName}` : ""}
                      {selectedCompanyName ? ` · ${selectedCompanyName}` : ""}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {requestBudgetFromCompanyTeamId
                      ? "No bookkeeper found for this company in the default Accounting section yet. It can be assigned on the ticket after approval."
                      : "Select a company to resolve the bookkeeper."}
                  </p>
                )}
              </div>

              <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-950/30 sm:p-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Payment details
                </p>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Payee
                  <div className="mt-1.5 flex h-10 items-center truncate rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100">
                    {fields.payee || requestedByName || "—"}
                  </div>
                </label>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  In payment of:
                  <Textarea
                    required
                    rows={3}
                    placeholder="Purpose or description of what this payment is for"
                    value={fields.inPaymentOf}
                    disabled={readOnly || busy}
                    onChange={(e) =>
                      setFields((p) => ({ ...p, inPaymentOf: e.target.value }))
                    }
                    className={cn(fieldClass, "placeholder:text-zinc-500")}
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Account title{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">
                      (optional)
                    </span>
                    <Input
                      maxLength={200}
                      placeholder="Account / expense title"
                      value={fields.accountTitle}
                      disabled={readOnly || busy}
                      onChange={(e) =>
                        setFields((p) => ({ ...p, accountTitle: e.target.value }))
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Amount
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Input
                        required
                        maxLength={80}
                        placeholder="e.g. ₱1,500.00"
                        value={fields.amount}
                        disabled={readOnly || busy}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, amount: e.target.value }))
                        }
                        className={cn(fieldClass, "mt-0 min-w-0 flex-1")}
                      />
                      <AmountCalculatorButton
                        disabled={readOnly || busy}
                        value={fields.amount}
                        onApply={(amount) =>
                          setFields((p) => ({ ...p, amount }))
                        }
                      />
                    </div>
                  </label>
                </div>

                <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={letAccountingHandlePaymentMode}
                    disabled={readOnly || busy}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setLetAccountingHandlePaymentMode(checked);
                      if (checked) {
                        setFields((p) => ({
                          ...p,
                          modeOfPayment: "",
                          deliveryOfCheck: "",
                          bankNameAccountNumber: "",
                        }));
                      } else {
                        setFields((p) => ({
                          ...p,
                          modeOfPayment: p.modeOfPayment || MODE_OF_PAYMENT_CHECK,
                          deliveryOfCheck: p.deliveryOfCheck || "Encashment",
                        }));
                      }
                    }}
                    className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span>
                    <span className="font-medium">Let Bookkeeper and Accounting handle it</span>
                    <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      Hides Mode of payment. The bookkeeper sets mode of payment on the ticket
                      after the travel order is approved.
                    </span>
                  </span>
                </label>

                {!letAccountingHandlePaymentMode ? (
                  <>
                    <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Mode of payment:
                      <Select
                        required
                        value={fields.modeOfPayment}
                        disabled={readOnly || busy}
                        onChange={(e) => {
                          const next = e.target.value;
                          setFields((p) => ({
                            ...p,
                            modeOfPayment: next,
                            deliveryOfCheck:
                              next === MODE_OF_PAYMENT_CHECK
                                ? p.deliveryOfCheck || "Encashment"
                                : "",
                          }));
                        }}
                        className={fieldClass}
                      >
                        <option value="">Select mode of payment</option>
                        {MODE_OF_PAYMENT_OPTIONS.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </Select>
                    </label>

                    {fields.modeOfPayment === MODE_OF_PAYMENT_CHECK ? (
                      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Delivery of check
                        <Select
                          required
                          value={fields.deliveryOfCheck || ""}
                          disabled={readOnly || busy}
                          onChange={(e) =>
                            setFields((p) => ({
                              ...p,
                              deliveryOfCheck: e.target.value,
                            }))
                          }
                          className={fieldClass}
                        >
                          <option value="">Select delivery of check</option>
                          {DELIVERY_OF_CHECK_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </Select>
                      </label>
                    ) : null}

                    {paymentModeShowsBankDetails(
                      fields.modeOfPayment,
                      fields.deliveryOfCheck,
                    ) ? (
                      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Bank name / account number
                        {!paymentModeRequiresBankDetails(
                          fields.modeOfPayment,
                          fields.deliveryOfCheck,
                        ) ? (
                          <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                            (optional)
                          </span>
                        ) : null}
                        <Input
                          required={paymentModeRequiresBankDetails(
                            fields.modeOfPayment,
                            fields.deliveryOfCheck,
                          )}
                          maxLength={200}
                          placeholder="e.g. BDO · 0012-3456-7890"
                          value={fields.bankNameAccountNumber || ""}
                          disabled={readOnly || busy}
                          onChange={(e) =>
                            setFields((p) => ({
                              ...p,
                              bankNameAccountNumber: e.target.value,
                            }))
                          }
                          className={fieldClass}
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-400">
                    Mode of payment, delivery of check, and bank details will appear on the
                    ticket details for Accounting to complete.
                  </p>
                )}

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Additional notes{" "}
                  <span className="font-normal text-zinc-500 dark:text-zinc-400">
                    (optional)
                  </span>
                  <Textarea
                    rows={3}
                    placeholder="Any other context for this payment request"
                    value={fields.notes || ""}
                    disabled={readOnly || busy}
                    onChange={(e) => setFields((p) => ({ ...p, notes: e.target.value }))}
                    className={cn(fieldClass, "placeholder:text-zinc-500")}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
          {!readOnly ? (
            <button
              type="button"
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              onClick={() => void save()}
              disabled={busy || loading}
            >
              {busy ? "Saving…" : "Save RFP"}
            </button>
          ) : ticketId ? (
            <a
              href={`/agent/tickets/${ticketId}`}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Open ticket
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
