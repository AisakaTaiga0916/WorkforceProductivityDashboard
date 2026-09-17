"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import {
  canApproveTravelOrderNow,
  canCancelTravelOrderNow,
  canConfirmTravelOrderNow,
  getOperatorActionableApprovalLevel,
  hasHierarchicalApprovals,
  isApprovalHierarchySatisfied,
  isTravelOrderConfirmReady,
  TRAVEL_ORDER_STATUS,
  type TravelOrderDto,
} from "@/lib/travel-order";
import { travelOrderApprovalGridClass } from "@/components/task-board/TravelOrderPageNav";
import { cn } from "@/lib/cn";
import {
  formatWorkPlanAmount,
  isWorkPlanOrder,
  workPlanVenueLabels,
  type WorkPlanMeta,
} from "@/lib/work-plan";

type WorkPlanOrderCardProps = {
  order: TravelOrderDto;
  operatorAgentId?: string | null;
  canAssignWork?: boolean;
  gatePassOnly?: boolean;
  /** `full` = document + approvals; page-nav can show one pane at a time. */
  view?: "full" | "details" | "approvals";
  busyKey: string | null;
  onApprove: (order: TravelOrderDto) => void;
  onConfirm: (order: TravelOrderDto) => void;
  onDecline: (order: TravelOrderDto, reason: string, asConfirmer?: boolean) => void;
  onCancel: (order: TravelOrderDto) => void;
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const text = (value ?? "").trim() || "—";
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{text}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-700 dark:bg-zinc-950/40">
      <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-700 dark:text-orange-300">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function WorkPlanOrderCard({
  order,
  operatorAgentId = null,
  canAssignWork = false,
  gatePassOnly = false,
  view = "full",
  busyKey,
  onApprove,
  onConfirm,
  onDecline,
  onCancel,
}: WorkPlanOrderCardProps) {
  const [declining, setDeclining] = useState(false);
  const [decliningAsConfirmer, setDecliningAsConfirmer] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  if (!isWorkPlanOrder(order) || !order.workPlanMeta) return null;
  const meta: WorkPlanMeta = order.workPlanMeta;
  const showDetails = view !== "approvals";
  const showApprovals = view !== "details";
  const levels = order.approvalLevels ?? [];
  const hierarchical = hasHierarchicalApprovals(levels);
  const actionable = hierarchical
    ? getOperatorActionableApprovalLevel(levels, operatorAgentId, { canAssignWork })
    : null;
  const approvedCount = levels.filter((l) => Boolean(l.approvedAt)).length;
  const personnelCount = meta.personnel.filter((p) => p.name.trim()).length;
  const canApprove =
    !gatePassOnly &&
    canApproveTravelOrderNow(operatorAgentId, { ...order, approvalLevels: levels }, { canAssignWork });
  const canConfirm =
    !gatePassOnly && canConfirmTravelOrderNow(operatorAgentId, order, { canAssignWork });
  const confirmReady = isTravelOrderConfirmReady(order);
  const canCancel = !gatePassOnly && canCancelTravelOrderNow(operatorAgentId, order);
  const rejected = order.status === TRAVEL_ORDER_STATUS.REJECTED;
  const cancelled = order.status === TRAVEL_ORDER_STATUS.CANCELLED;
  const confirmed = order.status === TRAVEL_ORDER_STATUS.CONFIRMED;
  const approved =
    order.status === TRAVEL_ORDER_STATUS.APPROVED || confirmed;
  const busy =
    busyKey === `approve-${order.id}` ||
    busyKey === `reject-${order.id}` ||
    busyKey === `cancel-${order.id}` ||
    busyKey === `confirm-${order.id}`;

  return (
    <article className="space-y-3 rounded-xl border border-orange-400/40 bg-white/90 p-3 dark:border-orange-500/30 dark:bg-zinc-950/60">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-200">
            Travel Order for Management Approval
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {order.orderRequest || "Travel Order"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Status: {order.status}
            {order.kpiTitle ? ` · ${order.kpiTitle}` : ""}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>{meta.implementationPeriod?.trim() || "Period —"}</span>
            <span>{personnelCount} personnel</span>
            <span>Budget ₱{meta.totalEstimatedBudget || "0.00"}</span>
            <span>
              Approvals {approvedCount} of {Math.max(levels.length, 1)}
            </span>
            {meta.includesTravel ? <span>Includes travel</span> : null}
          </p>
        </div>
      </div>

      {rejected && order.rejectionReason ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-200">
          Declined: {order.rejectionReason}
        </p>
      ) : null}

      {showDetails ? (
        <>
      <Section title="I. General Information">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Department / Business Unit" value={meta.departmentBusinessUnit} />
          <Field label="Requesting Party" value={meta.requestingParty} />
          <Field
            label="Person-in-Charge"
            value={meta.personInChargeName || meta.personInChargeAgentId}
          />
          <Field label="Date Prepared" value={meta.datePrepared} />
          <Field label="Budget Required By" value={meta.budgetRequiredBy} />
        </div>
      </Section>

      <Section title="II. Travel Order Details">
        <Field label="Activity / Proposed Travel Order" value={meta.activityProposedWorkPlan} />
        <Field label="Purpose / Objective" value={meta.purposeObjective} />
        <Field label="Date / Period of Implementation" value={meta.implementationPeriod} />
        {(order.locations?.length ?? 0) === 0 ? (
          <Field
            label="Venues / Locations"
            value={workPlanVenueLabels(meta).join("\n") || meta.venueLocation}
          />
        ) : null}
        <Field label="Expected Outcome / Deliverable" value={meta.expectedOutcome} />
      </Section>

      <Section title="III. Personnel Involved">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 pr-2">No.</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Position / Department</th>
                <th className="py-1 pr-2">Responsibility / Role</th>
                {meta.driverPresent ? <th className="py-1">Driver</th> : null}
              </tr>
            </thead>
            <tbody>
              {meta.personnel.map((row, i) => (
                <tr key={`p-${i}`} className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="py-1.5 pr-2">{i + 1}</td>
                  <td className="py-1.5 pr-2">{row.name || "—"}</td>
                  <td className="py-1.5 pr-2">{row.positionDepartment || "—"}</td>
                  <td className="py-1.5 pr-2">{row.responsibilityRole || "—"}</td>
                  {meta.driverPresent ? (
                    <td className="py-1.5">{row.isDriver ? "Yes" : "—"}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">
          Total Personnel: {meta.totalPersonnel}
          {meta.driverPresent
            ? ` · Driver${meta.personnel.filter((p) => p.isDriver).length === 1 ? "" : "s"}: ${
                meta.personnel
                  .filter((p) => p.isDriver)
                  .map((p) => p.name.trim())
                  .filter(Boolean)
                  .join(", ") || "—"
              }`
            : ""}
        </p>
      </Section>

      <Section title="IV. Budget">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 pr-2">Particulars / Expense</th>
                <th className="py-1 pr-2">Basis / Quantity</th>
                <th className="py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {meta.budgetLines.map((line, i) => (
                <tr key={`b-${i}`} className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="py-1.5 pr-2">{line.particulars || "—"}</td>
                  <td className="py-1.5 pr-2">{line.basisQuantity || "—"}</td>
                  <td className="py-1.5">₱{line.amount || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm font-semibold">
          TOTAL ESTIMATED BUDGET: ₱
          {meta.totalEstimatedBudget || formatWorkPlanAmount(0) || "0.00"}
        </p>
      </Section>

      <Section title="V. Justification">
        <Field label="Justification" value={meta.justification} />
      </Section>

      <Section title="VI. Expected Results / Key Deliverables">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 pr-2">No.</th>
                <th className="py-1 pr-2">Expected Result / Deliverable</th>
                <th className="py-1">Target Date</th>
              </tr>
            </thead>
            <tbody>
              {meta.expectedResults.map((row, i) => (
                <tr key={`r-${i}`} className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="py-1.5 pr-2">{i + 1}</td>
                  <td className="py-1.5 pr-2">{row.deliverable || "—"}</td>
                  <td className="py-1.5">{row.targetDate || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {meta.includesTravel ? (
        <Section title="Travel (optional)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Locations"
              value={(meta.travel?.locations ?? [])
                .map((l) => l.label)
                .filter(Boolean)
                .join("; ") || order.locations?.map((l) => l.label).join("; ")}
            />
            <Field
              label="Vehicle"
              value={order.vehicle || meta.travel?.vehicle || "—"}
            />
            {meta.travel?.driverPresent || order.driverPresent ? (
              <Field
                label="Driver"
                value={
                  order.driverAgent?.name ||
                  meta.travel?.driverAgentId ||
                  "—"
                }
              />
            ) : null}
            {meta.travel?.estDepartureAt || order.estDepartureAt ? (
              <Field
                label="Est. departure"
                value={
                  meta.travel?.estDepartureAt ||
                  (order.estDepartureAt
                    ? new Date(order.estDepartureAt).toLocaleString()
                    : null)
                }
              />
            ) : null}
            {meta.travel?.estArrivalAt || order.estArrivalAt ? (
              <Field
                label="Est. arrival"
                value={
                  meta.travel?.estArrivalAt ||
                  (order.estArrivalAt
                    ? new Date(order.estArrivalAt).toLocaleString()
                    : null)
                }
              />
            ) : null}
          </div>
        </Section>
      ) : null}
        </>
      ) : null}

      {showApprovals ? (
        <>
      <Section title="VII. Management Approval">
        <div
          className={cn(
            travelOrderApprovalGridClass(Math.max(levels.length, 1)),
            "rounded-lg border border-zinc-200 bg-zinc-50/60 p-2.5 dark:border-zinc-700 dark:bg-zinc-900/30",
          )}
        >
          {levels.map((lvl, index) => {
            const done = Boolean(lvl.approvedAt);
            const isCurrent = actionable?.level === lvl.level;
            return (
              <div
                key={`lvl-${lvl.level}`}
                className="min-w-0 self-stretch rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950/50"
              >
                {index > 0 ? (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 sm:hidden">
                    then →
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {lvl.agent?.name || lvl.agentId || "Unassigned"}
                  </span>
                  <span
                    className={
                      done
                        ? "text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                        : isCurrent
                          ? "text-xs font-semibold text-orange-700 dark:text-orange-300"
                          : "text-xs text-zinc-500"
                    }
                  >
                    {done ? "Approved" : isCurrent ? "Awaiting action" : "Pending"}
                  </span>
                </div>
                {lvl.approvedAt ? (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {new Date(lvl.approvedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        {approved && isApprovalHierarchySatisfied(levels) && !order.confirmationByAgentId ? (
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            Fully approved along the org-chart path.
          </p>
        ) : null}
      </Section>

      <Section title="To be Confirmed by">
        <div className="rounded-lg border border-orange-400/30 bg-orange-500/[0.05] px-2.5 py-2 dark:border-orange-500/25">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {order.confirmationByAgent?.name || order.confirmationByAgentId || "Unassigned"}
          </p>
          {confirmed ? (
            <p className="mt-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              Confirmed
            </p>
          ) : rejected ? (
            <p className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">
              Declined — confirmation closed
            </p>
          ) : cancelled ? (
            <p className="mt-0.5 text-xs text-zinc-500">Cancelled — confirmation closed</p>
          ) : approved && order.confirmationByAgentId ? (
            <p className="mt-0.5 text-xs text-orange-700 dark:text-orange-300">
              {canConfirm
                ? confirmReady
                  ? "Awaiting your confirmation"
                  : "Waiting for every approver to sign"
                : "Waiting for confirmation"}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-500">After approvals</p>
          )}
        </div>
      </Section>

      {!gatePassOnly && !rejected && !cancelled && !confirmed ? (
        <div className="space-y-2">
          {declining ? (
            <div className="space-y-2 rounded-lg border border-rose-400/40 bg-rose-500/5 p-2.5">
              <Textarea
                rows={3}
                value={declineReason}
                placeholder={
                  decliningAsConfirmer
                    ? "Reason for declining confirmation…"
                    : "Reason for returning…"
                }
                onChange={(e) => setDeclineReason(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !declineReason.trim()}
                  onClick={() => onDecline(order, declineReason.trim(), decliningAsConfirmer)}
                >
                  Confirm return
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDeclining(false);
                    setDecliningAsConfirmer(false);
                    setDeclineReason("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canApprove ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => onApprove(order)}
                >
                  {busyKey === `approve-${order.id}` ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Approve
                </Button>
              ) : null}
              {canApprove ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDecliningAsConfirmer(false);
                    setDeclining(true);
                  }}
                >
                  Return
                </Button>
              ) : null}
              {canConfirm ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !confirmReady}
                  onClick={() => onConfirm(order)}
                >
                  {busyKey === `confirm-${order.id}` ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Confirm travel order
                </Button>
              ) : null}
              {canConfirm ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDecliningAsConfirmer(true);
                    setDeclining(true);
                  }}
                >
                  Do not confirm
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onCancel(order)}
                >
                  Cancel travel order
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
        </>
      ) : null}
    </article>
  );
}
