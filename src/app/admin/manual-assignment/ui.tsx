"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  Building2,
  ChevronLeft,
  Folder,
  FolderOpen,
  GripVertical,
  Layers,
  UserPlus,
  X,
} from "lucide-react";
import { OrchestrationQueueNav } from "@/components/OrchestrationQueueNav";
import { AssigneeColorHighlight } from "@/components/ticket/AssigneeColorHighlight";
import { AssigneeInitialsBadge } from "@/components/ticket/AssigneeInitialsBadge";
import { authInputClass, authLabelClass } from "@/components/auth/AuthShell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { PointerDragGhostLayer, usePointerColumnDrag } from "@/lib/pointer-column-drag";
import { BRAND_TITLE } from "@/lib/brand";
import { extractPaymentBoardPreview } from "@/lib/request-for-payment";
import { parseItemRequisitionDescription } from "@/lib/item-requisition";
import { extractFundTransferPreview } from "@/lib/fund-transfer-request";
import { extractJobOrderPreview } from "@/lib/job-order";
import { requestTypeAcronym, requestTypeLabel } from "@/lib/request-types";
import {
  readRequestKanbanFlowMode,
  writeRequestKanbanFlowMode,
  type RequestKanbanFlowMode,
} from "@/lib/request-kanban-flow";
import {
  cleanIssuePreview,
  extractDepartmentFromDescription,
  formatRelativeAgo,
  priorityPillClass,
} from "@/lib/ticket-board-formatters";

type TicketCard = {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  priority: string;
  /** Pipeline status — ESCALATED = Transfer pending (red outline in unassigned pool). */
  status?: string;
  updatedAt: string;
  /** Intake request type id — same as ticket board (ISSUE_CONCERN_TICKET, REQUEST_FOR_PAYMENT, …). */
  requestType?: string | null;
  sendToSectionId?: string | null;
  sendToSectionName?: string | null;
  requestorSectionId?: string | null;
  requestorSectionName?: string | null;
};

const ASSIGNMENT_UNSECTIONED = "__unsectioned__";
const ASSIGNMENT_UNCOMPANYED = "__uncompanyed__";
const ASSIGNMENT_SECTION_DROP_PREFIX = "__SECTION__:";
const ASSIGNMENT_COMPANY_DROP_PREFIX = "__COMPANY__:";
const ASSIGNMENT_USER_DROP_PREFIX = "__USER__:";

type PersonnelGroupMode = "company" | "section";

function flowModeToGroupMode(flow: RequestKanbanFlowMode): PersonnelGroupMode {
  return flow === "company" ? "company" : "section";
}

function groupModeToFlowMode(mode: PersonnelGroupMode): RequestKanbanFlowMode {
  return mode === "company" ? "company" : "department";
}

type FolderOption = {
  id: string;
  name: string;
  depth: number;
  agentCount: number;
  ticketCount: number;
};

/** Match ticket-board card title (RFP → in payment of + amount; IRS/FTR → purpose; otherwise cleaned description/title). */
function assignmentCardPreview(ticket: TicketCard): string {
  if (ticket.requestType === "REQUEST_FOR_PAYMENT") {
    const preview = extractPaymentBoardPreview(ticket.description);
    if (preview) return preview;
  }
  if (ticket.requestType === "ITEM_REQUISITION_SLIP") {
    const purpose = parseItemRequisitionDescription(ticket.description)?.purposeOfRequest?.trim();
    if (purpose) return purpose.slice(0, 120);
  }
  if (ticket.requestType === "FUND_TRANSFER_REQUEST") {
    const preview = extractFundTransferPreview(ticket.description);
    if (preview) return preview;
  }
  if (ticket.requestType === "JOB_ORDER") {
    const preview = extractJobOrderPreview(ticket.description);
    if (preview) return preview;
  }
  if (ticket.requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
    const nature = ticket.description.match(/^Nature of Request:\s*(.*)$/im)?.[1]?.trim();
    if (nature) return nature.slice(0, 120);
  }
  return cleanIssuePreview(ticket.description || ticket.title);
}

type PersonnelColumn = {
  agentId: string;
  name: string;
  role: string;
  teamLabel: string;
  companyId: string | null;
  sectionId: string | null;
  sectionName: string | null;
  assigneeColorKey?: string | null;
  cards: TicketCard[];
};

type RosterSection = { id: string; name: string; depth: number };

function personnelSectionKey(col: PersonnelColumn): string {
  return col.sectionId?.trim() || ASSIGNMENT_UNSECTIONED;
}

function personnelCompanyKey(col: PersonnelColumn): string {
  const id = col.companyId?.trim();
  if (id) return id;
  const label = col.teamLabel?.trim();
  if (label) return `label:${label.toLowerCase()}`;
  return ASSIGNMENT_UNCOMPANYED;
}

function personnelFolderKey(col: PersonnelColumn, mode: PersonnelGroupMode): string {
  return mode === "company" ? personnelCompanyKey(col) : personnelSectionKey(col);
}

function personnelRoleLabel(role: string): "Admin" | "Personnel" {
  return role === "Admin" ? "Admin" : "Personnel";
}

function sortPersonnelByRole(list: PersonnelColumn[]): PersonnelColumn[] {
  return [...list].sort((a, b) => {
    const roleCmp = personnelRoleLabel(a.role).localeCompare(personnelRoleLabel(b.role));
    if (roleCmp !== 0) return roleCmp;
    return a.name.localeCompare(b.name);
  });
}

function matchesAssignmentPersonnelSearch(col: PersonnelColumn, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    col.name.toLowerCase().includes(q) ||
    col.role.toLowerCase().includes(q) ||
    (col.teamLabel ?? "").toLowerCase().includes(q) ||
    (col.sectionName ?? "").toLowerCase().includes(q)
  );
}

function assignmentSectionDropTarget(sectionId: string): string {
  return `${ASSIGNMENT_SECTION_DROP_PREFIX}${sectionId}`;
}

function assignmentCompanyDropTarget(companyId: string): string {
  return `${ASSIGNMENT_COMPANY_DROP_PREFIX}${companyId}`;
}

function assignmentFolderDropTarget(folderId: string, mode: PersonnelGroupMode): string {
  return mode === "company"
    ? assignmentCompanyDropTarget(folderId)
    : assignmentSectionDropTarget(folderId);
}

function assignmentFolderIdFromTarget(
  target: string | null,
  mode: PersonnelGroupMode,
): string | null {
  if (!target) return null;
  if (mode === "company") {
    if (!target.startsWith(ASSIGNMENT_COMPANY_DROP_PREFIX)) return null;
    return target.slice(ASSIGNMENT_COMPANY_DROP_PREFIX.length);
  }
  if (!target.startsWith(ASSIGNMENT_SECTION_DROP_PREFIX)) return null;
  return target.slice(ASSIGNMENT_SECTION_DROP_PREFIX.length);
}

function assignmentUserDropTarget(agentId: string): string {
  return `${ASSIGNMENT_USER_DROP_PREFIX}${agentId}`;
}

function assignmentUserIdFromTarget(target: string | null): string | null {
  if (!target?.startsWith(ASSIGNMENT_USER_DROP_PREFIX)) return null;
  return target.slice(ASSIGNMENT_USER_DROP_PREFIX.length);
}

const personnelSearchInputClass = cn(authInputClass, "min-w-[12rem] py-1.5 text-xs sm:min-w-[14rem]");

function PersonnelGroupToggle({
  value,
  onChange,
}: {
  value: PersonnelGroupMode;
  onChange: (next: PersonnelGroupMode) => void;
}) {
  const options: Array<{ id: PersonnelGroupMode; label: string; icon: typeof Building2 }> = [
    { id: "company", label: "Company", icon: Building2 },
    { id: "section", label: "Departments", icon: Layers },
  ];
  return (
    <div
      role="tablist"
      aria-label="Group personnel by company or department"
      className="relative inline-flex rounded-lg border border-orange-300/80 bg-orange-100 p-0.5 text-xs font-semibold dark:border-orange-500/35 dark:bg-orange-950/40"
    >
      {options.map((option) => {
        const selected = value === option.id;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors",
              selected
                ? "text-white"
                : "text-orange-950/70 hover:text-orange-950 dark:text-orange-100/75 dark:hover:text-orange-50",
            )}
          >
            {selected ? (
              <motion.span
                layoutId="assign-personnel-group-toggle"
                className="absolute inset-0 -z-10 rounded-md bg-orange-600 shadow-sm"
                transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.7 }}
              />
            ) : null}
            <Icon className="relative size-3.5" aria-hidden />
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ManualAssignmentBoard({
  unassigned,
  personnel,
  rosterSections = [],
  departmentRosterSections = null,
  departmentAgentIds = null,
  notice,
}: {
  unassigned: TicketCard[];
  personnel: PersonnelColumn[];
  rosterSections?: RosterSection[];
  /** When set with departmentAgentIds, Departments view uses this section list. */
  departmentRosterSections?: RosterSection[] | null;
  /** Company ∩ designated department agents — used only in Departments view. */
  departmentAgentIds?: string[] | null;
  notice?: string | null;
}) {
  const [cards, setCards] = useState<TicketCard[]>(unassigned);
  const [columns, setColumns] = useState<PersonnelColumn[]>(personnel);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<PersonnelGroupMode>("section");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [dragRevealFolderId, setDragRevealFolderId] = useState<string | null>(null);
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState("");
  const [assignTicket, setAssignTicket] = useState<TicketCard | null>(null);
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetGroupMode, setSheetGroupMode] = useState<PersonnelGroupMode>("section");
  const [sheetFolderId, setSheetFolderId] = useState<string | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  const departmentAgentIdSet = useMemo(() => {
    // null = elevated / unlocked. [] = locked with no department people.
    if (departmentAgentIds == null) return null;
    return new Set(departmentAgentIds);
  }, [departmentAgentIds]);

  function rosterForMode(mode: PersonnelGroupMode): RosterSection[] {
    if (mode === "section" && departmentRosterSections && departmentRosterSections.length > 0) {
      return departmentRosterSections;
    }
    return rosterSections;
  }

  function columnsForMode(mode: PersonnelGroupMode, list: PersonnelColumn[]): PersonnelColumn[] {
    if (mode === "section" && departmentAgentIdSet) {
      return list.filter((col) => departmentAgentIdSet.has(col.agentId));
    }
    return list;
  }

  useEffect(() => {
    const next = flowModeToGroupMode(readRequestKanbanFlowMode());
    setGroupMode(next);
    setSheetGroupMode(next);
  }, []);

  useEffect(() => {
    queueMicrotask(() => setPortalReady(true));
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setCards(unassigned);
      setColumns(personnel);
    });
  }, [unassigned, personnel]);

  useEffect(() => {
    if (!assignTicket) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [assignTicket]);

  const modeColumns = useMemo(
    () => columnsForMode(groupMode, columns),
    [columns, groupMode, departmentAgentIdSet],
  );

  const filteredColumns = useMemo(
    () => modeColumns.filter((col) => matchesAssignmentPersonnelSearch(col, personnelSearchQuery)),
    [modeColumns, personnelSearchQuery],
  );
  const personnelSearchActive = Boolean(personnelSearchQuery.trim());
  const activeRosterSections = useMemo(() => rosterForMode(groupMode), [groupMode, rosterSections, departmentRosterSections]);

  async function assign(ticket: TicketCard, agentId: string) {
    setBusyTicketId(ticket.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/manual-assignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, agentId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not assign request.");
        return false;
      }
      setCards((prev) => prev.filter((t) => t.id !== ticket.id));
      setColumns((prev) =>
        prev.map((col) =>
          col.agentId === agentId
            ? {
                ...col,
                cards: [ticket, ...col.cards],
              }
            : col,
        ),
      );
      setAssignTicket(null);
      setSheetSearch("");
      setSheetFolderId(null);
      return true;
    } finally {
      setBusyTicketId(null);
    }
  }

  const laneDrag = usePointerColumnDrag<string>({
    onDrop: (ticketId, targetId) => {
      setDragRevealFolderId(null);
      const folderId = assignmentFolderIdFromTarget(targetId, groupMode);
      if (folderId) {
        setOpenFolderId(folderId);
        return;
      }
      const agentId = assignmentUserIdFromTarget(targetId);
      if (!agentId) return;
      const t = cards.find((x) => x.id === ticketId);
      if (t) void assign(t, agentId);
    },
    onHover: (targetId) => {
      const folderId = assignmentFolderIdFromTarget(targetId, groupMode);
      if (folderId) {
        setDragRevealFolderId((prev) => (prev === folderId ? prev : folderId));
        setOpenFolderId((prev) => (prev === folderId ? prev : folderId));
        return;
      }
      const agentId = assignmentUserIdFromTarget(targetId);
      if (agentId) {
        const col = modeColumns.find((c) => c.agentId === agentId);
        if (col) {
          const key = personnelFolderKey(col, groupMode);
          setDragRevealFolderId((prev) => (prev === key ? prev : key));
          setOpenFolderId((prev) => (prev === key ? prev : key));
          return;
        }
      }
      setDragRevealFolderId(null);
    },
    onDragEnd: () => setDragRevealFolderId(null),
    disabled: busyTicketId != null,
    activationDistance: 12,
  });

  const columnsByFolder = useMemo(() => {
    const grouped = new Map<string, PersonnelColumn[]>();
    for (const col of filteredColumns) {
      const key = personnelFolderKey(col, groupMode);
      const list = grouped.get(key);
      if (list) list.push(col);
      else grouped.set(key, [col]);
    }
    for (const [key, list] of grouped) {
      grouped.set(key, sortPersonnelByRole(list));
    }
    return grouped;
  }, [filteredColumns, groupMode]);

  const sectionOrderIndex = useMemo(
    () => new Map(activeRosterSections.map((s, i) => [s.id, i])),
    [activeRosterSections],
  );

  const folderOptions = useMemo(() => {
    const nameBySectionId = new Map(activeRosterSections.map((s) => [s.id, s.name]));
    const depthBySectionId = new Map(activeRosterSections.map((s) => [s.id, s.depth]));
    const options: FolderOption[] = [];
    for (const [id, cols] of columnsByFolder) {
      if (cols.length === 0) continue;
      const ticketCount = cols.reduce((sum, c) => sum + c.cards.length, 0);
      if (groupMode === "company") {
        if (id === ASSIGNMENT_UNCOMPANYED) {
          options.push({
            id,
            name: "No company",
            depth: 0,
            agentCount: cols.length,
            ticketCount,
          });
          continue;
        }
        options.push({
          id,
          name: cols[0]?.teamLabel?.trim() || "Unknown company",
          depth: 0,
          agentCount: cols.length,
          ticketCount,
        });
        continue;
      }
      if (id === ASSIGNMENT_UNSECTIONED) {
        options.push({
          id,
          name: "No department",
          depth: 0,
          agentCount: cols.length,
          ticketCount,
        });
        continue;
      }
      options.push({
        id,
        name: nameBySectionId.get(id) ?? cols[0]?.sectionName ?? "Unknown department",
        depth: depthBySectionId.get(id) ?? 0,
        agentCount: cols.length,
        ticketCount,
      });
    }
    return options.sort((a, b) => {
      const ungrouped =
        groupMode === "company" ? ASSIGNMENT_UNCOMPANYED : ASSIGNMENT_UNSECTIONED;
      if (a.id === ungrouped) return 1;
      if (b.id === ungrouped) return -1;
      if (groupMode === "section") {
        const orderA = sectionOrderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const orderB = sectionOrderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
      }
      return a.name.localeCompare(b.name);
    });
  }, [columnsByFolder, groupMode, activeRosterSections, sectionOrderIndex]);

  const sheetModeColumns = useMemo(
    () => columnsForMode(sheetGroupMode, columns),
    [columns, sheetGroupMode, departmentAgentIdSet],
  );
  const sheetActiveRosterSections = useMemo(
    () => rosterForMode(sheetGroupMode),
    [sheetGroupMode, rosterSections, departmentRosterSections],
  );

  const sheetFolderOptions = useMemo(() => {
    const grouped = new Map<string, PersonnelColumn[]>();
    for (const col of sheetModeColumns) {
      const key = personnelFolderKey(col, sheetGroupMode);
      const list = grouped.get(key);
      if (list) list.push(col);
      else grouped.set(key, [col]);
    }
    const nameBySectionId = new Map(sheetActiveRosterSections.map((s) => [s.id, s.name]));
    const options: Array<{ id: string; name: string; agentCount: number }> = [];
    for (const [id, cols] of grouped) {
      if (cols.length === 0) continue;
      if (sheetGroupMode === "company") {
        options.push({
          id,
          name:
            id === ASSIGNMENT_UNCOMPANYED
              ? "No company"
              : cols[0]?.teamLabel?.trim() || "Unknown company",
          agentCount: cols.length,
        });
        continue;
      }
      options.push({
        id,
        name:
          id === ASSIGNMENT_UNSECTIONED
            ? "No department"
            : nameBySectionId.get(id) ?? cols[0]?.sectionName ?? "Unknown department",
        agentCount: cols.length,
      });
    }
    return options.sort((a, b) => a.name.localeCompare(b.name));
  }, [sheetModeColumns, sheetActiveRosterSections, sheetGroupMode]);

  const activeFolderId =
    dragRevealFolderId ??
    (!laneDrag.draggingItemId && openFolderId !== null ? openFolderId : null);

  const openFolder = folderOptions.find((f) => f.id === openFolderId) ?? null;
  const openFolderColumns = openFolderId ? (columnsByFolder.get(openFolderId) ?? []) : [];

  function handleGroupModeChange(next: PersonnelGroupMode) {
    setGroupMode(next);
    writeRequestKanbanFlowMode(groupModeToFlowMode(next));
    setOpenFolderId(null);
    setDragRevealFolderId(null);
  }

  function openAssignSheet(ticket: TicketCard) {
    setAssignTicket(ticket);
    setSheetSearch("");
    setSheetGroupMode(groupMode);
    setSheetFolderId(null);
    setError(null);
  }

  const sheetPeople = useMemo(() => {
    let list = sheetModeColumns.filter((col) =>
      matchesAssignmentPersonnelSearch(col, sheetSearch),
    );
    if (sheetFolderId) {
      list = list.filter((col) => personnelFolderKey(col, sheetGroupMode) === sheetFolderId);
    }
    return sortPersonnelByRole(list);
  }, [sheetModeColumns, sheetSearch, sheetFolderId, sheetGroupMode]);

  function renderTicketCard(
    t: TicketCard,
    assigneeColorKey?: string | null,
    compact?: boolean,
    /** When true, content only — parent owns the card chrome (avoids double borders). */
    embedded?: boolean,
  ) {
    const preview = assignmentCardPreview(t);
    const transferPending = t.status === "ESCALATED";
    const inner = (
      <>
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[11px] text-zinc-600 dark:text-zinc-500">{t.ticketNumber}</p>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {transferPending ? (
              <span
                className="rounded-full border border-rose-500/60 bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800 dark:border-rose-400/50 dark:bg-rose-500/20 dark:text-rose-200"
                title="Transfer pending — needs reassignment"
              >
                Transfer pending
              </span>
            ) : null}
            <span
              className="rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              title={requestTypeLabel(t.requestType)}
            >
              {requestTypeAcronym(t.requestType)}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", priorityPillClass(t.priority))}>
              {t.priority}
            </span>
          </div>
        </div>
        <Link
          href={`/agent/tickets/${t.id}`}
          className={cn(
            "mt-1 block font-semibold text-zinc-900 hover:underline dark:text-zinc-100",
            compact ? "text-sm" : "text-sm line-clamp-2 sm:text-base",
          )}
        >
          {preview}
        </Link>
        {(t.requestorSectionName || t.sendToSectionName) ? (
          <p className="mt-1 space-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
            {t.requestorSectionName ? (
              <span className="block truncate" title={t.requestorSectionName}>
                From: {t.requestorSectionName}
              </span>
            ) : null}
            {t.sendToSectionName ? (
              <span className="block truncate" title={t.sendToSectionName}>
                To: {t.sendToSectionName}
              </span>
            ) : null}
          </p>
        ) : extractDepartmentFromDescription(t.description) ? (
          <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-500">
            Request to Company/SBU: {extractDepartmentFromDescription(t.description)}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">{formatRelativeAgo(t.updatedAt)}</p>
      </>
    );

    if (embedded) {
      return <div key={t.id}>{inner}</div>;
    }

    const outlineClass = transferPending
      ? "rounded-xl border-2 border-rose-500 bg-rose-50/40 ring-1 ring-rose-500/25 dark:border-rose-500 dark:bg-rose-950/20 dark:ring-rose-400/20"
      : "rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-[#101a2f]";

    if (assigneeColorKey) {
      return (
        <AssigneeColorHighlight
          key={t.id}
          assigneeColorKey={assigneeColorKey}
          className={outlineClass}
        >
          <div className="p-3">{inner}</div>
        </AssigneeColorHighlight>
      );
    }

    return (
      <div key={t.id} className={cn(outlineClass, "p-3")}>
        {inner}
      </div>
    );
  }

  return (
    <main className="min-h-[calc(100dvh-56px)] bg-zinc-50 px-2 py-4 text-zinc-900 sm:px-4 sm:py-8 dark:bg-[#070d19] dark:text-zinc-100">
      <div className="mx-auto max-w-[1500px] space-y-4 sm:space-y-5">
        <PointerDragGhostLayer ghost={laneDrag.ghost} />
        {portalReady && assignTicket
          ? createPortal(
              <div className="fixed inset-0 z-[220] flex flex-col justify-end md:hidden">
                <button
                  type="button"
                  className="absolute inset-0 bg-zinc-950/60 backdrop-blur-[1px]"
                  aria-label="Close assign sheet"
                  onClick={() => setAssignTicket(null)}
                />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Assign request"
                  className="relative z-10 flex max-h-[85dvh] flex-col rounded-t-2xl border border-zinc-700 bg-zinc-950 pb-[max(1rem,env(safe-area-inset-bottom,0px))] shadow-2xl"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-400">Assign to</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-zinc-400">{assignTicket.ticketNumber}</p>
                      <p className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-100">
                        {assignmentCardPreview(assignTicket)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAssignTicket(null)}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-zinc-300"
                      aria-label="Close"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="space-y-2 border-b border-zinc-800 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                        Group by
                      </span>
                      <PersonnelGroupToggle
                        value={sheetGroupMode}
                        onChange={(next) => {
                          setSheetGroupMode(next);
                          writeRequestKanbanFlowMode(groupModeToFlowMode(next));
                          setSheetFolderId(null);
                        }}
                      />
                    </div>
                    {sheetFolderOptions.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        <button
                          type="button"
                          onClick={() => setSheetFolderId(null)}
                          className={cn(
                            "shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold",
                            sheetFolderId === null
                              ? "border-orange-500/60 bg-orange-500/15 text-orange-200"
                              : "border-zinc-700 bg-zinc-900 text-zinc-300",
                          )}
                        >
                          All
                        </button>
                        {sheetFolderOptions.map((folder) => (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() =>
                              setSheetFolderId((current) =>
                                current === folder.id ? null : folder.id,
                              )
                            }
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold",
                              sheetFolderId === folder.id
                                ? "border-orange-500/60 bg-orange-500/15 text-orange-200"
                                : "border-zinc-700 bg-zinc-900 text-zinc-300",
                            )}
                          >
                            <Folder className="size-3.5" aria-hidden />
                            <span className="max-w-[9rem] truncate">{folder.name}</span>
                            <span className="text-zinc-500">{folder.agentCount}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Search person</span>
                      <input
                        type="search"
                        value={sheetSearch}
                        onChange={(e) => setSheetSearch(e.target.value)}
                        placeholder="Name…"
                        autoComplete="off"
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500"
                      />
                    </label>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                    {sheetPeople.length === 0 ? (
                      <p className="px-2 py-8 text-center text-sm text-zinc-500">No matching people.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {sheetPeople.map((col) => (
                          <li key={col.agentId}>
                            <button
                              type="button"
                              disabled={busyTicketId === assignTicket.id}
                              onClick={() => void assign(assignTicket, col.agentId)}
                              className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-3 text-left transition hover:border-orange-500/40 hover:bg-orange-500/10 disabled:opacity-50"
                            >
                              <AssigneeInitialsBadge
                                agentName={col.name}
                                assigneeColorKey={col.assigneeColorKey}
                                className="size-9 shrink-0 text-xs"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-zinc-100">{col.name}</p>
                                <p className="truncate text-[11px] text-zinc-500">
                                  {col.role}
                                  {col.teamLabel ? ` · ${col.teamLabel}` : ""}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
                                {col.cards.length}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
        <OrchestrationQueueNav />
        <header className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_10px_30px_rgba(0,0,0,0.08)] sm:p-6 dark:border-zinc-800/90 dark:bg-gradient-to-b dark:from-[#0d1629] dark:to-[#0b1220] dark:shadow-[0_16px_45px_rgba(0,0,0,0.35)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-400/95">
            {BRAND_TITLE} · Manual assignment
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl md:text-4xl dark:text-white">
            Assign Requests
          </h1>
          {notice ? (
            <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-100/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
              {notice}
            </p>
          ) : null}
        </header>

        {error ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
            {error}
          </p>
        ) : null}

        <section className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:grid-cols-[1fr_2fr] xl:gap-4">
          <article className="rounded-2xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-[#0b1220] sm:p-3 xl:sticky xl:top-4 xl:self-start">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">
                Unassigned pool
              </h2>
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-500/20 dark:text-orange-200">
                {cards.length}
              </span>
            </div>
            <p className="mb-2 px-1 text-[11px] text-zinc-500 md:hidden">
              Tap <span className="font-semibold text-orange-600 dark:text-orange-300">Assign</span> on a
              request, then choose a person.
            </p>
            <div className="max-h-[38dvh] space-y-2 overflow-y-auto overflow-x-hidden pr-1 sm:max-h-[70vh]">
              {cards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
                  No unassigned requests.
                </div>
              ) : (
                cards.map((t) => (
                  <div
                    key={t.id}
                    {...laneDrag.getCardPointerProps(t.id, {
                      getLabel: () =>
                        `${t.ticketNumber} · ${assignmentCardPreview(t).slice(0, 72)}`,
                    })}
                    className={cn(
                      "touch-pan-y select-none rounded-xl px-3 py-2.5 shadow-sm",
                      t.status === "ESCALATED"
                        ? "border-2 border-rose-500 bg-rose-50/40 ring-1 ring-rose-500/25 dark:border-rose-500 dark:bg-rose-950/20 dark:ring-rose-400/20"
                        : "border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-[#101a2f]",
                      busyTicketId === t.id && "pointer-events-none opacity-50",
                      laneDrag.draggingItemId === t.id && "opacity-60 ring-1 ring-orange-400/40",
                    )}
                  >
                    <div className="flex gap-2">
                      <GripVertical
                        className="mt-0.5 hidden size-4 shrink-0 text-zinc-400 md:block dark:text-zinc-500"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        {renderTicketCard(t, null, false, true)}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openAssignSheet(t);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-orange-500 md:hidden"
                        >
                          <UserPlus size={14} aria-hidden />
                          Assign
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-[#0b1220] sm:p-3">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2 px-1">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">
                  Personnel
                </h2>
                <p className="mt-0.5 hidden text-[11px] text-zinc-500 md:block dark:text-zinc-400">
                  Open a folder, or drag a request onto one to reveal people.
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500 md:hidden dark:text-zinc-400">
                  Browse people here, or use Assign on a request card.
                </p>
              </div>
              <PersonnelGroupToggle value={groupMode} onChange={handleGroupModeChange} />
            </div>

            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 dark:border-zinc-800/90 dark:bg-zinc-900/40 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-xs">
                <span className={authLabelClass}>Search by name</span>
                <input
                  type="search"
                  value={personnelSearchQuery}
                  onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                  placeholder="Name…"
                  className={personnelSearchInputClass}
                  autoComplete="off"
                  aria-label="Search personnel by name"
                />
              </label>
              <p className="w-full text-[11px] text-zinc-500 dark:text-zinc-500 sm:ml-auto sm:w-auto sm:text-right">
                {personnelSearchActive
                  ? `Showing ${filteredColumns.length} of ${modeColumns.length} user${modeColumns.length === 1 ? "" : "s"}`
                  : `${filteredColumns.length} user${filteredColumns.length === 1 ? "" : "s"}`}
              </p>
            </div>

            {modeColumns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-12 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
                No personnel — designate staff to a company/SBU in Personnel (Portal Accounts).
              </div>
            ) : filteredColumns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-12 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
                No users match the current filters.
              </div>
            ) : folderOptions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-12 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
                No {groupMode === "company" ? "companies" : "departments"} to show.
              </div>
            ) : openFolder ? (
              <div className="max-h-[min(72dvh,48rem)] space-y-3 overflow-y-auto pr-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenFolderId(null)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <ChevronLeft className="size-3.5" aria-hidden />
                    Folders
                  </button>
                  <div className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-orange-300/70 bg-orange-50 px-3 py-1.5 dark:border-orange-800/60 dark:bg-orange-950/30">
                    <FolderOpen className="size-4 shrink-0 text-orange-600 dark:text-orange-300" aria-hidden />
                    <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      {openFolder.name}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {openFolder.agentCount}
                    </Badge>
                  </div>
                </div>

                <div
                  ref={laneDrag.registerColumn(assignmentFolderDropTarget(openFolder.id, groupMode))}
                  className={cn(
                    "space-y-3 rounded-xl border border-orange-200 bg-white p-2 shadow-sm dark:border-orange-900/60 dark:bg-zinc-950",
                    activeFolderId === openFolder.id &&
                      "ring-2 ring-orange-500/60 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950",
                  )}
                >
                  {[
                    {
                      label: "Admins",
                      list: openFolderColumns.filter((c) => personnelRoleLabel(c.role) === "Admin"),
                    },
                    {
                      label: "Personnel",
                      list: openFolderColumns.filter(
                        (c) => personnelRoleLabel(c.role) === "Personnel",
                      ),
                    },
                  ].map((group) =>
                    group.list.length > 0 ? (
                      <div key={`${openFolder.id}-${group.label}`} className="space-y-2">
                        <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                          {group.label}
                        </p>
                        {group.list.map((col) => {
                          const userTargetId = assignmentUserDropTarget(col.agentId);
                          const isUserHovered = laneDrag.hoverColumn === userTargetId;
                          return (
                            <article
                              key={col.agentId}
                              ref={laneDrag.registerColumn(userTargetId)}
                              className={cn(
                                "rounded-xl border border-zinc-200 bg-zinc-50/90 p-2 transition dark:border-zinc-700 dark:bg-[#101a2f]",
                                isUserHovered &&
                                  "ring-2 ring-orange-500/65 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950",
                              )}
                            >
                              <div className="mb-2 flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-start gap-2">
                                  <AssigneeInitialsBadge
                                    agentName={col.name}
                                    assigneeColorKey={col.assigneeColorKey}
                                    className="mt-0.5 size-8 text-xs"
                                  />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                      {col.name}
                                    </p>
                                    <p className="text-[11px] text-zinc-600 dark:text-zinc-500">
                                      {col.role}
                                      {col.teamLabel ? ` · ${col.teamLabel}` : ""}
                                    </p>
                                  </div>
                                </div>
                                <Badge variant="secondary" className="text-[10px]">
                                  {col.cards.length}
                                </Badge>
                              </div>
                              <div className="max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
                                {col.cards.length === 0 ? (
                                  <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
                                    Drop requests here to assign.
                                  </div>
                                ) : (
                                  col.cards.map((t) =>
                                    renderTicketCard(t, col.assigneeColorKey, true),
                                  )
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null,
                  )}
                  {openFolderColumns.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-300 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
                      No people in this folder.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="max-h-[min(72dvh,48rem)] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-4 pt-2 sm:grid-cols-3 xl:grid-cols-4">
                  {folderOptions.map((folder) => {
                    const targetId = assignmentFolderDropTarget(folder.id, groupMode);
                    const isHot =
                      activeFolderId === folder.id || laneDrag.hoverColumn === targetId;
                    const FolderIcon = isHot ? FolderOpen : Folder;
                    return (
                      <button
                        key={`folder-${folder.id}`}
                        type="button"
                        ref={laneDrag.registerColumn(targetId)}
                        onClick={() => setOpenFolderId(folder.id)}
                        className={cn(
                          "group relative flex flex-col text-left outline-none",
                          "focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950",
                        )}
                      >
                        {/* Folder tab */}
                        <span
                          aria-hidden
                          className={cn(
                            "relative z-10 ml-2 h-2.5 w-[42%] max-w-[4.5rem] rounded-t-md border border-b-0 transition",
                            isHot
                              ? "border-orange-400 bg-orange-200/90 dark:border-orange-500 dark:bg-orange-900/80"
                              : "border-zinc-300 bg-zinc-200/95 group-hover:border-orange-300 group-hover:bg-orange-100 dark:border-zinc-600 dark:bg-zinc-800 dark:group-hover:border-orange-700 dark:group-hover:bg-orange-950/60",
                          )}
                        />
                        {/* Folder body */}
                        <span
                          className={cn(
                            "relative z-0 -mt-px flex min-h-[5.75rem] flex-col gap-2 rounded-xl rounded-tl-md border px-3 py-2.5 shadow-sm transition",
                            isHot
                              ? "border-orange-400 bg-orange-50 ring-2 ring-orange-500/45 dark:border-orange-500 dark:bg-orange-950/35"
                              : "border-zinc-300 bg-gradient-to-b from-zinc-50 to-zinc-100/80 group-hover:border-orange-300 group-hover:from-orange-50/80 group-hover:to-orange-50/40 dark:border-zinc-600 dark:from-zinc-900 dark:to-[#0f1624] dark:group-hover:border-orange-700/80 dark:group-hover:from-orange-950/40 dark:group-hover:to-zinc-900",
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <FolderIcon
                              className={cn(
                                "size-5 shrink-0 transition",
                                isHot
                                  ? "text-orange-600 dark:text-orange-300"
                                  : "text-orange-500 group-hover:text-orange-600 dark:text-orange-400",
                              )}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-bold leading-tight text-zinc-900 dark:text-zinc-50">
                              {folder.name}
                            </span>
                            <Badge
                              variant="secondary"
                              className="h-5 shrink-0 px-1.5 text-[10px] tabular-nums"
                            >
                              {folder.agentCount}
                            </Badge>
                          </span>
                          <span className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-200/80 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700/80 dark:text-zinc-400">
                            <span>
                              {folder.ticketCount} assigned
                            </span>
                            <span className="font-medium normal-case tracking-normal text-zinc-400 opacity-0 transition group-hover:opacity-100 dark:text-zinc-500">
                              Open
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
