"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, DatabaseZap, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import type { IamUser } from "@/modules/platform/rbac/iam-admin";
import type { MergedImportSummary } from "@/modules/platform/auth/merged-user-import";
import { cn } from "@/lib/cn";

type RoleOption = { id: string; key: string; name: string; isSystem: boolean };
type CompanyOption = { id: string; name: string };
type Viewer = { userId: string; roleKey: string | null; companyScoped: boolean; permissions: string[] };

type UsersResponse = {
  users?: IamUser[];
  total?: number;
  page?: number;
  pageSize?: number;
  roles?: RoleOption[];
  companies?: CompanyOption[];
  viewer?: Viewer;
  error?: string;
};

const PAGE_SIZE = 50;

export function UsersPanel() {
  const [users, setUsers] = useState<IamUser[]>([]);
  const [total, setTotal] = useState(0);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [status, setStatus] = useState("active");
  const [customers, setCustomers] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<MergedImportSummary | null>(null);

  const perms = new Set(viewer?.permissions ?? []);
  const canAssign = perms.has("users.assign");
  const canUpdate = perms.has("users.update");
  const canImport = perms.has("users.create");
  const isSuperAdmin = viewer?.roleKey === "super_admin";

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  function onFilter<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setPage(1);
    };
  }

  const requestSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQ) params.set("q", debouncedQ);
    if (roleFilter) params.set("roleId", roleFilter);
    if (companyFilter) params.set("companyId", companyFilter);
    if (customers) params.set("customers", "1");
    try {
      const res = await fetch(`/api/admin/iam/users?${params}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as UsersResponse;
      if (seq !== requestSeq.current) return;
      if (!res.ok || !data.users) {
        setError(data.error ?? "Could not load users.");
        return;
      }
      setUsers(data.users);
      setTotal(data.total ?? 0);
      setRoles(data.roles ?? []);
      setCompanies(data.companies ?? []);
      setViewer(data.viewer ?? null);
    } catch {
      if (seq === requestSeq.current) setError("Could not load users.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [status, page, debouncedQ, roleFilter, companyFilter, customers]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchUser(user: IamUser, body: Record<string, unknown>): Promise<boolean> {
    setSavingId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/iam/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { user?: IamUser; error?: string };
      if (!res.ok || !data.user) {
        setError(`${user.name}: ${data.error ?? "update failed."}`);
        return false;
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? data.user! : u)));
      return true;
    } catch {
      setError(`${user.name}: update failed.`);
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function runImport(dryRun: boolean) {
    if (!dryRun && !window.confirm("Import users from the merged dump into the main database now?")) {
      return;
    }
    setImportBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/iam/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const data = (await res.json().catch(() => ({}))) as MergedImportSummary & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Import failed.");
        return;
      }
      setImportResult(data);
      if (!dryRun) void load();
    } catch {
      setError("Import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
            User Management
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Users
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Users live on the main database. Assign each user one role, the companies they can
            access (one is their default), or deactivate them. Team placement and the org chart
            are managed in Workforce. HRIS users arrive through the merged-dump import — there is
            no live HRIS link.
            {viewer?.companyScoped ? " You can only manage users who share one of your companies." : ""}
          </p>
        </div>
        {canImport ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={importBusy}
              onClick={() => void runImport(true)}
            >
              Preview import
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={importBusy}
              onClick={() => void runImport(false)}
              className="gap-1.5"
            >
              <DatabaseZap className="size-3.5" aria-hidden />
              {importBusy ? "Importing…" : "Import from merged dump"}
            </Button>
          </div>
        ) : null}
      </div>

      {importResult ? <ImportSummary summary={importResult} onClose={() => setImportResult(null)} /> : null}

      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            className="pl-9"
            placeholder="Search name, email, username"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <Select
          value={roleFilter}
          onChange={(e) => onFilter(setRoleFilter)(e.target.value)}
          aria-label="Role filter"
        >
          <option value="">All roles</option>
          <option value="none">No role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select
          value={companyFilter}
          onChange={(e) => onFilter(setCompanyFilter)(e.target.value)}
          aria-label="Company filter"
        >
          <option value="">All companies</option>
          <option value="none">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => onFilter(setStatus)(e.target.value)}
          aria-label="Status filter"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="conflict">Legacy conflicts</option>
          <option value="all">All statuses</option>
        </Select>
        <label className="mt-1 flex items-center gap-2 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={customers}
            onChange={(e) => onFilter(setCustomers)(e.target.checked)}
          />
          Include customers
        </label>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Company access</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No users match these filters.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const saving = savingId === user.id;
                const conflict = user.status === "LEGACY_CONFLICT";
                const active = user.status === "ACTIVE";
                const isSelf = viewer?.userId === user.id;
                const superAdminLocked = !isSuperAdmin && user.roleKey === "super_admin";
                return (
                  <tr
                    key={user.id}
                    className={cn(
                      "border-t border-zinc-100 dark:border-zinc-800/70",
                      saving && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-2">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {user.name}
                        {isSelf ? <span className="ml-1.5 text-[10px] font-bold text-orange-600">YOU</span> : null}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {user.email}
                        {user.username ? ` · ${user.username}` : ""}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-1">
                        {user.hrisLinked ? <Badge>HRIS</Badge> : null}
                        {!user.hasPassword ? <Badge tone="warn">No password</Badge> : null}
                        {!user.roleId ? <Badge tone="warn">Legacy: {user.legacyRole}</Badge> : null}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        className="mt-0 min-w-[10rem]"
                        value={user.roleId ?? ""}
                        disabled={!canAssign || saving || conflict || superAdminLocked}
                        onChange={(e) => {
                          if (e.target.value) void patchUser(user, { roleId: e.target.value });
                        }}
                        aria-label={`Role for ${user.name}`}
                      >
                        {!user.roleId ? <option value="">— No role —</option> : null}
                        {roles
                          .filter((r) => isSuperAdmin || r.key !== "super_admin" || r.id === user.roleId)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <CompanyAccessCell
                        user={user}
                        companies={companies}
                        disabled={!canUpdate || saving || conflict || Boolean(viewer?.companyScoped)}
                        onSave={(companyIds, defaultCompanyId) =>
                          patchUser(user, { companyIds, defaultCompanyId })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      {conflict ? (
                        <Badge tone="warn">Legacy conflict</Badge>
                      ) : (
                        <button
                          type="button"
                          disabled={!canUpdate || saving || (isSelf && active)}
                          onClick={() => void patchUser(user, { active: !active })}
                          className={cn(
                            "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                            active
                              ? "bg-emerald-600/15 text-emerald-800 hover:bg-emerald-600/25 dark:text-emerald-200"
                              : "bg-zinc-500/15 text-zinc-600 hover:bg-zinc-500/25 dark:text-zinc-300",
                          )}
                          title={active ? "Click to deactivate" : "Click to activate"}
                        >
                          {active ? "Active" : "Inactive"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {total} user{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </Button>
          <span>
            Page {page} / {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pageCount || loading}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Company access: chips (default first) + inline editor (multi-select + default). */
function CompanyAccessCell({
  user,
  companies,
  disabled,
  onSave,
}: {
  user: IamUser;
  companies: CompanyOption[];
  disabled: boolean;
  onSave: (companyIds: string[], defaultCompanyId: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  function startEdit() {
    setSelected(user.companies.map((c) => c.id));
    setDefaultId(user.defaultCompanyId);
    setEditing(true);
  }

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id];
    setSelected(next);
    if (!defaultId || !next.includes(defaultId)) setDefaultId(next[0] ?? null);
  }

  if (!editing) {
    return (
      <div className="flex min-w-[12rem] flex-wrap items-center gap-1">
        {user.companies.length === 0 ? (
          <span className="text-xs text-zinc-500">— No company —</span>
        ) : (
          user.companies.map((c) => (
            <span
              key={c.id}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                c.isDefault
                  ? "bg-orange-500/15 text-orange-800 dark:text-orange-200"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                c.archived && "line-through opacity-60",
              )}
              title={c.isDefault ? "Default company" : undefined}
            >
              {c.name}
              {c.isDefault ? " · default" : ""}
            </span>
          ))
        )}
        {!disabled ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-orange-700 hover:underline dark:text-orange-300"
            onClick={startEdit}
          >
            Edit
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-[14rem] space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {companies.map((c) => {
          const checked = selected.includes(c.id);
          return (
            <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={checked} onChange={() => toggle(c.id)} />
                {c.name}
              </label>
              <label
                className={cn(
                  "flex items-center gap-1 text-[10px] text-zinc-500",
                  !checked && "invisible",
                )}
              >
                <input
                  type="radio"
                  name={`default-${user.id}`}
                  checked={defaultId === c.id}
                  onChange={() => setDefaultId(c.id)}
                />
                Default
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={() =>
            void onSave(selected, selected.length > 0 ? defaultId : null).then((ok) => {
              if (ok) setEditing(false);
            })
          }
        >
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        tone === "warn"
          ? "bg-amber-400/15 text-amber-800 dark:text-amber-200"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      )}
    >
      {children}
    </span>
  );
}

function ImportSummary({ summary, onClose }: { summary: MergedImportSummary; onClose: () => void }) {
  const stats: Array<[string, number]> = [
    ["Source rows", summary.sourceRows],
    ["HRIS snapshot rows", summary.snapshotRows],
    ["Created", summary.created],
    ["Updated", summary.updated],
    ["Unchanged", summary.unchanged],
    ["Deactivated", summary.deactivated],
    ["Roles assigned", summary.rolesAssigned],
    ["Passwords set", summary.passwordsSet],
    ["Companies set", summary.companiesSet],
    ["Duplicates skipped", summary.duplicates],
    ["Non-HRIS skipped", summary.skippedNonHris],
  ];
  return (
    <div className="mt-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
          {summary.dryRun ? "Import preview (nothing written)" : "Import complete"}
        </p>
        <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={onClose}>
          Dismiss
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-zinc-500">{label}</dt>
            <dd className="font-semibold text-zinc-900 dark:text-zinc-100">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.conflicts.length + summary.errors.length > 0 ? (
        <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto text-xs text-amber-800 dark:text-amber-200">
          {summary.conflicts.map((c) => (
            <li key={`c-${c.sourceUserId}`}>
              #{c.sourceUserId}: {c.reason}
            </li>
          ))}
          {summary.errors.map((e) => (
            <li key={`e-${e.sourceUserId}`}>
              #{e.sourceUserId}: {e.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
