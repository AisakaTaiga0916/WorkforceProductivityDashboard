"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Columns3, Lock, Plus, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select, Textarea } from "@/components/ui/field";
import type { IamPermissionGroup, IamRole } from "@/modules/platform/rbac/iam-admin";
import { cn } from "@/lib/cn";

const SUPER_ADMIN_KEY = "super_admin";

type RolesResponse = {
  roles?: IamRole[];
  catalog?: IamPermissionGroup[];
  viewerPermissions?: string[];
  error?: string;
};

function sameKeys(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((k) => a.has(k));
}

export function RolesPanel() {
  const [roles, setRoles] = useState<IamRole[]>([]);
  const [catalog, setCatalog] = useState<IamPermissionGroup[]>([]);
  const [viewerPerms, setViewerPerms] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftKeys, setDraftKeys] = useState<Set<string>>(new Set());
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [compare, setCompare] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [copyFromId, setCopyFromId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = roles.find((r) => r.id === selectedId) ?? null;
  const isSuperAdmin = selected?.key === SUPER_ADMIN_KEY;
  const can = (key: string) => viewerPerms.has(key);
  const grantsDirty = selected ? !sameKeys(draftKeys, selected.permissionKeys) : false;
  const detailsDirty = selected
    ? draftName !== selected.name || draftDescription !== (selected.description ?? "")
    : false;

  const selectedIdRef = useRef<string | null>(null);
  const selectRole = useCallback((role: IamRole | null) => {
    selectedIdRef.current = role?.id ?? null;
    setSelectedId(role?.id ?? null);
    setDraftKeys(new Set(role?.permissionKeys ?? []));
    setDraftName(role?.name ?? "");
    setDraftDescription(role?.description ?? "");
  }, []);

  const applyRoles = useCallback(
    (next: IamRole[], preferId?: string | null) => {
      setRoles(next);
      const wanted = preferId === undefined ? selectedIdRef.current : preferId;
      selectRole(next.find((r) => r.id === wanted) ?? next[0] ?? null);
    },
    [selectRole],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/iam/roles", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as RolesResponse;
      if (!res.ok || !data.roles) {
        setError(data.error ?? "Could not load roles.");
        return;
      }
      setCatalog(data.catalog ?? []);
      setViewerPerms(new Set(data.viewerPermissions ?? []));
      applyRoles(data.roles);
    } catch {
      setError("Could not load roles.");
    } finally {
      setLoading(false);
    }
  }, [applyRoles]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(
    url: string,
    init: RequestInit,
    success: string,
    preferId?: string | null,
  ): Promise<RolesResponse | null> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const data = (await res.json().catch(() => ({}))) as RolesResponse & { role?: IamRole };
      if (!res.ok || !data.roles) {
        setError(data.error ?? "Request failed.");
        return null;
      }
      applyRoles(data.roles, preferId ?? data.role?.id);
      setMessage(success);
      return data;
    } catch {
      setError("Request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createRole() {
    const data = await call(
      "/api/admin/iam/roles",
      {
        method: "POST",
        body: JSON.stringify({
          name: newName,
          description: newDescription,
          copyFromRoleId: copyFromId || undefined,
        }),
      },
      "Custom role created. Adjust its permissions, then save.",
    );
    if (data) {
      setNewName("");
      setNewDescription("");
      setCopyFromId("");
    }
  }

  function toggleKey(key: string, on: boolean) {
    setDraftKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    setMessage(null);
  }

  function toggleGroup(group: IamPermissionGroup, on: boolean) {
    setDraftKeys((prev) => {
      const next = new Set(prev);
      for (const p of group.permissions) {
        if (on) next.add(p.key);
        else next.delete(p.key);
      }
      return next;
    });
    setMessage(null);
  }

  const allPermissionCount = useMemo(
    () => catalog.reduce((sum, g) => sum + g.permissions.length, 0),
    [catalog],
  );
  const matrixEditable = Boolean(selected) && !isSuperAdmin && can("rbac.manage_permissions");

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
            Roles
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Roles &amp; permissions
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Each user has one role. A checked permission is allowed; unchecked is denied. Company
            scope and approval seats are still checked separately, so <code>approve</code> /{" "}
            <code>verify</code> never make someone an approver on their own.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || roles.length === 0}
          onClick={() => setCompare((v) => !v)}
          className="gap-1.5"
        >
          <Columns3 className="size-3.5" aria-hidden />
          {compare ? "Edit one role" : "Compare roles"}
        </Button>
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
      ) : roles.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          No roles yet. Run <code>npm run db:seed:iam</code> to create Super Admin, Admin, and
          Employee.
        </p>
      ) : compare ? (
        <CompareMatrix roles={roles} catalog={catalog} />
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="space-y-4">
            <ul className="space-y-1.5">
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    onClick={() => selectRole(role)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition",
                      role.id === selectedId
                        ? "border-orange-500/50 bg-orange-500/10"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {role.name}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {role.isSystem ? "System" : "Custom"} · {role.userCount} user
                        {role.userCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {role.permissionKeys.length}/{allPermissionCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {can("rbac.create") ? (
              <div className="space-y-2 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">New custom role</p>
                <Input
                  placeholder="Role name"
                  value={newName}
                  maxLength={60}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  placeholder="Description (optional)"
                  value={newDescription}
                  maxLength={300}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
                <Select value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)}>
                  <option value="">Start with no permissions</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      Copy from {r.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || newName.trim().length < 2}
                  onClick={() => void createRole()}
                  className="w-full gap-1.5"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Create role
                </Button>
              </div>
            ) : null}
          </aside>

          {selected ? (
            <div className="min-w-0 space-y-4">
              <div className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  {selected.isSystem ? (
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{selected.name}</h3>
                  ) : (
                    <Input
                      aria-label="Role name"
                      className="mt-0 max-w-sm text-base font-semibold"
                      value={draftName}
                      maxLength={60}
                      disabled={!can("rbac.update")}
                      onChange={(e) => setDraftName(e.target.value)}
                    />
                  )}
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {selected.isSystem ? "System" : "Custom"}
                  </span>
                  <code className="text-[11px] text-zinc-500">{selected.key}</code>
                </div>
                <Textarea
                  aria-label="Role description"
                  rows={2}
                  value={draftDescription}
                  maxLength={300}
                  disabled={!can("rbac.update")}
                  onChange={(e) => setDraftDescription(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {can("rbac.update") ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !detailsDirty}
                      onClick={() =>
                        void call(
                          `/api/admin/iam/roles/${selected.id}`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({
                              ...(selected.isSystem ? {} : { name: draftName }),
                              description: draftDescription,
                            }),
                          },
                          "Role details saved.",
                        )
                      }
                      className="gap-1.5"
                    >
                      <Save className="size-3.5" aria-hidden />
                      Save details
                    </Button>
                  ) : null}
                  {!selected.isSystem && can("rbac.archive") ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || selected.userCount > 0}
                      title={selected.userCount > 0 ? "Reassign its users first" : undefined}
                      onClick={() => {
                        if (!window.confirm(`Archive the "${selected.name}" role?`)) return;
                        void call(
                          `/api/admin/iam/roles/${selected.id}`,
                          { method: "DELETE" },
                          "Role archived.",
                          null,
                        );
                      }}
                      className="gap-1.5"
                    >
                      <Archive className="size-3.5" aria-hidden />
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  Permissions · {draftKeys.size}/{allPermissionCount}
                </p>
                {matrixEditable ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.isSystem ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Restore default permissions for ${selected.name}?`)) return;
                          void call(
                            `/api/admin/iam/roles/${selected.id}/permissions`,
                            { method: "PUT", body: JSON.stringify({ restoreDefaults: true }) },
                            `${selected.name} restored to default permissions.`,
                          );
                        }}
                        className="gap-1.5"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        Restore defaults
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || !grantsDirty}
                      onClick={() =>
                        void call(
                          `/api/admin/iam/roles/${selected.id}/permissions`,
                          { method: "PUT", body: JSON.stringify({ permissionKeys: [...draftKeys] }) },
                          "Permissions saved.",
                        )
                      }
                      className="gap-1.5"
                    >
                      <Save className="size-3.5" aria-hidden />
                      Save permissions
                    </Button>
                  </div>
                ) : null}
              </div>

              {isSuperAdmin ? (
                <p className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                  Super Admin always holds every permission so global administration can never be
                  locked out.
                </p>
              ) : !can("rbac.manage_permissions") ? (
                <p className="text-xs text-zinc-500">
                  Read-only: changing grants requires <code>rbac.manage_permissions</code>.
                </p>
              ) : null}

              <div className="space-y-3">
                {catalog.map((group) => {
                  const held = group.permissions.filter((p) => draftKeys.has(p.key)).length;
                  return (
                    <div
                      key={group.resource}
                      className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="flex items-center justify-between gap-2 bg-zinc-50 px-4 py-2 dark:bg-zinc-900/60">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
                          {group.label}
                          <span className="ml-2 font-semibold normal-case tracking-normal text-zinc-500">
                            {held}/{group.permissions.length}
                          </span>
                        </p>
                        {matrixEditable ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
                            onClick={() => toggleGroup(group, held < group.permissions.length)}
                          >
                            {held < group.permissions.length ? "Allow all" : "Deny all"}
                          </button>
                        ) : null}
                      </div>
                      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                        {group.permissions.map((p) => (
                          <li key={p.key}>
                            <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5">
                              <Checkbox
                                className="mt-0.5"
                                checked={draftKeys.has(p.key)}
                                disabled={!matrixEditable || busy}
                                onCheckedChange={(v) => toggleKey(p.key, v === true)}
                              />
                              <span className="min-w-0">
                                <code className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                  {p.key}
                                </code>
                                <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                                  {p.description}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CompareMatrix({ roles, catalog }: { roles: IamRole[]; catalog: IamPermissionGroup[] }) {
  const grants = useMemo(
    () => new Map(roles.map((r) => [r.id, new Set(r.permissionKeys)])),
    [roles],
  );
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[40rem] text-left text-xs">
        <thead className="bg-zinc-50 dark:bg-zinc-900/60">
          <tr>
            <th className="px-3 py-2 font-semibold text-zinc-700 dark:text-zinc-300">Permission</th>
            {roles.map((r) => (
              <th key={r.id} className="px-3 py-2 text-center font-semibold text-zinc-700 dark:text-zinc-300">
                <span className="inline-flex items-center gap-1">
                  {r.key === SUPER_ADMIN_KEY ? <ShieldCheck className="size-3" aria-hidden /> : null}
                  {r.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {catalog.map((group) => (
            <GroupRows key={group.resource} group={group} roles={roles} grants={grants} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  group,
  roles,
  grants,
}: {
  group: IamPermissionGroup;
  roles: IamRole[];
  grants: Map<string, Set<string>>;
}) {
  return (
    <>
      <tr className="border-t border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/30">
        <td
          colSpan={roles.length + 1}
          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500"
        >
          {group.label}
        </td>
      </tr>
      {group.permissions.map((p) => (
        <tr key={p.key} className="border-t border-zinc-100 dark:border-zinc-800/70">
          <td className="px-3 py-1.5" title={p.description}>
            <code className="text-zinc-800 dark:text-zinc-200">{p.key}</code>
          </td>
          {roles.map((r) => (
            <td key={r.id} className="px-3 py-1.5 text-center">
              {grants.get(r.id)?.has(p.key) ? (
                <Check className="mx-auto size-3.5 text-emerald-600" aria-label="Allowed" />
              ) : (
                <span className="text-zinc-300 dark:text-zinc-700" aria-label="Denied">
                  ·
                </span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
