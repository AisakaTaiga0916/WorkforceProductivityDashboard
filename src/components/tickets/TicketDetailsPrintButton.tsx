"use client";

import { Printer } from "lucide-react";

import { openTicketDetailsPrint, type TicketPrintModel } from "@/modules/requests/ticket-details-print";

type Props = {
  model: TicketPrintModel;
  className?: string;
};

export function TicketDetailsPrintButton({ model, className }: Props) {
  return (
    <button
      type="button"
      onClick={() => openTicketDetailsPrint(model)}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-700 transition hover:border-orange-400 hover:text-orange-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-orange-500/60 dark:hover:text-orange-300"
      }
      title="Print ticket details (half bond, portrait)"
    >
      <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Print
    </button>
  );
}
