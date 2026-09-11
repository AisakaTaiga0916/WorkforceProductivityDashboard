"use client";


import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { authInputClass, authLabelClass } from "@/components/auth/AuthShell";
import { cn } from "@/lib/cn";
import { BRAND_TITLE } from "@/lib/brand";
import type { PersonnelRosterRow } from "@/lib/personnel-accounts-data";
import {
  ALL_SBUS_VALUE,
  NO_COMPANY_FILTER,
  PORTAL_REGISTRY_PAGE_SIZE,
  accountStatusClass,
  matchesRegistryCompanyFilter,
  matchesRegistryCompanyNameFilter,
  matchesRegistryRoleFilter,
  matchesRegistrySearchFilter,
  portalRegistryRoleLabel,
  type PortalAccountRow,
  type RosterCompany,
} from "@/lib/portal-account-registry";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";
import { RegistryFiltersBar } from "@/components/admin/RegistryFiltersBar";
import { StaffAssignmentColorSelect } from "@/components/admin/StaffAssignmentColorSelect";
import { SimplePaginationBar } from "@/components/ui/SimplePaginationBar";
import { PORTAL_ROLES, isStaffPortalRole, normalizePortalRole, isElevatedPlatformRole } from "@/lib/staff-role";

type Team = { id: string; name: string };

type PendingAccountRequestRow = {
  id: string;
  requestType: string;
  reason: string | null;
  status: string;
  createdAt: string;
  portalAccount: { id: string; name: string; email: string; role: string };
};

export function PersonnelClient({
  initialTeams,
  initialPersonnel,
  initialAssignableCompanies,
  viewerMode,
  scopeUnavailable,
  scopedCompanyName,
  secondaryDatabaseName = "mergeddatabase-dev",
  embedded = false,
  externalSearchQuery,
  externalRoleFilter,
  externalCompanyFilter,
}: {
  initialTeams: Team[];
  initialPersonnel: PersonnelRosterRow[];
  initialAssignableCompanies?: RosterCompany[];
  viewerMode: "superadmin" | "admin";
  scopeUnavailable: boolean;
  scopedCompanyName: string | null;
  secondaryDatabaseName?: string;
  /** Renders just the registry content, without the page shell, for embedding. */
  embedded?: boolean;
  /** Shared search bar query from the parent Workforce page. When set, this
   *  replaces the registry's own search input (hidden) for the embedded view. */
  externalSearchQuery?: string;
  /** Role filter chip from the parent Workforce search bar (registry role). */
  externalRoleFilter?: string;
  /** Company filter chip from the parent Workforce search bar (team id). */
  externalCompanyFilter?: string;
}) {
  const isAdminCompanyView = viewerMode === "admin";
  const [, setTeams] = useState<Team[]>(initialTeams);
  const [personnel, setPersonnel] = useState<PersonnelRosterRow[]>(initialPersonnel);
  const [error, setError] = useState<string | null>(null);
  const [portalAccounts, setPortalAccounts] = useState<PortalAccountRow[]>([]);
  const [rosterCompanies, setRosterCompanies] = useState<RosterCompany[]>(
    initialAssignableCompanies?.length
      ? initialAssignableCompanies
      : initialTeams.map((t) => ({ id: t.id, name: t.name })),
  );
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [pendingAccountRequests, setPendingAccountRequests] = useState<PendingAccountRequestRow[]>([]);
  const [requestReviewBusyId, setRequestReviewBusyId] = useState<string | null>(null);

  const [createBusy, setCreateBusy] = useState(false);
  const [createAccountModalOpen, setCreateAccountModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOk, setCreateOk] = useState<string | null>(null);
  const [createUsername, setCreateUsername] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<"Admin" | "Personnel">("Personnel");
  const [createCompanyId, setCreateCompanyId] = useState("");
  const [personnelRegistryPage, setPersonnelRegistryPage] = useState(1);
  const [portalRegistryPage, setPortalRegistryPage] = useState(1);
  const [registryRoleFilter, setRegistryRoleFilter] = useState("");
  const [registryCompanyFilter, setRegistryCompanyFilter] = useState("");
  const [registrySearchQuery, setRegistrySearchQuery] = useState("");
  // Prefer the parent's shared search bar; fall back to the in-bar controls.
  const effectiveSearchQuery = externalSearchQuery ?? registrySearchQuery;
  const effectiveRoleFilter = externalRoleFilter ?? registryRoleFilter;
  const effectiveCompanyFilter = externalCompanyFilter ?? registryCompanyFilter;

  const { data: session, status: sessionStatus } = useSession();
  const canManagePortalAccounts = isElevatedPlatformRole(session?.user?.role);

  const filteredPersonnel = useMemo(
    () =>
      personnel.filter(
        (row) =>
          matchesRegistryRoleFilter(row.staffRole, effectiveRoleFilter) &&
          // The external Workforce company chip carries the canonical company
          // *name* (matching the on-duty view); the internal registry bar still
          // carries team ids.
          (externalCompanyFilter !== undefined
            ? matchesRegistryCompanyNameFilter(row.teamName, effectiveCompanyFilter)
            : matchesRegistryCompanyFilter(row.teamId, effectiveCompanyFilter)) &&
          matchesRegistrySearchFilter(row, effectiveSearchQuery),
      ),
    [personnel, effectiveRoleFilter, effectiveCompanyFilter, effectiveSearchQuery, externalCompanyFilter],
  );

  const filteredPortalAccounts = useMemo(
    () =>
      portalAccounts.filter(
        (a) =>
          matchesRegistryRoleFilter(a.role, effectiveRoleFilter) &&
          (externalCompanyFilter !== undefined
            ? matchesRegistryCompanyNameFilter(
                a.staffDesignatedCompany?.name ?? null,
                effectiveCompanyFilter,
              )
            : matchesRegistryCompanyFilter(a.staffDesignatedCompanyId, effectiveCompanyFilter)) &&
          matchesRegistrySearchFilter(a, effectiveSearchQuery),
      ),
    [portalAccounts, effectiveRoleFilter, effectiveCompanyFilter, effectiveSearchQuery, externalCompanyFilter],
  );

  const registryFiltersActive = Boolean(
    effectiveRoleFilter || effectiveCompanyFilter || effectiveSearchQuery.trim(),
  );

  function handleRegistryRoleFilterChange(value: string) {
    setRegistryRoleFilter(value);
    setPersonnelRegistryPage(1);
    setPortalRegistryPage(1);
  }

  function handleRegistryCompanyFilterChange(value: string) {
    setRegistryCompanyFilter(value);
    setPersonnelRegistryPage(1);
    setPortalRegistryPage(1);
  }

  function handleRegistrySearchQueryChange(value: string) {
    setRegistrySearchQuery(value);
    setPersonnelRegistryPage(1);
    setPortalRegistryPage(1);
  }

  async function reconcileDuplicateAgents() {
    setError(null);
    setReconcileBusy(true);
    try {
      const res = await fetch("/api/admin/accounts/reconcile", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; mergedAgentRows?: number };
      if (!res.ok) {
        setError(data.error ?? "Could not merge duplicate agent rows.");
        return;
      }
      await load();
      await loadRoles();
      await loadPendingAccountRequests();
    } finally {
      setReconcileBusy(false);
    }
  }

  async function loadPendingAccountRequests() {
    const res = await fetch("/api/admin/account-requests", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) return;
    const data = (await res.json()) as { rows?: PendingAccountRequestRow[] };
    const rows = data.rows ?? [];
    setPendingAccountRequests(rows.filter((r) => r.status === "PENDING"));
  }

  async function reviewAccountRequest(id: string, status: "APPROVED" | "REJECTED") {
    setError(null);
    setRequestReviewBusyId(id);
    try {
      const res = await fetch("/api/admin/account-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Could not update request.");
        return;
      }
      await loadPendingAccountRequests();
      await loadRoles();
    } finally {
      setRequestReviewBusyId(null);
    }
  }

  async function createStaffAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    setCreateOk(null);
    if (!createCompanyId) {
      setCreateError("Select a designated company queue.");
      return;
    }
    setCreateBusy(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: createUsername.trim(),
          email: createEmail.trim(),
          name: createName.trim(),
          password: createPassword,
          role: createRole,
          staffDesignatedCompanyId: createCompanyId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCreateError(data.error ?? "Could not create account.");
        return;
      }
      setCreateOk("Account created. They can sign in with the username and password you set.");
      setCreateUsername("");
      setCreateEmail("");
      setCreateName("");
      setCreatePassword("");
      setCreateRole("Personnel");
      setCreateCompanyId("");
      setCreateAccountModalOpen(false);
      await loadRoles();
      await load();
    } finally {
      setCreateBusy(false);
    }
  }

  async function load() {
    const res = await fetch("/api/admin/accounts");
    if (!res.ok) return;
    const data = (await res.json()) as {
      teams: Team[];
      personnel?: PersonnelRosterRow[];
      assignableCompanies?: RosterCompany[];
    };
    setTeams(data.teams ?? []);
    setPersonnel(data.personnel ?? []);
    if (data.assignableCompanies?.length) {
      setRosterCompanies(data.assignableCompanies);
    } else {
      setRosterCompanies((data.teams ?? []).map((t) => ({ id: t.id, name: t.name })));
    }
  }

  async function updateMergedUserRole(mergedSourceUserId: string, role: string) {
    setError(null);
    setRoleBusyId(mergedSourceUserId);
    try {
      const res = await fetch("/api/admin/personnel/role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mergedSourceUserId, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update role.");
        return;
      }
      await load();
    } finally {
      setRoleBusyId(null);
    }
  }

  async function updateMergedUserCompany(mergedSourceUserId: string, teamId: string) {
    setError(null);
    setRoleBusyId(mergedSourceUserId);
    try {
      const res = await fetch("/api/admin/personnel/company", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mergedSourceUserId,
          teamId: teamId || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update company.");
        return;
      }
      await load();
    } finally {
      setRoleBusyId(null);
    }
  }

  function assignableTeamIdForRow(row: PersonnelRosterRow): string {
    const byId = rosterCompanies.find((c) => c.id === row.teamId);
    if (byId) return byId.id;
    const byName = rosterCompanies.find(
      (c) => c.name.trim().toLowerCase() === row.teamName.trim().toLowerCase(),
    );
    return byName?.id ?? "";
  }

  async function deletePortalAccount(portalAccountId: string) {
    if (!window.confirm("Permanently delete this user and all associated data? This cannot be undone.")) return;
    setError(null);
    setDeleteBusyId(portalAccountId);
    try {
      const res = await fetch(`/api/admin/portal-accounts/${portalAccountId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not delete portal account.");
        return;
      }
      await loadRoles();
      await load();
    } finally {
      setDeleteBusyId(null);
    }
  }

  async function removeFromRoster(portalAccountId: string, agentId: string | null) {
    if (!agentId) return;
    setError(null);
    setRoleBusyId(portalAccountId);
    try {
      const res = await fetch(`/api/admin/accounts/${agentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not remove from roster.");
        return;
      }
      await load();
      await loadRoles();
    } finally {
      setRoleBusyId(null);
    }
  }

  async function loadRoles() {
    const res = await fetch("/api/admin/roles", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      setPortalAccounts([]);
      setRosterCompanies([]);
      return;
    }
    if (!res.ok) {
      setError("Could not load portal accounts.");
      return;
    }
    const data = (await res.json()) as {
      accounts: PortalAccountRow[];
      rosterCompanies?: RosterCompany[];
    };
    setPortalAccounts(data.accounts ?? []);
    setRosterCompanies(data.rosterCompanies ?? []);
  }

  useEffect(() => {
    void loadPendingAccountRequests();
    void load();
  }, []);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (canManagePortalAccounts) {
      void loadRoles();
    }
  }, [sessionStatus, canManagePortalAccounts]);

  async function updateAccountPortalRole(id: string, role: string) {
    setError(null);
    setRoleBusyId(id);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update portal role.");
        return;
      }
      await loadRoles();
      await load();
    } finally {
      setRoleBusyId(null);
    }
  }

  async function updateStaffDesignated(id: string, staffDesignatedCompanyId: string) {
    setError(null);
    setRoleBusyId(id);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          staffDesignatedCompanyId: staffDesignatedCompanyId || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update designated company.");
        return;
      }
      await loadRoles();
      await load();
    } finally {
      setRoleBusyId(null);
    }
  }

  async function updateStaffAssignmentColor(
    mergedSourceUserId: string,
    staffAssignmentColor: string,
  ) {
    setError(null);
    setRoleBusyId(mergedSourceUserId);
    try {
      const res = await fetch("/api/admin/personnel/color", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mergedSourceUserId,
          staffAssignmentColor: staffAssignmentColor.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update assignment color.");
        return;
      }
      await load();
    } finally {
      setRoleBusyId(null);
    }
  }

  const teamSelectClass = `${cn(
    "w-full min-w-0 rounded-md border border-zinc-300 bg-zinc-50 px-1.5 py-1 text-[11px] text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
    "focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30",
  )} max-w-full sm:max-w-[140px]`;

  const assignmentInputClass = `${cn(
    "w-full min-w-0 rounded-md border border-zinc-300 bg-zinc-50 px-1.5 py-1 text-[11px] text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
    "focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30",
  )} max-w-full sm:max-w-[7.5rem]`;

  function showStaffDesignatedCompany(role: string) {
    const n = normalizePortalRole(role) ?? role;
    return n === "Admin" || n === "Personnel" || n === "Personnel-Guard" || n === "Customer";
  }

  const personnelRegistryPageCount = Math.max(
    1,
    Math.ceil(filteredPersonnel.length / PORTAL_REGISTRY_PAGE_SIZE),
  );
  const personnelRegistryPageClamped = Math.min(
    Math.max(1, personnelRegistryPage),
    personnelRegistryPageCount,
  );
  const paginatedPersonnel = useMemo(() => {
    const start = (personnelRegistryPageClamped - 1) * PORTAL_REGISTRY_PAGE_SIZE;
    return filteredPersonnel.slice(start, start + PORTAL_REGISTRY_PAGE_SIZE);
  }, [filteredPersonnel, personnelRegistryPageClamped]);

  const portalRegistryPageCount = Math.max(
    1,
    Math.ceil(filteredPortalAccounts.length / PORTAL_REGISTRY_PAGE_SIZE),
  );
  const portalRegistryPageClamped = Math.min(
    Math.max(1, portalRegistryPage),
    portalRegistryPageCount,
  );
  const paginatedPortalAccounts = useMemo(() => {
    const start = (portalRegistryPageClamped - 1) * PORTAL_REGISTRY_PAGE_SIZE;
    return filteredPortalAccounts.slice(start, start + PORTAL_REGISTRY_PAGE_SIZE);
  }, [filteredPortalAccounts, portalRegistryPageClamped]);

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
      <div className={cn("space-y-4", embedded ? "" : "mx-auto max-w-[min(100%,1600px)]")}>
        {embedded ? null : (
          <header className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400/95">
              {BRAND_TITLE} · Admin console
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white md:text-3xl">Personnel registry</h1>
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-500">
              Showing HRIS employees from {secondaryDatabaseName} · progress synced from ticketing
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
              {/* Portal account create / agent merge kept off — roster is mergedatabase SoT */}
            </div>
          </header>
        )}

        {createOk ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100/90">
            {createOk}
          </p>
        ) : null}

        <TaskBoardPopup
          open={createAccountModalOpen}
          title="Add staff portal account"
          onClose={() => {
            if (createBusy) return;
            setCreateAccountModalOpen(false);
            setCreateError(null);
          }}
          size="xl"
        >
          {createError ? (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/[0.07] px-3 py-2 text-xs text-red-800 dark:text-red-200/90">
              {createError}
            </p>
          ) : null}
          <form onSubmit={(e) => void createStaffAccount(e)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 sm:col-span-1">
              <span className={authLabelClass}>Username</span>
              <input
                required
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                autoComplete="off"
                placeholder="jdoe"
                className={authInputClass}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-1">
              <span className={authLabelClass}>Work email</span>
              <input
                type="email"
                required
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                autoComplete="off"
                placeholder="jdoe@company.com"
                className={authInputClass}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
              <span className={authLabelClass}>Display name</span>
              <input
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                autoComplete="off"
                placeholder="Jane Doe"
                className={authInputClass}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-1">
              <span className={authLabelClass}>Initial password</span>
              <input
                type="password"
                required
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
                className={authInputClass}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-1">
              <span className={authLabelClass}>Portal role</span>
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as "Admin" | "Personnel")}
                className={authInputClass}
                title="New accounts start as Personnel. Admin is granted when the person is set as a department or sub-department head."
              >
                <option value="Personnel">Personnel</option>
                <option value="Admin">Admin</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
              <span className={authLabelClass}>Designated company queue</span>
              <select
                required
                value={createCompanyId}
                onChange={(e) => setCreateCompanyId(e.target.value)}
                disabled={rosterCompanies.length === 0}
                className={authInputClass}
              >
                <option value="">Select company…</option>
                {rosterCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <button
                type="submit"
                disabled={createBusy || rosterCompanies.length === 0}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createBusy ? "Creating…" : "Create staff account"}
              </button>
              <button
                type="button"
                disabled={createBusy}
                onClick={() => {
                  setCreateAccountModalOpen(false);
                  setCreateError(null);
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </form>
        </TaskBoardPopup>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        ) : null}

        {pendingAccountRequests.length > 0 ? (
          <section className="rounded-xl border border-amber-400/40 bg-amber-500/[0.07] p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.06]">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-amber-900 dark:text-amber-200/90">
              Pending account requests
            </h2>
            <p className="mt-0.5 text-[11px] text-amber-800/90 dark:text-amber-100/70">
              Approve suspension, deletion, or password reset (default password applied on approval).
            </p>
            <ul className="mt-3 space-y-2">
              {pendingAccountRequests.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                      {r.requestType === "PASSWORD_RESET"
                        ? "Password reset"
                        : r.requestType === "DELETION"
                          ? "Account deletion"
                          : "Account suspension"}{" "}
                      · {r.portalAccount.name}
                    </p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400">{r.portalAccount.email}</p>
                    {r.reason?.trim() ? (
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{r.reason}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={requestReviewBusyId === r.id}
                      onClick={() => void reviewAccountRequest(r.id, "REJECTED")}
                      className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={requestReviewBusyId === r.id}
                      onClick={() => void reviewAccountRequest(r.id, "APPROVED")}
                      className="rounded-full bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isAdminCompanyView ? (
          <>
            {scopeUnavailable ? (
              <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-6 dark:border-amber-500/25 dark:bg-amber-500/[0.06]">
                <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-200/90">
                  No company queue assigned
                </h2>
                <p className="mt-1 max-w-xl text-[11px] leading-snug text-amber-900/90 dark:text-amber-100/80">
                  Your Admin account does not have a designated company yet. A SuperAdmin can set your designated company
                  under <strong className="font-semibold">Personnel</strong> so your roster appears here.
                </p>
              </section>
            ) : (
              <section className="space-y-3">
                <RegistryFiltersBar
                  showCompanyFilter={false}
                  hideSearch={externalSearchQuery !== undefined}
                  hideRoleFilter={externalRoleFilter !== undefined}
                  hideCompanyFilter={externalCompanyFilter !== undefined}
                  totalCount={personnel.length}
                  filteredCount={filteredPersonnel.length}
                  registryRoleFilter={registryRoleFilter}
                  onRegistryRoleFilterChange={handleRegistryRoleFilterChange}
                  registryCompanyFilter={registryCompanyFilter}
                  onRegistryCompanyFilterChange={handleRegistryCompanyFilterChange}
                  registrySearchQuery={effectiveSearchQuery}
                  onRegistrySearchQueryChange={handleRegistrySearchQueryChange}
                  rosterCompanies={rosterCompanies}
                  registryFiltersActive={registryFiltersActive}
                />
                <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800/90 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800/80">
                  <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-400">
                    Company roster
                  </h2>
                  <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
                    {scopedCompanyName ?? "Your queue"} · HRIS employees from {secondaryDatabaseName}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] table-fixed border-collapse divide-y divide-zinc-200 text-[11px] dark:divide-zinc-800/90">
                    <thead className="bg-zinc-100 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-500">
                      <tr>
                        <th className="w-[16%] px-3 py-2">Name</th>
                        <th className="w-[10%] px-3 py-2">User</th>
                        <th className="w-[22%] px-3 py-2">Email</th>
                        <th className="w-[12%] px-3 py-2">Roles</th>
                        <th className="w-[14%] px-3 py-2">Company</th>
                        <th className="w-[12%] px-3 py-2">Color</th>
                        <th className="w-[6%] px-3 py-2 text-right">Act.</th>
                        <th className="w-[8%] px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                      {filteredPersonnel.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-8 text-center text-xs text-zinc-600 dark:text-zinc-500">
                            {personnel.length === 0
                              ? "No HRIS personnel for this company yet."
                              : "No users match the selected role filter. Choose All roles to see everyone on this queue."}
                          </td>
                        </tr>
                      ) : (
                        paginatedPersonnel.map((row) => (
                          <tr key={row.mergedSourceUserId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                            <td className="truncate px-3 py-2 font-medium text-zinc-900 dark:text-white" title={row.name}>
                              {row.name}
                            </td>
                            <td className="truncate px-3 py-2 text-zinc-600 dark:text-slate-400" title={row.username ?? ""}>
                              {row.username?.trim() || "—"}
                            </td>
                            <td className="truncate px-3 py-2 text-zinc-600 dark:text-slate-400" title={row.email}>
                              {row.email}
                            </td>
                            <td className="truncate px-3 py-2 text-zinc-700 dark:text-zinc-300">
                              {normalizePortalRole(row.staffRole) ?? row.staffRole}
                            </td>
                            <td className="truncate px-3 py-2 text-zinc-600" title={row.teamName}>
                              {row.teamName}
                            </td>
                            <td className="px-2 py-2">
                              <StaffAssignmentColorSelect
                                disabled={roleBusyId === row.mergedSourceUserId}
                                value={row.staffAssignmentColor ?? ""}
                                onChange={(next) =>
                                  void updateStaffAssignmentColor(row.mergedSourceUserId, next)
                                }
                                selectClassName={assignmentInputClass}
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-[10px] text-zinc-500">—</td>
                            <td className="max-w-0 px-2 py-2">
                              <span
                                className={cn(
                                  "inline-flex max-w-full truncate rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase leading-tight tracking-wide",
                                  accountStatusClass(row.accountStatus),
                                )}
                              >
                                {row.accountStatus}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <SimplePaginationBar
                  page={personnelRegistryPageClamped}
                  pageSize={PORTAL_REGISTRY_PAGE_SIZE}
                  total={filteredPersonnel.length}
                  onPageChange={setPersonnelRegistryPage}
                  itemLabel="users"
                />
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-500">
              HRIS roster from {secondaryDatabaseName} · Set any portal technical role here
              (Personnel, Admin, HighAdmin, SuperAdmin, Personnel-Guard, Customer). Org Chart
              headship can still promote department heads to Admin on reconcile.
            </p>

            <RegistryFiltersBar
              showCompanyFilter
              hideSearch={externalSearchQuery !== undefined}
              hideRoleFilter={externalRoleFilter !== undefined}
              hideCompanyFilter={externalCompanyFilter !== undefined}
              totalCount={personnel.length}
              filteredCount={filteredPersonnel.length}
              registryRoleFilter={registryRoleFilter}
              onRegistryRoleFilterChange={handleRegistryRoleFilterChange}
              registryCompanyFilter={registryCompanyFilter}
              onRegistryCompanyFilterChange={handleRegistryCompanyFilterChange}
              registrySearchQuery={effectiveSearchQuery}
              onRegistrySearchQueryChange={handleRegistrySearchQueryChange}
              rosterCompanies={rosterCompanies}
              registryFiltersActive={registryFiltersActive}
            />

            <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800/90 dark:bg-zinc-900">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed border-collapse divide-y divide-zinc-200 text-[11px] dark:divide-zinc-800/90">
                  <thead className="bg-zinc-100 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-500">
                    <tr>
                      <th className="w-[15%] px-2 py-2">Name</th>
                      <th className="w-[10%] px-2 py-2">User</th>
                      <th className="w-[20%] px-2 py-2">Email</th>
                      <th className="w-[12%] px-2 py-2">Role</th>
                      <th className="w-[16%] px-2 py-2">Company</th>
                      <th className="w-[12%] px-2 py-2">Color</th>
                      <th className="w-[7%] px-2 py-2 text-right">Act.</th>
                      <th className="w-[8%] px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                    {filteredPersonnel.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-xs text-zinc-600 dark:text-zinc-500">
                          {personnel.length === 0
                            ? `No HRIS users found in ${secondaryDatabaseName}.`
                            : "No users match the selected filters."}
                        </td>
                      </tr>
                    ) : (
                      paginatedPersonnel.map((row) => (
                        <tr key={row.mergedSourceUserId} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                          <td className="truncate px-2 py-1.5 font-medium text-zinc-900 dark:text-white" title={row.name}>
                            {row.name}
                          </td>
                          <td className="truncate px-2 py-1.5 text-zinc-600 dark:text-slate-400" title={row.username ?? ""}>
                            {row.username?.trim() || "—"}
                          </td>
                          <td className="truncate px-2 py-1.5 text-zinc-600 dark:text-slate-400" title={row.email}>
                            {row.email}
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              disabled={roleBusyId === row.mergedSourceUserId}
                              value={normalizePortalRole(row.staffRole) ?? row.staffRole}
                              onChange={(e) =>
                                void updateMergedUserRole(row.mergedSourceUserId, e.target.value)
                              }
                              className={teamSelectClass}
                              title="Change portal technical role"
                            >
                              {PORTAL_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <select
                              disabled={roleBusyId === row.mergedSourceUserId || rosterCompanies.length === 0}
                              value={assignableTeamIdForRow(row)}
                              onChange={(e) =>
                                void updateMergedUserCompany(row.mergedSourceUserId, e.target.value)
                              }
                              className={teamSelectClass}
                              title={row.teamName}
                            >
                              <option value="">-</option>
                              {rosterCompanies.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <StaffAssignmentColorSelect
                              disabled={roleBusyId === row.mergedSourceUserId}
                              value={row.staffAssignmentColor ?? ""}
                              onChange={(next) =>
                                void updateStaffAssignmentColor(row.mergedSourceUserId, next)
                              }
                              selectClassName={assignmentInputClass}
                            />
                          </td>
                          <td className="px-2 py-1 text-right text-[10px] text-zinc-500">—</td>
                          <td className="max-w-0 px-1 py-1">
                            <span
                              className={cn(
                                "inline-flex max-w-full truncate rounded border px-1 py-0.5 text-[8px] font-bold uppercase leading-tight tracking-wide",
                                accountStatusClass(row.accountStatus),
                              )}
                            >
                              {row.accountStatus}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <SimplePaginationBar
                page={personnelRegistryPageClamped}
                pageSize={PORTAL_REGISTRY_PAGE_SIZE}
                total={filteredPersonnel.length}
                onPageChange={setPersonnelRegistryPage}
                itemLabel="users"
              />
            </section>
          </>
        )}
      </div>
    </ShellTag>
  );
}
