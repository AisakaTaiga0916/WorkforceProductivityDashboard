"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { TicketStatus } from "@prisma/client/primary";
import {
  DEFAULT_REQUEST_BOARD_COLUMNS,
  type RequestBoardColumnDto,
} from "@/modules/requests/request-board-columns-shared";
import { formatTicketStatusLabel } from "@/modules/requests/ticket-status-label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Only the seeded default boards are offered as built-in maps. */
const DEFAULT_MAP_STATUSES: TicketStatus[] = DEFAULT_REQUEST_BOARD_COLUMNS.map(
  (c) => c.mappedStatus,
);

const CREATE_NEW_MAPPING = "__create_new__";

/** Pipeline status written for custom maps (ticket.status enum still required). */
const CUSTOM_MAP_PIPELINE_STATUS: TicketStatus = "IN_PROGRESS";

type MappingOption = {
  value: string;
  label: string;
  mappedStatus: TicketStatus;
  mappingLabel: string | null;
};

type Props = {
  columns: RequestBoardColumnDto[];
  canManage: boolean;
  onColumnsChange?: (columns: RequestBoardColumnDto[]) => void;
};

export function RequestBoardColumnManager({
  columns: initialColumns,
  canManage,
  onColumnsChange,
}: Props) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mappingChoice, setMappingChoice] = useState<string>(CREATE_NEW_MAPPING);
  const [customMappingName, setCustomMappingName] = useState("");

  const savedCustomMappings = useMemo(() => {
    const seen = new Set<string>();
    const options: MappingOption[] = [];
    for (const col of columns) {
      const label = (col.mappingLabel ?? col.name)?.trim();
      if (!col.mappingLabel?.trim()) continue;
      const key = `custom::${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        value: key,
        label,
        mappedStatus: CUSTOM_MAP_PIPELINE_STATUS,
        mappingLabel: label,
      });
    }
    return options;
  }, [columns]);

  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setMappingChoice(CREATE_NEW_MAPPING);
      setCustomMappingName("");
    }
  }, [open]);

  if (!canManage) return null;

  async function refreshFromServer(next?: RequestBoardColumnDto[]) {
    if (next) {
      setColumns(next);
      onColumnsChange?.(next);
    } else {
      const res = await fetch("/api/request-board/columns", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { columns?: RequestBoardColumnDto[] };
      if (Array.isArray(data.columns)) {
        setColumns(data.columns);
        onColumnsChange?.(data.columns);
      }
    }
    router.refresh();
  }

  function resolvePayload(): {
    name: string;
    mappedStatus: TicketStatus;
    mappingLabel: string | null;
  } | null {
    if (mappingChoice === CREATE_NEW_MAPPING) {
      const label = customMappingName.trim();
      if (!label) {
        setError("Enter a mapping name.");
        return null;
      }
      return {
        name: label,
        mappedStatus: CUSTOM_MAP_PIPELINE_STATUS,
        mappingLabel: label,
      };
    }

    const saved = savedCustomMappings.find((o) => o.value === mappingChoice);
    if (saved && saved.mappingLabel) {
      return {
        name: saved.mappingLabel,
        mappedStatus: CUSTOM_MAP_PIPELINE_STATUS,
        mappingLabel: saved.mappingLabel,
      };
    }

    if (DEFAULT_MAP_STATUSES.includes(mappingChoice as TicketStatus)) {
      const status = mappingChoice as TicketStatus;
      return {
        name: formatTicketStatusLabel(status),
        mappedStatus: status,
        mappingLabel: null,
      };
    }

    setError("Choose a valid mapping.");
    return null;
  }

  async function addColumn() {
    const mapping = resolvePayload();
    if (!mapping) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/request-board/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mapping.name,
          mappedStatus: mapping.mappedStatus,
          mappingLabel: mapping.mappingLabel,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        column?: RequestBoardColumnDto;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not add board.");
        return;
      }
      setOpen(false);
      await refreshFromServer();
    } finally {
      setBusy(false);
    }
  }

  const creatingNew = mappingChoice === CREATE_NEW_MAPPING;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-orange-300/80 bg-orange-50 text-orange-700 transition hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-950/40 dark:text-orange-200 dark:hover:bg-orange-950/70"
        aria-label="Add board"
        title="Add board"
      >
        <Plus className="size-5" strokeWidth={2.5} aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5">
            <DialogTitle className="text-base">Add board</DialogTitle>
            <DialogDescription className="text-xs text-zinc-600 dark:text-zinc-400">
              The mapping is the board name and the status shown on cards in that lane.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4 px-4 py-4 sm:px-5"
            onSubmit={(e) => {
              e.preventDefault();
              void addColumn();
            }}
          >
            {error ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-950 dark:text-amber-100">
                {error}
              </p>
            ) : null}

            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Mapping
              <select
                value={mappingChoice}
                onChange={(e) => setMappingChoice(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <optgroup label="Default maps">
                  {DEFAULT_MAP_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {formatTicketStatusLabel(s)}
                    </option>
                  ))}
                </optgroup>
                {savedCustomMappings.length > 0 ? (
                  <optgroup label="Custom maps">
                    {savedCustomMappings.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <option value={CREATE_NEW_MAPPING}>+ Create new mapping…</option>
              </select>
            </label>

            {creatingNew ? (
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Mapping name
                <input
                  value={customMappingName}
                  onChange={(e) => setCustomMappingName(e.target.value)}
                  placeholder="e.g. On Delivery"
                  maxLength={80}
                  autoFocus
                  className="mt-1.5 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <span className="mt-1.5 block text-[11px] font-normal text-zinc-600 dark:text-zinc-400">
                  This becomes the board title and the status on cards in the lane.
                </span>
              </label>
            ) : (
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                Board will be named “
                {mappingChoice.startsWith("custom::")
                  ? savedCustomMappings.find((o) => o.value === mappingChoice)?.label
                  : formatTicketStatusLabel(mappingChoice as TicketStatus)}
                ”.
              </p>
            )}

            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
              Current boards: {columns.map((c) => c.name).join(" · ") || "none"}
            </p>

            <div className="flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-10 items-center gap-1.5 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden />
                {busy ? "Adding…" : "Add board"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
