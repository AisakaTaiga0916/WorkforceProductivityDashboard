"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  DEFAULT_REQUEST_TYPE,
  REQUEST_TYPES,
  type RequestTypeId,
} from "@/modules/requests/request-types";
import { visibleIntakeRequestTypes } from "@/modules/platform/settings/intake-request-type-visibility";

type RequestTypeSelectionProps = {
  value?: RequestTypeId;
  onChange?: (id: RequestTypeId) => void;
  onContinue: (id: RequestTypeId) => void;
  disabled?: boolean;
  /** Request types that cannot be continued (e.g. Issue/Concern when intake-locked). */
  disabledTypeIds?: readonly RequestTypeId[];
  /** Fallback hint when a locked type has no entry in `disabledTypeHints`. */
  disabledTypeHint?: string | null;
  /** Per-type lock messages. */
  disabledTypeHints?: Partial<Record<RequestTypeId, string>>;
  /** SuperAdmin-hidden types — omitted from the list entirely. */
  hiddenTypeIds?: readonly RequestTypeId[];
};

export function RequestTypeSelection({
  value = DEFAULT_REQUEST_TYPE,
  onChange,
  onContinue,
  disabled = false,
  disabledTypeIds = [],
  disabledTypeHint = null,
  disabledTypeHints = {},
  hiddenTypeIds = [],
}: RequestTypeSelectionProps) {
  const disabledSet = new Set(disabledTypeIds);
  const selectableTypes = visibleIntakeRequestTypes([...hiddenTypeIds]);
  const selectedLocked = disabledSet.has(value);
  const effectiveValue = selectableTypes.some((t) => t.id === value)
    ? value
    : (selectableTypes[0]?.id ?? DEFAULT_REQUEST_TYPE);

  if (selectableTypes.length === 0) {
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
        No request types are available right now. Contact your administrator.
      </div>
    );
  }

  return (
    <div className="space-y-5 pr-8">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-orange-600 dark:text-orange-400">
          Step 1 of 2
        </p>
        <h2 className="mt-1 text-lg font-bold text-zinc-950 dark:text-zinc-100">
          What type of request are you creating?
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Choose one option to continue. ISSUE/CONCERN TICKET is selected by default.
        </p>
      </div>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="sr-only">Request type</legend>
        {selectableTypes.map((type) => {
          const selected = effectiveValue === type.id;
          const typeLocked = disabledSet.has(type.id);
          const hint = disabledTypeHints[type.id] ?? (typeLocked ? disabledTypeHint : null);
          return (
            <label
              key={type.id}
              aria-disabled={typeLocked || undefined}
              className={cn(
                "flex scroll-mt-4 items-start gap-3 rounded-xl border px-3.5 py-3 transition",
                typeLocked
                  ? "cursor-not-allowed opacity-45"
                  : "cursor-pointer",
                selected && !typeLocked
                  ? "border-orange-500/60 bg-orange-500/10 ring-1 ring-orange-500/30"
                  : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950/50",
                !typeLocked &&
                  !selected &&
                  "hover:border-orange-300/60 dark:hover:border-orange-800/60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                  selected && !typeLocked
                    ? "border-orange-500 bg-orange-600 text-white"
                    : "border-zinc-300 dark:border-zinc-600",
                )}
                aria-hidden
              >
                {selected && !typeLocked ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <input
                  type="radio"
                  name="requestType"
                  value={type.id}
                  checked={selected && !typeLocked}
                  disabled={typeLocked}
                  onChange={() => {
                    if (typeLocked) return;
                    onChange?.(type.id);
                  }}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {type.label}
                  {typeLocked ? (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Unavailable
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-400">
                  {type.description}
                </span>
                {typeLocked && hint ? (
                  <span className="mt-1.5 block text-xs text-amber-800 dark:text-amber-200/90">
                    {hint}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button
          type="button"
          disabled={disabled || disabledSet.has(effectiveValue)}
          onClick={() => onContinue(effectiveValue)}
          className="bg-orange-600 text-white hover:bg-orange-500"
        >
          {selectedLocked ? "Choose another request type" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
