"use client";

import { useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AmountCalculatorButton } from "@/components/task-board/AmountCalculatorModal";
import { CompanyUserSearchField } from "@/components/tickets/CompanyUserSearchField";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import {
  WORK_PLAN_BUDGET_TEMPLATES,
  emptyBudgetLine,
  emptyExpectedResult,
  emptyPersonnelRow,
  emptyVenue,
  formatWorkPlanAmount,
  joinWorkPlanVenues,
  sumWorkPlanBudgetLines,
  type WorkPlanMeta,
  type WorkPlanSectionId,
} from "@/lib/work-plan";

type AgentOpt = {
  id: string;
  name: string;
  email?: string | null;
  /** Org-chart designated department (e.g. IT TEAM). */
  subtitle?: string | null;
};

function designatedDepartment(agent: AgentOpt | null | undefined): string {
  return (agent?.subtitle ?? "").trim();
}

type WorkPlanFormFieldsProps = {
  meta: WorkPlanMeta;
  onChange: (next: WorkPlanMeta) => void;
  /** Company roster for personnel / PIC pickers. */
  agents?: AgentOpt[];
  disabled?: boolean;
  /** Wizard step: only this I–VI section is shown. */
  sectionId: Extract<
    WorkPlanSectionId,
    "general" | "details" | "people" | "budget" | "justification" | "results"
  >;
};

export function WorkPlanFormFields({
  meta,
  onChange,
  agents = [],
  disabled = false,
  sectionId,
}: WorkPlanFormFieldsProps) {
  function patch(partial: Partial<WorkPlanMeta>) {
    onChange({ ...meta, ...partial });
  }

  useEffect(() => {
    if (sectionId !== "people" || agents.length === 0) return;
    let changed = false;
    const personnel = meta.personnel.map((row) => {
      if (row.positionDepartment.trim() || !row.name.trim()) return row;
      const agent = agents.find(
        (a) => a.name.trim().toLowerCase() === row.name.trim().toLowerCase(),
      );
      const dept = designatedDepartment(agent);
      if (!dept) return row;
      changed = true;
      return { ...row, positionDepartment: dept };
    });
    if (changed) onChange({ ...meta, personnel });
  }, [agents, sectionId, meta, onChange]);

  const budgetTotal = sumWorkPlanBudgetLines(meta.budgetLines);
  const namedPersonnel = meta.personnel.filter((p) => p.name.trim()).length;

  if (sectionId === "general") {
    return (
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Department / Business Unit
          </span>
          <Input
            value={meta.departmentBusinessUnit}
            disabled={disabled}
            onChange={(e) => patch({ departmentBusinessUnit: e.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Requesting Party
          </span>
          <Input
            value={meta.requestingParty}
            disabled={disabled}
            onChange={(e) => patch({ requestingParty: e.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Person-in-Charge
          </span>
          <Input
            value={meta.personInChargeName ?? ""}
            disabled={disabled}
            placeholder="Full name"
            onChange={(e) =>
              patch({
                personInChargeName: e.target.value,
                personInChargeAgentId: null,
              })
            }
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Date Prepared
            </span>
            <DatePickerField
              value={meta.datePrepared}
              disabled={disabled}
              onChange={(e) => patch({ datePrepared: e.target.value })}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Budget Required By
            </span>
            <Input
              value={meta.budgetRequiredBy}
              disabled={disabled}
              onChange={(e) => patch({ budgetRequiredBy: e.target.value })}
              placeholder="Date or deadline"
            />
          </label>
        </div>
      </div>
    );
  }

  if (sectionId === "details") {
    return (
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Activity / Proposed Travel Order
          </span>
          <Textarea
            rows={3}
            value={meta.activityProposedWorkPlan}
            disabled={disabled}
            onChange={(e) => patch({ activityProposedWorkPlan: e.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Purpose / Objective
          </span>
          <Textarea
            rows={3}
            value={meta.purposeObjective}
            disabled={disabled}
            onChange={(e) => patch({ purposeObjective: e.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Date / Period of Implementation
          </span>
          <Input
            value={meta.implementationPeriod}
            disabled={disabled}
            onChange={(e) => patch({ implementationPeriod: e.target.value })}
          />
        </label>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Location
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || (meta.venues?.length ?? 0) >= 10}
              onClick={() => {
                const venues = [...(meta.venues?.length ? meta.venues : [emptyVenue()]), emptyVenue()];
                patch({ venues, venueLocation: joinWorkPlanVenues(venues) });
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </div>
          {(meta.venues?.length ? meta.venues : [emptyVenue()]).map((venue, index) => (
            <div key={`venue-${index}`} className="flex items-center gap-2">
              <Input
                placeholder={`Location ${index + 1}`}
                value={venue.label}
                disabled={disabled}
                onChange={(e) => {
                  const source = meta.venues?.length ? meta.venues : [emptyVenue()];
                  const venues = source.map((row, i) =>
                    i === index ? emptyVenue({ ...row, label: e.target.value }) : row,
                  );
                  patch({ venues, venueLocation: joinWorkPlanVenues(venues) });
                }}
              />
              {(meta.venues?.length ?? 0) > 1 ? (
                <button
                  type="button"
                  disabled={disabled}
                  className="text-zinc-400 hover:text-red-600"
                  onClick={() => {
                    const venues = (meta.venues ?? []).filter((_, i) => i !== index);
                    patch({
                      venues: venues.length > 0 ? venues : [emptyVenue()],
                      venueLocation: joinWorkPlanVenues(venues),
                    });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Expected Outcome / Deliverable{" "}
            <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <Textarea
            rows={2}
            value={meta.expectedOutcome}
            disabled={disabled}
            placeholder="Optional — describe the expected outcome or deliverable"
            onChange={(e) => patch({ expectedOutcome: e.target.value })}
          />
        </label>
      </div>
    );
  }

  if (sectionId === "people") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={meta.driverPresent}
              disabled={disabled}
              onChange={(e) => {
                const checked = e.target.checked;
                patch({
                  driverPresent: checked,
                  personnel: checked
                    ? meta.personnel
                    : meta.personnel.map((p) => ({ ...p, isDriver: false })),
                });
              }}
            />
            Driver Present
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || meta.personnel.length >= 20}
            onClick={() => patch({ personnel: [...meta.personnel, emptyPersonnelRow()] })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add person
          </Button>
        </div>
        <div className="space-y-3">
          {meta.personnel.map((row, index) => {
            const matchedAgent =
              agents.find(
                (a) =>
                  a.name.trim().toLowerCase() === row.name.trim().toLowerCase() &&
                  row.name.trim(),
              ) ?? null;
            return (
              <div
                key={`personnel-${index}`}
                className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-500">No. {index + 1}</span>
                  <div className="flex items-center gap-2">
                    {meta.driverPresent ? (
                      <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={row.isDriver === true}
                          disabled={disabled}
                          onChange={(e) => {
                            const personnel = meta.personnel.map((p, i) =>
                              i === index ? { ...p, isDriver: e.target.checked } : p,
                            );
                            patch({ personnel });
                          }}
                        />
                        Driver
                      </label>
                    ) : null}
                    {meta.personnel.length > 1 ? (
                      <button
                        type="button"
                        disabled={disabled}
                        className="text-zinc-400 hover:text-red-600"
                        onClick={() =>
                          patch({ personnel: meta.personnel.filter((_, i) => i !== index) })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-2">
                  {agents.length > 0 ? (
                    <CompanyUserSearchField
                      label="Pick from roster"
                      users={agents}
                      value={matchedAgent?.id ?? ""}
                      disabled={disabled}
                      placeholder="Search company users…"
                      onChange={(agentId) => {
                        const agent = agents.find((a) => a.id === agentId);
                        const dept = designatedDepartment(agent);
                        const personnel = meta.personnel.map((p, i) =>
                          i === index
                            ? {
                                ...p,
                                name: agent?.name?.trim() || p.name,
                                positionDepartment: agent ? dept : p.positionDepartment,
                              }
                            : p,
                        );
                        patch({
                          personnel,
                          totalPersonnel: personnel.filter((p) => p.name.trim()).length,
                        });
                      }}
                    />
                  ) : null}
                  <Input
                    placeholder="Name"
                    value={row.name}
                    disabled={disabled}
                    onChange={(e) => {
                      const personnel = meta.personnel.map((p, i) =>
                        i === index ? { ...p, name: e.target.value } : p,
                      );
                      patch({
                        personnel,
                        totalPersonnel: personnel.filter((p) => p.name.trim()).length,
                      });
                    }}
                  />
                  <Input
                    placeholder="Position / Department"
                    value={row.positionDepartment}
                    disabled={disabled}
                    onChange={(e) => {
                      const personnel = meta.personnel.map((p, i) =>
                        i === index ? { ...p, positionDepartment: e.target.value } : p,
                      );
                      patch({ personnel });
                    }}
                  />
                  <Input
                    placeholder="Responsibility / Role"
                    value={row.responsibilityRole}
                    disabled={disabled}
                    onChange={(e) => {
                      const personnel = meta.personnel.map((p, i) =>
                        i === index ? { ...p, responsibilityRole: e.target.value } : p,
                      );
                      patch({ personnel });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-zinc-500">Total Personnel: {namedPersonnel}</p>
      </div>
    );
  }

  if (sectionId === "budget") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {WORK_PLAN_BUDGET_TEMPLATES.map((template) => (
            <button
              key={template}
              type="button"
              disabled={disabled || meta.budgetLines.length >= 30}
              className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:border-orange-300 hover:bg-orange-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-orange-700 dark:hover:bg-orange-950/40"
              onClick={() => {
                if (meta.budgetLines.length >= 30) return;
                patch({
                  budgetLines: [...meta.budgetLines, emptyBudgetLine({ particulars: template })],
                });
              }}
            >
              {template}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || meta.budgetLines.length >= 30}
            onClick={() => patch({ budgetLines: [...meta.budgetLines, emptyBudgetLine()] })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add line
          </Button>
        </div>
        {meta.budgetLines.map((line, index) => (
          <div
            key={`budget-${index}`}
            className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-500">Line {index + 1}</span>
              {meta.budgetLines.length > 1 ? (
                <button
                  type="button"
                  disabled={disabled}
                  className="text-zinc-400 hover:text-red-600"
                  onClick={() =>
                    patch({ budgetLines: meta.budgetLines.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                placeholder="Particulars / Expense"
                value={line.particulars}
                disabled={disabled}
                onChange={(e) => {
                  const budgetLines = meta.budgetLines.map((l, i) =>
                    i === index ? { ...l, particulars: e.target.value } : l,
                  );
                  patch({ budgetLines });
                }}
              />
              <Input
                placeholder="Basis / Quantity"
                value={line.basisQuantity}
                disabled={disabled}
                onChange={(e) => {
                  const budgetLines = meta.budgetLines.map((l, i) =>
                    i === index ? { ...l, basisQuantity: e.target.value } : l,
                  );
                  patch({ budgetLines });
                }}
              />
              <div className="flex items-center gap-1.5">
                <Input
                  placeholder="Amount (₱)"
                  value={line.amount}
                  disabled={disabled}
                  className="min-w-0 flex-1"
                  onChange={(e) => {
                    const budgetLines = meta.budgetLines.map((l, i) =>
                      i === index ? { ...l, amount: e.target.value } : l,
                    );
                    patch({
                      budgetLines,
                      totalEstimatedBudget: formatWorkPlanAmount(
                        sumWorkPlanBudgetLines(budgetLines),
                      ),
                    });
                  }}
                />
                <AmountCalculatorButton
                  disabled={disabled}
                  value={line.amount}
                  onApply={(amount) => {
                    const budgetLines = meta.budgetLines.map((l, i) =>
                      i === index ? { ...l, amount } : l,
                    );
                    patch({
                      budgetLines,
                      totalEstimatedBudget: formatWorkPlanAmount(
                        sumWorkPlanBudgetLines(budgetLines),
                      ),
                    });
                  }}
                />
              </div>
            </div>
          </div>
        ))}
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          TOTAL ESTIMATED BUDGET: ₱{formatWorkPlanAmount(budgetTotal) || "0.00"}
        </p>
      </div>
    );
  }

  if (sectionId === "justification") {
    return (
      <Textarea
        rows={6}
        value={meta.justification}
        disabled={disabled}
        placeholder="State the business purpose, necessity, and expected benefit of the proposed activity."
        onChange={(e) => patch({ justification: e.target.value })}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Expected results / key deliverables are optional. Add rows if needed.
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || meta.expectedResults.length >= 20}
          onClick={() =>
            patch({ expectedResults: [...meta.expectedResults, emptyExpectedResult()] })
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {meta.expectedResults.map((row, index) => (
        <div
          key={`result-${index}`}
          className="grid gap-2 rounded-xl border border-zinc-200 p-3 sm:grid-cols-[1fr_auto_auto] dark:border-zinc-700"
        >
          <Input
            placeholder="Expected Result / Deliverable (optional)"
            value={row.deliverable}
            disabled={disabled}
            onChange={(e) => {
              const expectedResults = meta.expectedResults.map((r, i) =>
                i === index ? { ...r, deliverable: e.target.value } : r,
              );
              patch({ expectedResults });
            }}
          />
          <Input
            placeholder="Target Date (optional)"
            value={row.targetDate}
            disabled={disabled}
            onChange={(e) => {
              const expectedResults = meta.expectedResults.map((r, i) =>
                i === index ? { ...r, targetDate: e.target.value } : r,
              );
              patch({ expectedResults });
            }}
          />
          {meta.expectedResults.length > 1 ? (
            <button
              type="button"
              disabled={disabled}
              className="text-zinc-400 hover:text-red-600"
              onClick={() =>
                patch({
                  expectedResults: meta.expectedResults.filter((_, i) => i !== index),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
