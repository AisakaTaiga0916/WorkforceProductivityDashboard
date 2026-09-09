"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, FolderKanban, List, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { BRAND_TITLE } from "@/lib/brand";
import { ActivitiesClient } from "../activities/ui";
import { PersonnelClient } from "../personnel/ui";
import { WorkforceSectioningClient } from "./sectioning-panel";
import type { OrgChartSectionRow } from "../superadmin-settings/OrgChartSectionsPanel";
import type {
  OrgChartEitherOrLinkRow,
  OrgChartNodeRow,
} from "../superadmin-settings/OrgChartWorkspace";
import type { OnDutyAgentSnapshot } from "@/lib/load-on-duty-snapshot";
import type { PersonnelRosterRow } from "@/lib/personnel-accounts-data";
import { portalRegistryRoleLabel } from "@/lib/portal-account-registry";
import { PORTAL_ROLES } from "@/lib/staff-role";
import { Button } from "@/components/ui/button";
import Filters, {
  type Filter,
  type FilterOption,
  FilterOperator,
  FiltersTrigger,
  type SavedFilter,
  loadSavedFilters,
  persistSavedFilters,
} from "@/components/ui/filters";
import type { WorkforceViewId } from "@/lib/workforce-view-visibility";

type WorkforceView = WorkforceViewId;

type WorkforceUrlState = {
  view: WorkforceView;
  search: string;
  role: string;
  company: string;
  onDutyCompany: string;
};

export type WorkforceVisibleViews = Record<WorkforceView, boolean>;

function firstAllowedView(allowed: WorkforceVisibleViews, preferred?: string | null): WorkforceView {
  if (preferred === "activity" && allowed.activity) return "activity";
  if (preferred === "sections" && allowed.sections) return "sections";
  if (preferred === "list" && allowed.list) return "list";
  if (allowed.list) return "list";
  if (allowed.activity) return "activity";
  if (allowed.sections) return "sections";
  return "list";
}

function parseWorkforceView(raw: string | null, allowed: WorkforceVisibleViews): WorkforceView {
  return firstAllowedView(allowed, raw);
}

function readWorkforceUrlState(allowed: WorkforceVisibleViews): WorkforceUrlState {
  const params = new URLSearchParams(window.location.search);
  return {
    view: parseWorkforceView(params.get("view"), allowed),
    search: params.get("q") ?? "",
    role: params.get("role") ?? "",
    company: params.get("company") ?? "",
    onDutyCompany: params.get("onDutyCompany") ?? "",
  };
}

type Props = {
  initialView: WorkforceView;
  /** Initial search + filter values from the server-rendered URL (?q=, ?role=,
   *  ?company=, ?onDutyCompany=) so SSR and the first paint match the URL. */
  initialSearchQuery?: string;
  initialRoleFilter?: string;
  initialCompanyFilter?: string;
  initialOnDutyCompanyFilter?: string;
  initialTeams: { id: string; name: string }[];
  initialPersonnel: PersonnelRosterRow[];
  initialAssignableCompanies?: { id: string; name: string }[];
  viewerMode: "superadmin" | "admin";
  scopeUnavailable: boolean;
  scopedCompanyName: string | null;
  secondaryDatabaseName: string;
  initialOnDutyAgents: OnDutyAgentSnapshot[];
  initialOnDutyPage: number;
  onDutyTotalPages: number;
  onDutyTotal: number;
  onDutyActiveCount: number;
  initialOnDutyCompanies: string[];
  onDutyPageSize: number;
  lockedCompanyFilter?: string | null;
  /** Session user email — scopes the saved-filters localStorage key per user. */
  userEmail?: string | null;
  /** Which Workforce toggles are enabled (SuperAdmin Settings → Workforce). */
  visibleViews: WorkforceVisibleViews;
  /** SuperAdmin: manage org-chart departments when Org. Chart is shown. */
  canManageSections?: boolean;
  /** SuperAdmin: set Personnel / Admin / HighAdmin from Org Chart member rows. */
  canSetPortalRoles?: boolean;
  initialOrgSections?: OrgChartSectionRow[];
  initialOrgNodes?: OrgChartNodeRow[];
  initialOrgEitherOrLinks?: OrgChartEitherOrLinkRow[];
  /** Portal technical roles keyed by mergedSourceUserId (Org Chart elevate UI). */
  initialPortalRoleByMergedId?: Record<string, string>;
  sectionCompanyOptions?: { id: string; name: string }[];
};

/**
 * Workforce = Personnel registry (ListView), live On Duty activity, and Org. Chart.
 * Toggle visibility comes from SuperAdmin Settings → Workforce.
 * List stays mounted so filter state survives toggling; Activity / Org. Chart mount lazily.
 */
export function WorkforceClient(props: Props) {
  const allowed = props.visibleViews;
  const showList = allowed.list;
  const showActivity = allowed.activity;
  const showSections = allowed.sections;
  const canManageSections = Boolean(props.canManageSections) && showSections;
  /** Search + filter chips persist in the URL (?q=, ?role=, ?company=,
   *  ?onDutyCompany=, ?view=) so refresh and back/forward restore them.
   *  The server passes the URL-derived values for a hydration-safe first
   *  paint; the URL is the source of truth after mount (replaceState sync +
   *  popstate restore below). */
  const [view, setView] = useState<WorkforceView>(() =>
    firstAllowedView(allowed, props.initialView),
  );
  /** Single shared search bar: filters the personnel registry (ListView) and
   *  the on-duty cards (Activity) with one query. Initial values come from the
   *  server-rendered URL (?q=, ?role=, ?company=, ?onDutyCompany=) so refresh
   *  and direct link opens restore them; the URL stays the source of truth
   *  after mount via replaceState sync + popstate restore below. */
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? "");
  /** Filter chips (Request Board style) shared by both views. */
  const [roleFilter, setRoleFilter] = useState(props.initialRoleFilter ?? "");
  const [companyFilter, setCompanyFilter] = useState(props.initialCompanyFilter ?? "");
  const [onDutyCompanyFilter, setOnDutyCompanyFilter] = useState(
    props.initialOnDutyCompanyFilter ?? "",
  );
  /** Mount the Activity cards lazily on first open so the on-duty poller
   *  only runs once the user actually visits that view. Stays mounted after. */
  const [activityOpened, setActivityOpened] = useState(
    showActivity && firstAllowedView(allowed, props.initialView) === "activity",
  );
  const [sectionsOpened, setSectionsOpened] = useState(
    showSections && firstAllowedView(allowed, props.initialView) === "sections",
  );

  const savedFilterStorageKey = `workforce-filters:${props.userEmail ?? "anon"}:v1`;
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() =>
    loadSavedFilters(savedFilterStorageKey),
  );

  function updateSavedFilters(next: SavedFilter[] | ((prev: SavedFilter[]) => SavedFilter[])) {
    setSavedFilters((prev) => {
      const updated = typeof next === "function" ? next(prev) : next;
      persistSavedFilters(savedFilterStorageKey, updated);
      return updated;
    });
  }

  const rosterCompanies = props.initialAssignableCompanies ?? [];
  const onDutyCompanies = props.initialOnDutyCompanies ?? [];

  const roleOptions: FilterOption[] = useMemo(
    () => PORTAL_ROLES.map((r) => ({ name: portalRegistryRoleLabel(r), icon: undefined })),
    [],
  );
  const companyOptions: FilterOption[] = useMemo(
    () =>
      [
        { name: "No company assigned", icon: undefined },
        ...rosterCompanies.map((c) => ({ name: c.name, icon: undefined })),
      ],
    [rosterCompanies],
  );
  const onDutyCompanyOptions: FilterOption[] = useMemo(
    () => onDutyCompanies.map((c) => ({ name: c, icon: undefined })),
    [onDutyCompanies],
  );

  const filterOptions: Partial<Record<string, FilterOption[]>> = {
    Role: roleOptions,
    Company: companyOptions,
    "On-duty company": onDutyCompanyOptions,
  };

  /** Role chips display the friendly label but state keeps the raw role value
   *  so matchesRegistryRoleFilter (which compares normalized raw roles)
   *  actually matches. The reverse map handles the label->raw direction when
   *  the chip value is edited via the combobox. */
  const roleLabelToValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const role of PORTAL_ROLES) {
      map.set(portalRegistryRoleLabel(role), role);
    }
    return map;
  }, []);

  const filters: Filter[] = useMemo(() => {
    const list: Filter[] = [];
    if (roleFilter) {
      list.push({
        id: "Role",
        type: "Role",
        operator: FilterOperator.IS,
        value: [portalRegistryRoleLabel(roleFilter as (typeof PORTAL_ROLES)[number]) ?? roleFilter],
      });
    }
    if (companyFilter) {
      list.push({
        id: "Company",
        type: "Company",
        operator: FilterOperator.IS,
        value: [companyFilter],
      });
    }
    if (onDutyCompanyFilter) {
      list.push({
        id: "On-duty company",
        type: "On-duty company",
        operator: FilterOperator.IS,
        value: [onDutyCompanyFilter],
      });
    }
    return list;
  }, [roleFilter, companyFilter, onDutyCompanyFilter]);

  function setFilters(next: Filter[] | ((prev: Filter[]) => Filter[])) {
    const updated = typeof next === "function" ? next(filters) : next;
    let nextRole = "";
    let nextCompany = "";
    let nextOnDuty = "";
    for (const f of updated) {
      const value = f.value[f.value.length - 1] ?? "";
      if (f.type === "Role") nextRole = roleLabelToValue.get(value) ?? value;
      else if (f.type === "Company") nextCompany = value;
      else if (f.type === "On-duty company") nextOnDuty = value;
    }
    setRoleFilter(nextRole);
    setCompanyFilter(nextCompany);
    setOnDutyCompanyFilter(nextOnDuty);
  }

  function addFilter(type: string, value: string) {
    setFilters((prev) => [
      ...prev.filter((f) => f.type !== type),
      { id: type, type, operator: FilterOperator.IS, value: [value] },
    ]);
  }

  function clearAllFilters() {
    setRoleFilter("");
    setCompanyFilter("");
    setOnDutyCompanyFilter("");
  }

  /** The shared Company chip carries the canonical company name to BOTH views.
   *  "No company assigned" maps to the roster's "Unassigned" label (the loader
   *  uses the same label for company-less agents), so the ListView and the
   *  on-duty Activity view filter identically. */
  const personnelCompanyFilter =
    companyFilter === "No company assigned" ? "Unassigned" : companyFilter;

  /** The on-duty loader resolves the company name via resolveRosterCompanyName,
   *  so passing the roster name (e.g. "MCHISI LPG") matches HRIS aliases too.
   *  "No company assigned" maps to the loader's "Unassigned" label so the two
   *  views agree on unassigned personnel (the sentinel itself matches nothing). */
  const onDutyCompany =
    onDutyCompanyFilter || (companyFilter === "No company assigned" ? "Unassigned" : companyFilter);

  function saveCurrentFilter(name: string) {
    const captured: Record<string, string> = {};
    if (searchQuery.trim()) captured.q = searchQuery.trim();
    if (roleFilter) captured.role = roleFilter;
    if (companyFilter) captured.company = companyFilter;
    if (onDutyCompanyFilter) captured.onDutyCompany = onDutyCompanyFilter;
    if (Object.keys(captured).length === 0) return;
    updateSavedFilters((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        params: captured,
        createdAt: Date.now(),
      },
    ]);
  }

  function deleteSavedFilter(id: string) {
    updateSavedFilters((prev) => prev.filter((f) => f.id !== id));
  }

  const canSaveCurrent = filters.length > 0 || searchQuery.trim().length > 0;

  /** Build the full URL query string from the current search + filter + view
   *  state. Shared by the replaceState sync effect and the pushState actions
   *  (view toggle / saved-filter apply) so both write the same canonical URL. */
  function urlForState(
    state: Pick<WorkforceUrlState, "search" | "role" | "company" | "onDutyCompany" | "view">,
  ) {
    const params = new URLSearchParams();
    if (state.search.trim()) params.set("q", state.search.trim());
    if (state.role) params.set("role", state.role);
    if (state.company) params.set("company", state.company);
    if (state.onDutyCompany) params.set("onDutyCompany", state.onDutyCompany);
    if (state.view === "activity") params.set("view", "activity");
    else if (state.view === "sections") params.set("view", "sections");
    const qs = params.toString();
    return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  }

  /** Set right after a deliberate history.pushState so the replaceState sync
   *  effect below skips its write and leaves the pushed entry intact. */
  const pushPendingRef = useRef(false);

  /** Applying a saved filter is a deliberate action: push a history entry so
   *  Back/Forward can restore the pre-apply state. */
  function applySavedFilter(filter: SavedFilter) {
    setSearchQuery(filter.params.q ?? "");
    setRoleFilter(filter.params.role ?? "");
    setCompanyFilter(filter.params.company ?? "");
    setOnDutyCompanyFilter(filter.params.onDutyCompany ?? "");
    const nextView = firstAllowedView(allowed, view);
    pushPendingRef.current = true;
    window.history.pushState(
      {},
      "",
      urlForState({
        search: filter.params.q ?? "",
        role: filter.params.role ?? "",
        company: filter.params.company ?? "",
        onDutyCompany: filter.params.onDutyCompany ?? "",
        view: nextView,
      }),
    );
  }

  /** Keep search + filters + ?view= in the URL via history.replaceState (no
   *  reload, no history spam on every keystroke) so refresh and browser
   *  back/forward restore them. Raw history API is used instead of
   *  router.replace so toggling never re-runs the page's server loaders. */
  useEffect(() => {
    if (pushPendingRef.current) {
      pushPendingRef.current = false;
      return;
    }
    window.history.replaceState(
      {},
      "",
      urlForState({ search: searchQuery, role: roleFilter, company: companyFilter, onDutyCompany: onDutyCompanyFilter, view }),
    );
  }, [searchQuery, roleFilter, companyFilter, onDutyCompanyFilter, view]);

  /** Restore search + filters + view when the user navigates back/forward.
   *  If the restored view is Activity, mount the cards so they render. */
  useEffect(() => {
    function syncFromUrl() {
      const next = readWorkforceUrlState(allowed);
      if (next.view === "activity") setActivityOpened(true);
      if (next.view === "sections") setSectionsOpened(true);
      setView(next.view);
      setSearchQuery(next.search);
      setRoleFilter(next.role);
      setCompanyFilter(next.company);
      setOnDutyCompanyFilter(next.onDutyCompany);
    }
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [allowed]);

  /** The ListView/Activity/Org. Chart toggle is a deliberate action: push a
   *  history entry (with the current filters preserved) so Back/Forward can
   *  navigate it. Re-clicking the active toggle is a no-op. */
  function selectView(next: WorkforceView) {
    if (next === view) return;
    if (next === "list" && !showList) return;
    if (next === "activity" && !showActivity) return;
    if (next === "sections" && !showSections) return;
    if (next === "activity") setActivityOpened(true);
    if (next === "sections") setSectionsOpened(true);
    setView(next);
    pushPendingRef.current = true;
    window.history.pushState(
      {},
      "",
      urlForState({
        search: searchQuery,
        role: roleFilter,
        company: companyFilter,
        onDutyCompany: onDutyCompanyFilter,
        view: next,
      }),
    );
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-zinc-50 px-3 py-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-4 md:py-5">
      <div className="mx-auto max-w-[min(100%,1920px)] space-y-4">
        <header className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400/95">
                {BRAND_TITLE} · Admin console
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white md:text-3xl">
                Workforce
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                {[
                  showList ? "Personnel registry" : null,
                  showActivity ? "live On Duty / Offline activity" : null,
                  showSections ? "org. chart" : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "Workforce"}{" "}
                from today&apos;s HRIS clock-ins. Toggle visibility is set in SuperAdmin Settings.
              </p>
            </div>
            <div className="inline-flex shrink-0 self-start rounded-lg border border-zinc-300 bg-zinc-100 p-0.5 text-xs font-semibold sm:self-auto dark:border-zinc-700 dark:bg-zinc-900">
              {showList ? (
                <button
                  type="button"
                  onClick={() => selectView("list")}
                  aria-pressed={view === "list"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-center transition",
                    view === "list"
                      ? "bg-orange-600 text-white shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  <List className="size-3.5" aria-hidden />
                  ListView
                </button>
              ) : null}
              {showActivity ? (
                <button
                  type="button"
                  onClick={() => selectView("activity")}
                  aria-pressed={view === "activity"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-center transition",
                    view === "activity"
                      ? "bg-orange-600 text-white shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  <Activity className="size-3.5" aria-hidden />
                  Activity
                </button>
              ) : null}
              {showSections ? (
                <button
                  type="button"
                  onClick={() => selectView("sections")}
                  aria-pressed={view === "sections"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-center transition",
                    view === "sections"
                      ? "bg-orange-600 text-white shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  <FolderKanban className="size-3.5" aria-hidden />
                  Org. Chart
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {view !== "sections" ? (
        <div className="flex w-full flex-col gap-1.5 rounded-xl border border-zinc-300 bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:gap-2 sm:p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          <label className="flex min-w-0 flex-1 items-center px-1.5 py-1 text-sm text-zinc-600 sm:px-2 dark:text-zinc-400">
            <Search className="mr-2 size-4 shrink-0 opacity-60" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full min-w-0 bg-transparent text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-200"
              aria-label="Search personnel by name or email"
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <Filters
              filters={filters}
              setFilters={setFilters}
              filterOptions={filterOptions}
              showOperators={false}
            />
            <FiltersTrigger
              viewOptions={[
                showActivity
                  ? [
                      { name: "Role", icon: undefined },
                      { name: "Company", icon: undefined },
                      { name: "On-duty company", icon: undefined },
                    ]
                  : [
                      { name: "Role", icon: undefined },
                      { name: "Company", icon: undefined },
                    ],
              ]}
              filterOptions={filterOptions}
              onSelect={addFilter}
              savedFilters={savedFilters}
              onSaveFilter={saveCurrentFilter}
              onApplySavedFilter={applySavedFilter}
              onDeleteSavedFilter={deleteSavedFilter}
              canSaveCurrent={canSaveCurrent}
            />
            {filters.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="transition group h-6 text-xs items-center rounded-sm"
                onClick={clearAllFilters}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
        ) : null}

        <div className={cn(view === "list" ? "block" : "hidden")}>
          <PersonnelClient
            embedded
            externalSearchQuery={searchQuery}
            externalRoleFilter={roleFilter}
            externalCompanyFilter={personnelCompanyFilter}
            initialTeams={props.initialTeams}
            initialPersonnel={props.initialPersonnel}
            initialAssignableCompanies={props.initialAssignableCompanies}
            viewerMode={props.viewerMode}
            scopeUnavailable={props.scopeUnavailable}
            scopedCompanyName={props.scopedCompanyName}
            secondaryDatabaseName={props.secondaryDatabaseName}
          />
        </div>
        <div className={cn(view === "activity" && activityOpened ? "block" : "hidden")}>
          {activityOpened ? (
            <ActivitiesClient
              embedded
              externalSearchQuery={searchQuery}
              externalCompanyFilter={onDutyCompany}
              externalRoleFilter={roleFilter}
            initialOnDutyAgents={props.initialOnDutyAgents}
            initialOnDutyPage={props.initialOnDutyPage}
            onDutyTotalPages={props.onDutyTotalPages}
            onDutyTotal={props.onDutyTotal}
            onDutyActiveCount={props.onDutyActiveCount}
            initialOnDutyCompanies={props.initialOnDutyCompanies}
            onDutyPageSize={props.onDutyPageSize}
            lockedCompanyFilter={props.lockedCompanyFilter}
            />
          ) : null}
        </div>
        {showSections ? (
          <div className={cn(view === "sections" && sectionsOpened ? "block" : "hidden")}>
            {sectionsOpened && props.initialOrgSections && props.initialOrgNodes ? (
              <WorkforceSectioningClient
                initialSections={props.initialOrgSections}
                initialNodes={props.initialOrgNodes}
                initialEitherOrLinks={props.initialOrgEitherOrLinks ?? []}
                roster={props.initialPersonnel}
                companyOptions={props.sectionCompanyOptions ?? []}
                readOnly={!canManageSections}
                canSetPortalRoles={Boolean(props.canSetPortalRoles)}
                initialPortalRoleByMergedId={props.initialPortalRoleByMergedId ?? {}}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
