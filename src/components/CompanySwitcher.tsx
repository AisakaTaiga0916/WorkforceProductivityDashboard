"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

type ContextResponse = {
  companies?: Array<{ id: string; name: string; isDefault: boolean }>;
  currentCompanyId?: string | null;
  global?: boolean;
};

export const COMPANY_CONTEXT_CHANGED_EVENT = "company-context-changed";
const ALL = "all";

/**
 * Shell company switcher: the user's company memberships (every active company
 * plus "All companies" for Super Admin). The choice is remembered server-side
 * (cookie) and every board / API scopes to it.
 */
export function CompanySwitcher({
  fallbackLabel,
  className,
}: {
  /** Shown while loading or when the user has a single company. */
  fallbackLabel: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () =>
      void fetch("/api/me/company-context", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<ContextResponse>) : null))
        .then((data) => {
          if (!stopped && data) setContext(data);
        })
        .catch(() => undefined);
    load();
    window.addEventListener(COMPANY_CONTEXT_CHANGED_EVENT, load);
    return () => {
      stopped = true;
      window.removeEventListener(COMPANY_CONTEXT_CHANGED_EVENT, load);
    };
  }, []);

  const companies = context?.companies ?? [];
  const global = context?.global === true;
  const canSwitch = global || companies.length > 1;
  const value = context?.currentCompanyId ?? (global ? ALL : "");

  async function switchTo(next: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/company-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { currentCompanyId?: string | null; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not switch company.");
        return;
      }
      window.dispatchEvent(new Event(COMPANY_CONTEXT_CHANGED_EVENT));
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!context || !canSwitch) {
    const label =
      companies.find((c) => c.id === context?.currentCompanyId)?.name ?? fallbackLabel ?? "Not set";
    return (
      <p
        className={cn("mt-0.5 truncate text-[11px] font-semibold text-zinc-800 dark:text-zinc-100", className)}
        title={label}
      >
        {label}
      </p>
    );
  }

  return (
    <div className={className}>
      <label className="sr-only" htmlFor="company-switcher">
        Current company
      </label>
      <select
        id="company-switcher"
        value={value}
        disabled={saving}
        onChange={(e) => void switchTo(e.target.value)}
        className="mt-0.5 w-full min-w-0 truncate rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-zinc-800 outline-none focus:border-orange-500/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {global ? <option value={ALL}>All companies</option> : null}
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.isDefault ? " (default)" : ""}
          </option>
        ))}
      </select>
      {error ? <p className="mt-0.5 text-[10px] text-rose-600 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}
