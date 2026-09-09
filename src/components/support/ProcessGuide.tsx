import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  GitBranch,
  HelpCircle,
  Layers,
  RefreshCw,
  Send,
  Shield,
  Users,
  Wallet,
} from "lucide-react";
import { REQUEST_TYPES } from "@/lib/request-types";
import { BRAND_TITLE } from "@/lib/brand";

const LIFECYCLE = [
  {
    title: "Create",
    body: "Pick a request type, fill the form, attach documents, and send to a company.",
    Icon: Send,
  },
  {
    title: "Log & route",
    body: "System assigns a ticket ID, OPEN status, timestamps, and company queue.",
    Icon: ClipboardList,
  },
  {
    title: "Assign",
    body: "Board assignment or procedural seats put the right person on the card.",
    Icon: Users,
  },
  {
    title: "Work & approve",
    body: "Messages, activity trail, and role-based Done steps move the request forward.",
    Icon: Layers,
  },
  {
    title: "Confirm",
    body: "Resolution goes to For confirmation so the requestor can accept or reopen.",
    Icon: BadgeCheck,
  },
  {
    title: "Close & measure",
    body: "Closure locks the record; optional feedback feeds KPI and efficiency views.",
    Icon: CheckCircle2,
  },
] as const;

const FLOW_STEPS: Array<{
  id: string;
  label: string;
  kind?: "decision" | "loop";
  yes?: string;
  no?: string;
}> = [
  { id: "start", label: "Start" },
  { id: "submit", label: "Submit request" },
  { id: "log", label: "Log ticket & generate ID" },
  { id: "route", label: "Categorize / company route" },
  { id: "assign", label: "Assign on board or procedural seat" },
  { id: "review", label: "Assignee reviews" },
  {
    id: "info",
    label: "Need more info?",
    kind: "decision",
    yes: "Request info → return to work",
    no: "Continue",
  },
  { id: "work", label: "Work on issue / advance approvals" },
  {
    id: "escalate",
    label: "Escalation needed?",
    kind: "decision",
    yes: "Escalate (functional or hierarchical)",
    no: "Continue",
  },
  { id: "resolve", label: "Resolve → For confirmation" },
  {
    id: "confirm",
    label: "Requestor confirms?",
    kind: "decision",
    yes: "Close ticket",
    no: "Reopen → back to work",
  },
  { id: "end", label: "End" },
];

const APPROVAL_LANES = [
  {
    title: "Issue / Concern",
    acronym: "TICKET",
    tone: "from-orange-500/20 to-transparent",
    steps: ["Create", "Assign", "Investigate", "Resolve", "Confirm", "Close"],
    note: "Classic helpdesk path with SLA clocks and customer confirmation.",
  },
  {
    title: "Request for Payment",
    acronym: "R.F.P.",
    tone: "from-sky-500/20 to-transparent",
    steps: ["Noted By", "Approved By", "Prepared by Bookkeeper", "Approved By Accounting", "Green-lit"],
    note: "Procedural chain must finish before For confirmation. Mode of payment can defer to Bookkeeper / Accounting.",
  },
  {
    title: "Item Requisition",
    acronym: "R.S.",
    tone: "from-emerald-500/20 to-transparent",
    steps: ["Canvass", "Approve pricing", "Advance seats", "Green-lit"],
    note: "Canvassed By sets pricing; approvers complete sequential Done steps.",
  },
  {
    title: "Fund Transfer",
    acronym: "F.T.R.",
    tone: "from-teal-500/20 to-transparent",
    steps: ["Noted", "Approved", "Release seats", "Green-lit"],
    note: "Company-scoped transfer workflow with sequential procedural assignees.",
  },
  {
    title: "Job Order",
    acronym: "J.O.",
    tone: "from-amber-500/20 to-transparent",
    steps: ["Set approvers", "Job Done", "Approved By", "For confirmation", "Closed"],
    note: "Create the Job Order and set approvers. After Job Done, the final Approved By (recommended as HR Approver) sends the request for confirmation.",
  },
  {
    title: "Authority to Conduct Activity",
    acronym: "A.C.A.",
    tone: "from-rose-500/15 to-transparent",
    steps: [
      "Recommended By",
      "Validated By (Finance)",
      "AP 1–3 or ExeCom table",
      "Green-lit",
    ],
    note: "Authority Matrix drives RA level and AP / 4 ExeComs / All ExeCom (5 seats). ExeCom seats appear on each listed person’s board; feedback required on ExeCom Done.",
  },
] as const;

const REQUEST_ICONS: Record<string, typeof FileText> = {
  ISSUE_CONCERN_TICKET: HelpCircle,
  REQUEST_FOR_PAYMENT: Wallet,
  ITEM_REQUISITION_SLIP: ClipboardList,
  FUND_TRANSFER_REQUEST: Building2,
  JOB_ORDER: GitBranch,
  AUTHORITY_TO_CONDUCT_ACTIVITY: Shield,
};

function FlowNode({
  label,
  kind,
  yes,
  no,
}: {
  label: string;
  kind?: "decision" | "loop";
  yes?: string;
  no?: string;
}) {
  const isDecision = kind === "decision";
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-2">
      <div
        className={[
          "w-full rounded-2xl border px-4 py-3 text-center text-sm font-semibold tracking-tight",
          isDecision
            ? "border-[#ff6b00]/40 bg-[#ff6b00]/10 text-[#ffb070]"
            : "border-white/10 bg-white/[0.04] text-zinc-100",
        ].join(" ")}
      >
        {label}
      </div>
      {isDecision && (yes || no) ? (
        <div className="grid w-full gap-2 sm:grid-cols-2">
          {yes ? (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-left text-[11px] leading-snug text-emerald-100/90">
              <span className="font-bold uppercase tracking-[0.14em] text-emerald-300">Yes</span>
              <p className="mt-1 text-emerald-50/80">{yes}</p>
            </div>
          ) : null}
          {no ? (
            <div className="rounded-xl border border-zinc-500/30 bg-zinc-500/10 px-3 py-2 text-left text-[11px] leading-snug text-zinc-200">
              <span className="font-bold uppercase tracking-[0.14em] text-zinc-400">No</span>
              <p className="mt-1 text-zinc-300/90">{no}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProcessGuide() {
  return (
    <div className="relative min-h-full overflow-x-clip bg-[#070707] text-[#e8e8e8]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,107,0,0.12),transparent_42%),radial-gradient(circle_at_88%_18%,rgba(255,107,0,0.05),transparent_40%)]"
      />

      <div className="relative mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6 sm:py-14">
        <header className="space-y-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#ff6b00]">
            {BRAND_TITLE} · Support
          </p>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Process & flow
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            How requests move from intake through assignment, procedural approvals, confirmation,
            and closure — including Issue/Concern, RFP, R.S., FTR, Job Order, and ACA.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href="/signin"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#e66000] to-[#ff7a1a] px-4 py-2.5 text-sm font-semibold text-white transition hover:from-[#ff7a1a] hover:to-[#e66000]"
            >
              Sign in
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/tickets/new"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.06]"
            >
              Submit a request
            </Link>
          </div>
        </header>

        <section className="space-y-5">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff6b00]">
              Request types
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Choose the form that matches the work. Each type has its own fields and approval path.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {REQUEST_TYPES.map((type) => {
              const Icon = REQUEST_ICONS[type.id] ?? FileText;
              return (
                <article
                  key={type.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#ff6b00]/35 hover:bg-[#ff6b00]/[0.04]"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#ff6b00]/25 bg-[#ff6b00]/10 text-[#ff6b00]">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff6b00]">
                        {type.acronym}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold leading-snug text-white">
                        {type.label}
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{type.description}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff6b00]">
              End-to-end lifecycle
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Shared stages across request types. Procedural forms insert approval seats before
              green-light.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LIFECYCLE.map((step, index) => (
              <article
                key={step.title}
                className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full border border-[#ff6b00]/35 bg-[#ff6b00]/15 text-xs font-bold text-[#ffb070]">
                    {index + 1}
                  </span>
                  <step.Icon className="size-5 text-[#ff6b00]" aria-hidden />
                  <h3 className="text-sm font-semibold text-white">{step.title}</h3>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff6b00]">
              Visual flowchart
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Core path for Issue/Concern and the shared confirmation loop. Procedural forms add
              seats inside “Work / advance approvals.”
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/40 p-5 sm:p-8">
            <div className="flex flex-col items-center gap-1">
              {FLOW_STEPS.map((step, index) => (
                <div key={step.id} className="flex w-full flex-col items-center">
                  <FlowNode label={step.label} kind={step.kind} yes={step.yes} no={step.no} />
                  {index < FLOW_STEPS.length - 1 ? (
                    <div className="flex flex-col items-center py-1 text-[#ff6b00]/70" aria-hidden>
                      <ArrowDown className="size-4" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[11px] text-zinc-400">
              <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-[#ff6b00]" aria-hidden />
              Reopen returns the ticket to active work and increments reopen analytics. Closure is
              final for the record; feedback can still be collected for KPIs.
            </div>
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff6b00]">
              Approval lanes
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              How each request type reaches green-lit before confirmation.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {APPROVAL_LANES.map((lane) => (
              <article
                key={lane.acronym}
                className={`rounded-2xl border border-white/10 bg-gradient-to-br ${lane.tone} p-4 sm:p-5`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">{lane.title}</h3>
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff6b00]">
                    {lane.acronym}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{lane.note}</p>
                <ol className="mt-4 flex flex-wrap items-center gap-2">
                  {lane.steps.map((step, i) => (
                    <li key={step} className="flex items-center gap-2">
                      <span className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] font-medium text-zinc-200">
                        {step}
                      </span>
                      {i < lane.steps.length - 1 ? (
                        <ArrowRight className="size-3 text-[#ff6b00]/70" aria-hidden />
                      ) : null}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-[#ff6b00]/25 bg-[#ff6b00]/[0.06] p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-white">Need help signing in?</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Staff use HRIS username and password. Customers can use Google when configured. Password
            resets are requested from Sign in and reviewed by a SuperAdmin.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/signin"
              className="inline-flex items-center rounded-xl bg-[#ff6b00] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#ff7a1a]"
            >
              Go to sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/5"
            >
              Create account
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
