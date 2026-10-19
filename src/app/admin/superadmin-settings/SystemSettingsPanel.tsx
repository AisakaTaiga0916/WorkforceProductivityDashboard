"use client";

import type { EscalationTrigger } from "@prisma/client/primary";
import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Map as MapIcon, RotateCcw, Save, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { SYSTEM_MODULES_CHANGED_EVENT } from "@/modules/platform/settings/system-modules-client";
import {
  DEFAULT_SYSTEM_MODULE_VISIBILITY,
  SYSTEM_MODULE_BLURBS,
  SYSTEM_MODULE_IDS,
  SYSTEM_MODULE_LABELS,
  type SystemModuleId,
  type SystemModuleVisibility,
} from "@/modules/platform/settings/system-modules";
import { EscalationTriggersClient } from "../escalation-triggers/ui";
import { TaskSchedulePanel } from "./TaskSchedulePanel";
import { TaskVerificationPanel } from "./TaskVerificationPanel";

const MODULE_ICONS: Record<SystemModuleId, typeof Ticket> = {
  requests: Ticket,
  tasks: CheckSquare,
  work_plans: MapIcon,
};

function sameModules(a: SystemModuleVisibility, b: SystemModuleVisibility): boolean {
  return SYSTEM_MODULE_IDS.every((id) => a[id] === b[id]);
}

type Trigger = Pick<
  EscalationTrigger,
  "id" | "priority" | "enabled" | "notifyAdmin" | "notifyTarget"
>;

export function SystemSettingsPanel({ initialTriggers }: { initialTriggers: Trigger[] }) {
  const [modules, setModules] = useState<SystemModuleVisibility>(DEFAULT_SYSTEM_MODULE_VISIBILITY);
  const [saved, setSaved] = useState<SystemModuleVisibility>(DEFAULT_SYSTEM_MODULE_VISIBILITY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = !sameModules(modules, saved);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system-settings/modules", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        modules?: SystemModuleVisibility;
        error?: string;
      };
      if (!res.ok || !data.modules) {
        setError(data.error ?? "Could not load module visibility.");
        return;
      }
      setModules(data.modules);
      setSaved(data.modules);
    } catch {
      setError("Could not load module visibility.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: SystemModuleVisibility) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/system-settings/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        modules?: SystemModuleVisibility;
        error?: string;
      };
      if (!res.ok || !data.modules) {
        setError(data.error ?? "Could not save module visibility.");
        return;
      }
      setModules(data.modules);
      setSaved(data.modules);
      setMessage("Module visibility saved. Navigation updates for everyone on their next load.");
      window.dispatchEvent(new Event(SYSTEM_MODULES_CHANGED_EVENT));
    } catch {
      setError("Could not save module visibility.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
              System Settings
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Module visibility
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              Turn modules on or off for the whole tenant. Turned-off modules disappear from
              navigation and their pages show a notice. Requires the <code>settings.update</code>{" "}
              permission.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || loading || sameModules(saved, DEFAULT_SYSTEM_MODULE_VISIBILITY)}
              onClick={() => void save(DEFAULT_SYSTEM_MODULE_VISIBILITY)}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              All on
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || loading || !dirty}
              onClick={() => void save(modules)}
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
        ) : (
          <ul className="mt-5 space-y-2">
            {SYSTEM_MODULE_IDS.map((id) => {
              const Icon = MODULE_ICONS[id];
              const on = modules[id];
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border",
                        on
                          ? "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                          : "border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-600",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          on ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 dark:text-zinc-600",
                        )}
                      >
                        {SYSTEM_MODULE_LABELS[id]}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {SYSTEM_MODULE_BLURBS[id]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {([false, true] as const).map((value) => (
                      <button
                        key={String(value)}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setModules((prev) => ({ ...prev, [id]: value }));
                          setMessage(null);
                        }}
                        className={cn(
                          "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                          on === value
                            ? value
                              ? "bg-orange-600 text-white"
                              : "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                            : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900",
                        )}
                      >
                        {value ? "On" : "Off"}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
          System Settings
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Priority alerts
        </h2>
        <p className="mt-1 mb-5 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Escalation triggers per request priority: turn each on or off and choose who is notified.
        </p>
        <EscalationTriggersClient initialTriggers={initialTriggers} embedded />
      </section>

      <TaskVerificationPanel />

      <TaskSchedulePanel />
    </div>
  );
}
