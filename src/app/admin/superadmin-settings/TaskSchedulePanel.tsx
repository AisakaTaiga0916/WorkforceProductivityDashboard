"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  DEFAULT_WORKING_DAYS,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT_LABELS,
  formatWorkingDaysLabel,
  normalizeWorkingDays,
  parseTaskScheduleSettings,
  type TaskScheduleSettings,
} from "@/modules/platform/settings/task-schedule-settings";

type CompanyOption = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
};

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((day, idx) => day === sortedB[idx]);
}

export function TaskSchedulePanel() {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [settings, setSettings] = useState<TaskScheduleSettings>({ companies: {} });
  const [companyId, setCompanyId] = useState("");
  /** Unsaved per-company edits; absent entry = mirror the saved mask. */
  const [draftByCompany, setDraftByCompany] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const [companiesRes, settingsRes] = await Promise.all([
          fetch("/api/admin/iam/companies", { cache: "no-store" }),
          fetch("/api/admin/task-schedule-settings", { cache: "no-store" }),
        ]);
        const companiesData = (await companiesRes.json().catch(() => ({}))) as {
          companies?: CompanyOption[];
          error?: string;
        };
        const settingsData = (await settingsRes.json().catch(() => ({}))) as {
          error?: string;
        } & Record<string, unknown>;
        if (stopped) return;
        if (!companiesRes.ok || !companiesData.companies) {
          setError(companiesData.error ?? "Could not load companies.");
          return;
        }
        if (!settingsRes.ok) {
          setError(settingsData.error ?? "Could not load task schedule settings.");
          return;
        }
        const parsed = parseTaskScheduleSettings(settingsData);
        setCompanies(companiesData.companies);
        setSettings(parsed);
        const first = companiesData.companies.find((c) => c.isActive) ?? companiesData.companies[0];
        if (first) {
          setCompanyId((prev) => prev || first.id);
        }
      } catch {
        if (!stopped) setError("Could not load task schedule settings.");
      } finally {
        if (!stopped) setLoading(false);
      }
    }
    void load();
    return () => {
      stopped = true;
    };
  }, []);

  const savedDays = useMemo(() => {
    if (!companyId) return [...DEFAULT_WORKING_DAYS];
    const entry = settings.companies[companyId];
    return entry ? [...entry.workingDays] : [...DEFAULT_WORKING_DAYS];
  }, [settings, companyId]);

  const days = draftByCompany[companyId] ?? savedDays;

  const dirty = !sameDays(days, savedDays);
  const isCustomized = Boolean(companyId && settings.companies[companyId]);

  function selectCompany(nextId: string) {
    setCompanyId(nextId);
    setMessage(null);
    setError(null);
  }

  function toggleDay(day: number) {
    setMessage(null);
    setDraftByCompany((prev) => {
      const current = prev[companyId] ?? savedDays;
      const toggled = current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day];
      const next = normalizeWorkingDays(toggled);
      if (!next) return prev;
      return { ...prev, [companyId]: next };
    });
  }

  async function save() {
    if (!companyId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/task-schedule-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, workingDays: days }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      } & Record<string, unknown>;
      if (!res.ok) {
        setError(data.error ?? "Could not save the schedule.");
        return;
      }
      const parsed = parseTaskScheduleSettings(data);
      setSettings(parsed);
      setDraftByCompany((prev) => {
        if (!(companyId in prev)) return prev;
        const copy = { ...prev };
        delete copy[companyId];
        return copy;
      });
      const company = companies.find((c) => c.id === companyId);
      setMessage(
        `${company?.name ?? "Company"} works ${formatWorkingDaysLabel(days)}. Daily task periods and KPI working days use this schedule.`,
      );
      window.dispatchEvent(new Event("task-schedule-settings-changed"));
    } catch {
      setError("Could not save the schedule.");
    } finally {
      setBusy(false);
    }
  }

  function resetDefaults() {
    setDraftByCompany((prev) => ({ ...prev, [companyId]: [...DEFAULT_WORKING_DAYS] }));
    setMessage(null);
    setError(null);
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
            SuperAdmin
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Task schedule
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Working days per company. Daily task periods, KPI snapshots, and reporting
            working-day windows skip non-working days. Companies without a saved schedule
            follow the default: {formatWorkingDaysLabel(DEFAULT_WORKING_DAYS)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || loading || !dirty}
            onClick={resetDefaults}
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Default ({formatWorkingDaysLabel(DEFAULT_WORKING_DAYS)})
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || loading || !dirty || days.length === 0}
            onClick={() => void save()}
            className="gap-1.5"
          >
            <Save className="size-3.5" aria-hidden />
            Save
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-200">
          {message}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-zinc-500">Loading…</p>
      ) : companies.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">No companies found.</p>
      ) : (
        <div className="mt-5 space-y-4">
          <label className="block max-w-md">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              Company
            </span>
            <select
              value={companyId}
              onChange={(e) => selectCompany(e.target.value)}
              disabled={busy}
              className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                  {company.code ? ` (${company.code})` : ""}
                  {settings.companies[company.id] ? " — custom" : ""}
                  {company.isActive ? "" : " — archived"}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                Working days
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                  isCustomized
                    ? "bg-orange-600/15 text-orange-800 dark:text-orange-200"
                    : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
                )}
              >
                {isCustomized ? "Custom" : "Default"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAY_ORDER.map((day) => {
                const active = days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={busy}
                    aria-pressed={active}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full border text-xs font-bold transition",
                      active
                        ? "border-orange-500 bg-orange-500 text-white shadow-sm"
                        : "border-zinc-300 bg-white text-zinc-500 hover:border-orange-400 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
                    )}
                  >
                    {WEEKDAY_SHORT_LABELS[day]}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <CalendarDays className="size-3.5" aria-hidden />
              {days.length === 0
                ? "Pick at least one working day."
                : `${formatWorkingDaysLabel(days)} counts as working days for this company.`}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
