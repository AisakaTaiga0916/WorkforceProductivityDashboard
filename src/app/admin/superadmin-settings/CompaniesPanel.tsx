"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type { AdminCompany } from "@/modules/platform/companies/company-admin";
import { cn } from "@/lib/cn";

type CompaniesResponse = {
  companies?: AdminCompany[];
  viewerPermissions?: string[];
  error?: string;
};

type Draft = { name: string; code: string; aliases: string };

function draftFor(company: AdminCompany): Draft {
  return { name: company.name, code: company.code ?? "", aliases: company.aliases.join(", ") };
}

function aliasList(raw: string): string[] {
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * SuperAdmin Settings → Companies: the company directory (access boundary).
 * Create, rename / re-code, set HRIS aliases, reorder, archive / restore.
 */
export function CompaniesPanel() {
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", code: "", aliases: "" });
  const [createDraft, setCreateDraft] = useState<Draft>({ name: "", code: "", aliases: "" });
  const [showArchived, setShowArchived] = useState(false);

  const canCreate = permissions.has("companies.create");
  const canUpdate = permissions.has("companies.update");
  const canArchive = permissions.has("companies.archive");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/iam/companies", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as CompaniesResponse;
      if (!res.ok || !data.companies) {
        setError(data.error ?? "Could not load companies.");
        return;
      }
      setCompanies(data.companies);
      setPermissions(new Set(data.viewerPermissions ?? []));
    } catch {
      setError("Could not load companies.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const active = useMemo(() => companies.filter((c) => c.isActive), [companies]);
  const archived = useMemo(() => companies.filter((c) => !c.isActive), [companies]);

  async function send(url: string, method: string, body: unknown, busyKey: string): Promise<boolean> {
    setBusyId(busyKey);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as CompaniesResponse;
      if (!res.ok) {
        setError(data.error ?? "Update failed.");
        return false;
      }
      if (data.companies) setCompanies(data.companies);
      return true;
    } catch {
      setError("Update failed.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await send(
      "/api/admin/iam/companies",
      "POST",
      {
        name: createDraft.name,
        code: createDraft.code.trim() || null,
        aliases: aliasList(createDraft.aliases),
      },
      "create",
    );
    if (ok) setCreateDraft({ name: "", code: "", aliases: "" });
  }

  async function onSave(company: AdminCompany) {
    const ok = await send(
      `/api/admin/iam/companies/${company.id}`,
      "PATCH",
      { name: draft.name, code: draft.code.trim() || null, aliases: aliasList(draft.aliases) },
      company.id,
    );
    if (ok) setEditingId(null);
  }

  async function move(index: number, delta: -1 | 1) {
    const next = [...active];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await send("/api/admin/iam/companies/order", "PUT", { ids: next.map((c) => c.id) }, "order");
  }

  function renderRow(company: AdminCompany, index: number) {
    const editing = editingId === company.id;
    const busy = busyId === company.id || busyId === "order";
    return (
      <tr
        key={company.id}
        className={cn("border-t border-zinc-100 align-top dark:border-zinc-800/70", busy && "opacity-60")}
      >
        <td className="px-3 py-2">
          {editing ? (
            <Input
              className="mt-0"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              aria-label="Company name"
            />
          ) : (
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">
              {company.name}
            </p>
          )}
        </td>
        <td className="px-3 py-2">
          {editing ? (
            <Input
              className="mt-0 w-28"
              value={draft.code}
              onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
              aria-label="Company code"
            />
          ) : (
            <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">{company.code ?? "—"}</span>
          )}
        </td>
        <td className="px-3 py-2">
          {editing ? (
            <Input
              className="mt-0"
              value={draft.aliases}
              placeholder="e.g. fames, mchisi fames"
              onChange={(e) => setDraft((d) => ({ ...d, aliases: e.target.value }))}
              aria-label="HRIS aliases"
            />
          ) : (
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {company.aliases.length > 0 ? company.aliases.join(", ") : "—"}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
          {company.memberCount} users · {company.teamCount} teams · {company.ticketCount} requests
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {company.isActive && canUpdate ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                  aria-label={`Move ${company.name} up`}
                >
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || index === active.length - 1}
                  onClick={() => void move(index, 1)}
                  aria-label={`Move ${company.name} down`}
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
              </>
            ) : null}
            {canUpdate ? (
              editing ? (
                <>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void onSave(company)}>
                    Save
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(company.id);
                    setDraft(draftFor(company));
                  }}
                >
                  Edit
                </Button>
              )
            ) : null}
            {canArchive ? (
              <Button
                type="button"
                variant={company.isActive ? "outline" : "secondary"}
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (
                    company.isActive &&
                    !window.confirm(
                      `Archive ${company.name}? It leaves every company switcher; its requests, tasks, and memberships are kept.`,
                    )
                  ) {
                    return;
                  }
                  void send(
                    `/api/admin/iam/companies/${company.id}`,
                    "PATCH",
                    { isActive: !company.isActive },
                    company.id,
                  );
                }}
              >
                {company.isActive ? "Archive" : "Restore"}
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
          Companies
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Company directory</h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Companies are the access boundary: users see data only for companies they belong to (set in User
          Management). Aliases map HRIS / CSV company labels onto a company. Archived companies leave the switcher
          but keep their history.
        </p>
      </div>

      {canCreate ? (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,1.4fr)_auto]"
        >
          <Input
            required
            placeholder="New company name"
            value={createDraft.name}
            onChange={(e) => setCreateDraft((d) => ({ ...d, name: e.target.value }))}
            aria-label="New company name"
          />
          <Input
            placeholder="Code (optional)"
            value={createDraft.code}
            onChange={(e) => setCreateDraft((d) => ({ ...d, code: e.target.value }))}
            aria-label="New company code"
          />
          <Input
            placeholder="HRIS aliases, comma-separated (optional)"
            value={createDraft.aliases}
            onChange={(e) => setCreateDraft((d) => ({ ...d, aliases: e.target.value }))}
            aria-label="New company aliases"
          />
          <Button type="submit" disabled={busyId === "create"} className="mt-1 gap-1.5">
            <Plus className="size-3.5" aria-hidden />
            Add company
          </Button>
        </form>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Company</th>
              <th className="px-3 py-2 font-semibold">Code</th>
              <th className="px-3 py-2 font-semibold">HRIS aliases</th>
              <th className="px-3 py-2 font-semibold">Usage</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && companies.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : active.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No active companies.
                </td>
              </tr>
            ) : (
              active.map((company, index) => renderRow(company, index))
            )}
          </tbody>
        </table>
      </div>

      {archived.length > 0 ? (
        <div className="mt-4">
          <button
            type="button"
            className="text-xs font-semibold text-zinc-600 hover:underline dark:text-zinc-400"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide" : "Show"} archived companies ({archived.length})
          </button>
          {showArchived ? (
            <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <tbody>{archived.map((company, index) => renderRow(company, index))}</tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
