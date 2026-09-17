"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { TaskVerificationSettings } from "@/lib/task-verification-settings";

export function TaskVerificationPanel() {
  const [enabled, setEnabled] = useState(true);
  const [savedEnabled, setSavedEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = enabled !== savedEnabled;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/task-verification-settings", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as TaskVerificationSettings & {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not load task verification settings.");
        return;
      }
      const next = data.enabled !== false;
      setEnabled(next);
      setSavedEnabled(next);
    } catch {
      setError("Could not load task verification settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/task-verification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = (await res.json().catch(() => ({}))) as TaskVerificationSettings & {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not save task verification settings.");
        return;
      }
      const next = data.enabled !== false;
      setEnabled(next);
      setSavedEnabled(next);
      setMessage(
        next
          ? "Task verification is on. Completing work waits for department-head approval."
          : "Task verification is off. Completing work goes straight to Done.",
      );
      window.dispatchEvent(new Event("task-verification-settings-changed"));
    } catch {
      setError("Could not save task verification settings.");
    } finally {
      setBusy(false);
    }
  }

  async function resetDefaults() {
    setEnabled(true);
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
            Task verification
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            When on, assignees submit completed work for department-head verification before it
            counts as Done. Turn off to skip that gate platform-wide.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || loading || enabled}
            onClick={() => void resetDefaults()}
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Default (on)
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || loading || !dirty}
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
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setEnabled((prev) => !prev);
            setMessage(null);
          }}
          className={cn(
            "mt-5 flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition",
            enabled
              ? "border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-950/20"
              : "border-zinc-200 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/40",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
              enabled
                ? "bg-emerald-600 text-white"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
            )}
          >
            {enabled ? (
              <ShieldCheck className="size-4" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Require verification before Done
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                  enabled
                    ? "bg-emerald-600/15 text-emerald-800 dark:text-emerald-200"
                    : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
                )}
              >
                {enabled ? "On" : "Off"}
              </span>
            </span>
            <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">
              {enabled
                ? "Checklist / task completion waits in For verification until a head approves."
                : "Completion marks work Done immediately — no pending verification lane."}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}
