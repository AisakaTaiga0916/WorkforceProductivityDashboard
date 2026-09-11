"use client";

import { Button } from "@/components/ui/button";
import {
  formatOrgChartLevelLabel,
  orgChartOptionLabel,
} from "./org-chart-layers";

export type BulkReportsToOptions = {
  managersByLayer: Array<
    [number, { id: string; personName: string; personRole: string | null; companyName: string | null }[]]
  >;
  eitherOrParentOptions: Array<{ value: string; label: string }>;
  outlineById?: Map<string, string>;
};

export function OrgChartBulkReportsBar({
  selectedCount,
  movableCount,
  value,
  onChange,
  onApply,
  busy,
  options,
  className = "",
  onLockSelected,
  onUnlockSelected,
  lockedSelectedCount = 0,
}: {
  selectedCount: number;
  movableCount: number;
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
  busy: boolean;
  options: BulkReportsToOptions;
  className?: string;
  onLockSelected?: () => void;
  onUnlockSelected?: () => void;
  lockedSelectedCount?: number;
}) {
  const applyCount = movableCount || selectedCount;
  const outlineById = options.outlineById;
  const unlockedSelectedCount = Math.max(0, selectedCount - lockedSelectedCount);
  return (
    <div className={`flex flex-wrap items-end gap-2 ${className}`}>
      <label className="min-w-[12rem] flex-1">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-orange-800/90 dark:text-orange-200/90">
          Reports to · {selectedCount} selected
          {movableCount < selectedCount ? ` (${movableCount} unlocked)` : ""}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy || movableCount === 0}
          className="h-9 w-full rounded-lg border border-orange-300/80 bg-white px-2 text-xs font-medium text-zinc-900 outline-none focus:border-orange-500/60 disabled:opacity-50 dark:border-orange-800 dark:bg-zinc-950 dark:text-zinc-100"
        >
          <option value="">— Top level ({formatOrgChartLevelLabel(1)}) —</option>
          {options.eitherOrParentOptions.length > 0 ? (
            <optgroup label="Shared either / or">
              {options.eitherOrParentOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {options.managersByLayer.map(([level, people]) => (
            <optgroup key={`bulk-level-${level}`} label={formatOrgChartLevelLabel(level)}>
              {people.map((n) => (
                <option key={n.id} value={n.id}>
                  {orgChartOptionLabel(n, outlineById?.get(n.id) ?? "?", outlineById)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <Button
        type="button"
        className="h-9 shrink-0 rounded-lg px-4 text-xs font-semibold"
        disabled={busy || movableCount === 0}
        onClick={onApply}
      >
        Apply to {applyCount}
      </Button>
      {onLockSelected ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0 rounded-lg px-3 text-xs font-semibold"
          disabled={busy || unlockedSelectedCount === 0}
          title="Lock selected members to their current managers"
          onClick={onLockSelected}
        >
          Lock {unlockedSelectedCount > 0 ? unlockedSelectedCount : selectedCount}
        </Button>
      ) : null}
      {onUnlockSelected ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0 rounded-lg border-amber-300 px-3 text-xs font-semibold text-amber-900 dark:border-amber-700 dark:text-amber-200"
          disabled={busy || lockedSelectedCount === 0}
          title="Unlock selected members"
          onClick={onUnlockSelected}
        >
          Unlock {lockedSelectedCount > 0 ? lockedSelectedCount : selectedCount}
        </Button>
      ) : null}
    </div>
  );
}
