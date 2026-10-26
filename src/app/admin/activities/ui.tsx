"use client";

import { OnDutyPanel } from "@/components/dashboard/OnDutyPanel";
import { BRAND_TITLE } from "@/lib/brand";
import { cn } from "@/lib/cn";
import type { OnDutyAgentSnapshot } from "@/lib/load-on-duty-snapshot";
import type { PersonnelKpiOverview, PersonnelKpiRange } from "@/modules/workforce/personnel-kpi";
import {
  ActivityKpiControls,
  ActivityKpiModal,
  useActivityKpi,
} from "../workforce/activity-kpi";

type Props = {
  initialOnDutyAgents: OnDutyAgentSnapshot[];
  initialOnDutyPage: number;
  onDutyTotalPages: number;
  onDutyTotal: number;
  onDutyActiveCount: number;
  initialOnDutyCompanies: string[];
  onDutyPageSize: number;
  lockedCompanyFilter?: string | null;
  scopeLabel?: string | null;
  /** Renders just the on-duty cards, without the page shell, for embedding. */
  embedded?: boolean;
  /** Shared search bar query from the parent Workforce page. When set, this
   *  replaces the on-duty panel's own search input (hidden). */
  externalSearchQuery?: string;
  /** Company filter chip from the parent Workforce search bar. When set, this
   *  replaces the on-duty panel's own company dropdown (hidden). */
  externalCompanyFilter?: string;
  /** Role filter chip from the parent Workforce search bar (normalized role). */
  externalRoleFilter?: string;
  initialKpiOverview: PersonnelKpiOverview | null;
  initialKpiError?: string | null;
  initialKpiRange: PersonnelKpiRange;
};

export function ActivitiesClient({
  initialOnDutyAgents,
  initialOnDutyPage,
  onDutyTotalPages,
  onDutyTotal,
  onDutyActiveCount,
  initialOnDutyCompanies,
  onDutyPageSize,
  lockedCompanyFilter = null,
  scopeLabel = null,
  embedded = false,
  externalSearchQuery,
  externalCompanyFilter,
  externalRoleFilter,
  initialKpiOverview,
  initialKpiError,
  initialKpiRange,
}: Props) {
  const kpi = useActivityKpi({ initialOverview: initialKpiOverview, initialError: initialKpiError, initialRange: initialKpiRange });
  // Embedded render uses a div so the Workforce page shell stays the only <main>.
  const ShellTag: "main" | "div" = embedded ? "div" : "main";
  return (
    <ShellTag
      className={cn(
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100",
        embedded
          ? "min-h-0 px-0 py-0"
          : "min-h-[calc(100vh-56px)] px-3 py-4 sm:px-4 md:py-5",
      )}
    >
      <div
        className={cn(
          "space-y-4",
          embedded ? "" : "mx-auto max-w-[min(100%,1920px)]",
        )}
      >
        {embedded ? null : (
          <header className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400/95">
              {BRAND_TITLE} · Admin console
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white md:text-3xl">
              Activities
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              Merge-database personnel with live On Duty / Offline status from today&apos;s HRIS
              clock-ins. Updates every 10 seconds.
              {scopeLabel ? (
                <>
                  {" "}
                  Showing <span className="font-medium text-zinc-800 dark:text-zinc-200">{scopeLabel}</span>.
                </>
              ) : null}
            </p>
          </header>
        )}

        <OnDutyPanel
          variant="cards"
          showCompanyFilter={!lockedCompanyFilter}
          lockedCompanyFilter={lockedCompanyFilter}
          pageSize={onDutyPageSize}
          initialAgents={initialOnDutyAgents}
          initialPage={initialOnDutyPage}
          totalPages={onDutyTotalPages}
          initialTotal={onDutyTotal}
          initialOnDutyCount={onDutyActiveCount}
          initialCompanies={initialOnDutyCompanies}
          externalSearchQuery={externalSearchQuery}
          externalCompanyFilter={externalCompanyFilter}
          externalRoleFilter={externalRoleFilter}
          kpiByAgentId={kpi.lookup.byAgentId}
          kpiByEmail={kpi.lookup.byEmail}
          kpiPeriodLabel={kpi.range.label}
          onOpenKpi={kpi.openPerson}
          kpiControls={<ActivityKpiControls state={kpi} />}
        />
      </div>
      <ActivityKpiModal state={kpi} />
    </ShellTag>
  );
}
