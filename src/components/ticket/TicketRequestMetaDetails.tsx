"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type TicketRequestMetaDetailsProps = {
  preparedByLabel: string;
  contactName: string;
  email: string;
  company: string;
  requestingCompany?: string | null;
  branch: string;
  sendRequestTo: string;
  sendRequestToLabel?: "Send request to (company)" | "Send request to (department)";
  departmentLabel: string;
  department: string;
  requestType: string;
  proceduralStatus?: string | null;
};

function MetaLine({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
      {label}:{" "}
      <span className={cn("normal-case tracking-normal text-zinc-300", valueClassName)}>{value}</span>
    </p>
  );
}

export function TicketRequestMetaDetails({
  preparedByLabel,
  contactName,
  email,
  company,
  requestingCompany,
  branch,
  sendRequestTo,
  sendRequestToLabel = "Send request to (department)",
  departmentLabel,
  department,
  requestType,
  proceduralStatus,
}: TicketRequestMetaDetailsProps) {
  const [extended, setExtended] = useState(false);

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="flex items-start justify-between gap-3 sm:hidden">
        {!extended ? (
          <div className="min-w-0">
            <MetaLine label="Request type" value={requestType} />
            {proceduralStatus ? (
              <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-amber-400/90">
                Procedural status:{" "}
                <span className="normal-case tracking-normal text-amber-200">{proceduralStatus}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <span className="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Full details
          </span>
        )}
        <button
          type="button"
          onClick={() => setExtended((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 hover:bg-black/40"
          aria-expanded={extended}
        >
          {extended ? "Hide details" : "Extended view"}
          <ChevronDown className={cn("size-3.5 transition", extended && "rotate-180")} aria-hidden />
        </button>
      </div>

      <div
        className={cn(
          "mt-3 grid grid-cols-1 gap-4 sm:mt-0 sm:grid-cols-2 sm:gap-6",
          extended ? "grid" : "hidden sm:grid",
        )}
      >
        <div className="min-w-0 space-y-1">
          <MetaLine label={preparedByLabel} value={contactName} valueClassName="break-words" />
          <MetaLine label="Email" value={email} valueClassName="break-all" />
          <MetaLine label="Company" value={company} />
          {requestingCompany?.trim() ? (
            <MetaLine label="Requesting company" value={requestingCompany.trim()} />
          ) : null}
          <MetaLine label="Branch" value={branch} />
        </div>
        <div className="min-w-0 space-y-1">
          <MetaLine label={departmentLabel} value={department} />
          <MetaLine label={sendRequestToLabel} value={sendRequestTo} />
          <MetaLine label="Request type" value={requestType} />
          {proceduralStatus ? (
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-amber-400/90">
              Procedural status:{" "}
              <span className="normal-case tracking-normal text-amber-200">{proceduralStatus}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
