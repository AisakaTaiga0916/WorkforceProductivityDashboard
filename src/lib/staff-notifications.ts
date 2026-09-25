import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client/primary";
import { isElevatedUserRole } from "@/lib/auth";
import { customerTicketWhereBySessionEmail } from "@/lib/customer-pending-resolution";
import {
  isItProjectEnvelope,
  isItProjectPhaseDelayed,
  parseItProjectSubKpis,
  phaseDelayNotifyAssignees,
  resolvePhaseEffectiveTargetDate,
} from "@/lib/it-project-subkpis";
import { getTaskTargetDueDate } from "@/lib/kpi-subkpis";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "@/lib/kpi-recurrence";
import { prisma } from "@/lib/prisma";
import { personnelRequestBoardWhere } from "@/lib/rfp-request-board";
import { findSessionAgentId } from "@/lib/session-agent";
import {
  formatTicketActivityNotificationTitle,
  isNotifiableTicketActivity,
} from "@/lib/staff-notification-copy";
import {
  getOperatorActionableApprovalLevel,
  hasHierarchicalApprovals,
} from "@/lib/travel-order";
import {
  listPendingTravelApprovalsForAgent,
  listPendingTravelConfirmationsForAgent,
} from "@/lib/travel-order-db";
import { listPendingVerificationKpiIdsForOrgChartHead } from "@/lib/task-completion-verification-access";

export type StaffNotifKind =
  | "ticket"
  | "travel_approval"
  | "travel_confirmation"
  | "phase_delay"
  | "account_request"
  | "task_verification"
  | "task_verification_result";

export type StaffNotificationFeedItem = {
  /** Stable list key */
  key: string;
  kind: StaffNotifKind;
  at: string;
  title: string;
  subtitle: string;
  meta: string;
  /** True when newer than the viewer’s notificationsLastReadAt. */
  unread?: boolean;
  href?: string;
  ticketId?: string;
  travelOrderId?: string;
  kpiMaintenanceId?: string;
  pendingLevel?: number | null;
  pendingLevelOptional?: boolean;
  accountRequestType?: string;
};

export type StaffNotificationFeedResult = {
  items: StaffNotificationFeedItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  unreadCount: number;
  lastReadAt: string | null;
};

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString();
}

function isUnread(atIso: string, lastReadAt: Date | null): boolean {
  if (!lastReadAt) return true;
  const t = new Date(atIso).getTime();
  if (!Number.isFinite(t)) return false;
  return t > lastReadAt.getTime();
}

function withUnread(
  item: StaffNotificationFeedItem,
  lastReadAt: Date | null,
): StaffNotificationFeedItem {
  return { ...item, unread: isUnread(item.at, lastReadAt) };
}

export async function getStaffNotificationsLastReadAt(email: string): Promise<Date | null> {
  const key = email.trim();
  if (!key) return null;
  const rows = await prisma.$queryRaw<Array<{ notifications_last_read_at: Date | null }>>`
    SELECT notifications_last_read_at
    FROM portal_accounts
    WHERE LOWER(email) = LOWER(${key})
    LIMIT 1
  `;
  return rows[0]?.notifications_last_read_at ?? null;
}

export async function markStaffNotificationsRead(email: string, at = new Date()): Promise<Date> {
  const key = email.trim();
  if (!key) return at;
  await prisma.$executeRaw`
    UPDATE portal_accounts
    SET notifications_last_read_at = ${at}
    WHERE LOWER(email) = LOWER(${key})
  `;
  return at;
}

async function loadPhaseDelayItems(args: {
  agentId: string | null;
  isMonitor: boolean;
}): Promise<StaffNotificationFeedItem[]> {
  const { agentId, isMonitor } = args;
  if (!agentId && !isMonitor) return [];

  const timeZone = normalizeTimeZone(DEFAULT_TIME_ZONE);
  const nowMs = Date.now();
  const rows = await prisma.kpiMaintenance.findMany({
    select: {
      id: true,
      title: true,
      mainTask: true,
      subKpis: true,
      assignedAgentId: true,
      updatedAt: true,
    },
    take: 200,
    orderBy: { updatedAt: "desc" },
  });

  const items: StaffNotificationFeedItem[] = [];
  for (const row of rows) {
    if (!isItProjectEnvelope(row.subKpis)) continue;
    const mainDue = getTaskTargetDueDate(row.subKpis);
    const data = parseItProjectSubKpis(row.subKpis);
    for (const phase of data.phases) {
      if (!isItProjectPhaseDelayed(phase, timeZone, nowMs, mainDue)) continue;
      const assignees = phaseDelayNotifyAssignees(phase, row.assignedAgentId);
      if (agentId && !assignees.includes(agentId)) continue;
      if (!agentId && !isMonitor) continue;
      const target = resolvePhaseEffectiveTargetDate(phase, mainDue);
      if (!target) continue;
      const label = (row.mainTask?.trim() || row.title).trim();
      items.push({
        key: `phase-delay-${row.id}-${phase.id}`,
        kind: "phase_delay",
        at: toIso(row.updatedAt),
        title: `${phase.name} is delayed`,
        subtitle: label,
        meta: `Target ${target}`,
        href: `/agent/tasks?task=${encodeURIComponent(row.id)}`,
        kpiMaintenanceId: row.id,
      });
    }
  }
  return items;
}

async function loadTaskVerificationItems(args: {
  session: Session;
  agentId: string | null;
}): Promise<StaffNotificationFeedItem[]> {
  const { session, agentId } = args;
  const role = session.user?.role ?? "Customer";
  if (role !== "Personnel" && role !== "Admin" && !isElevatedUserRole(role)) {
    return [];
  }

  const items: StaffNotificationFeedItem[] = [];

  const pendingIds = await listPendingVerificationKpiIdsForOrgChartHead({
    email: session.user?.email,
    operatorAgentId: agentId,
    role,
    take: 80,
  });

  if (pendingIds.length > 0) {
    const pendingRows = await prisma.kpiMaintenance.findMany({
      where: { id: { in: pendingIds } },
      select: {
        id: true,
        title: true,
        mainTask: true,
        pendingVerificationAt: true,
        updatedAt: true,
        assignedAgent: { select: { name: true } },
      },
      orderBy: { pendingVerificationAt: "desc" },
    });

    for (const row of pendingRows) {
      const label = (row.mainTask?.trim() || row.title).trim();
      items.push({
        key: `task-verify-${row.id}`,
        kind: "task_verification",
        at: toIso(row.pendingVerificationAt ?? row.updatedAt),
        title: "Verification needed",
        subtitle: label,
        meta: row.assignedAgent?.name
          ? `Assignee · ${row.assignedAgent.name}`
          : "Department head review",
        href: `/agent/tasks?task=${encodeURIComponent(row.id)}`,
        kpiMaintenanceId: row.id,
      });
    }
  }

  if (agentId) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = await prisma.kpiMaintenanceActivity.findMany({
      where: {
        createdAt: { gte: since },
        summary: { in: ["Task completion verified", "Task completion rejected"] },
        kpiMaintenance: { assignedAgentId: agentId },
      },
      select: {
        id: true,
        summary: true,
        detail: true,
        createdAt: true,
        kpiMaintenanceId: true,
        kpiMaintenance: { select: { title: true, mainTask: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    for (const act of recent) {
      const label = (act.kpiMaintenance.mainTask?.trim() || act.kpiMaintenance.title).trim();
      const rejected = act.summary.includes("rejected");
      items.push({
        key: `task-verify-result-${act.id}`,
        kind: "task_verification_result",
        at: toIso(act.createdAt),
        title: rejected ? "Completion returned" : "Completion verified",
        subtitle: label,
        meta: rejected
          ? act.detail?.trim() || "Continue work"
          : "Task marked Done",
        href: `/agent/tasks?task=${encodeURIComponent(act.kpiMaintenanceId)}`,
        kpiMaintenanceId: act.kpiMaintenanceId,
      });
    }
  }

  return items;
}

async function loadTicketActivityItems(args: {
  ticketWhere: Prisma.TicketWhereInput | null;
  cap: number;
}): Promise<StaffNotificationFeedItem[]> {
  if (!args.ticketWhere) return [];

  const activities = await prisma.ticketActivity.findMany({
    where: { ticket: args.ticketWhere },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(args.cap * 3, 60), 800),
    select: {
      id: true,
      summary: true,
      detail: true,
      createdAt: true,
      ticketId: true,
      ticket: {
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          status: true,
        },
      },
    },
  });

  const items: StaffNotificationFeedItem[] = [];
  for (const a of activities) {
    if (!isNotifiableTicketActivity(a.summary)) continue;
    items.push({
      key: `activity-${a.id}`,
      kind: "ticket",
      at: toIso(a.createdAt),
      title: formatTicketActivityNotificationTitle(a.summary, a.detail),
      subtitle: a.ticket.title.trim() || a.ticket.ticketNumber,
      meta: `${a.ticket.ticketNumber} · ${a.ticket.status.replaceAll("_", " ")}`,
      ticketId: a.ticketId,
      href: `/agent?ticket=${encodeURIComponent(a.ticketId)}`,
    });
    if (items.length >= args.cap) break;
  }
  return items;
}

/**
 * Unified staff notification feed (request events + travel + delays + account requests).
 * Sorted newest-first; paginated after a capped source load.
 */
export async function loadStaffNotificationFeed(args: {
  session: Session;
  page?: number;
  pageSize?: number;
  /** Cap on notifiable ticket activities included before pagination. */
  activityCap?: number;
}): Promise<StaffNotificationFeedResult> {
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(Math.max(args.pageSize ?? 20, 1), 50);
  const activityCap = Math.min(Math.max(args.activityCap ?? 120, 20), 400);
  const role = args.session.user?.role ?? "Customer";
  const email = args.session.user?.email ?? "";
  const name = args.session.user?.name ?? null;
  const isAdminRole = isElevatedUserRole(role) || role === "Admin";

  const operator =
    role === "Personnel" || role === "Admin" || isElevatedUserRole(role)
      ? await findSessionAgentId({ email, name })
      : null;

  const personnelWhere = role === "Personnel" ? await personnelRequestBoardWhere(operator?.id) : null;

  let sectionBoardWhere: Prisma.TicketWhereInput | null = null;
  if (role === "Personnel" || role === "Admin" || role === "HighAdmin") {
    const { sectionScopedTicketWhere } = await import("@/lib/org-chart-section-scope");
    sectionBoardWhere = await sectionScopedTicketWhere({
      email,
      agentId: operator?.id,
    });
  }

  const ticketWhere: Prisma.TicketWhereInput | null =
    role === "Customer"
      ? customerTicketWhereBySessionEmail(email)
      : sectionBoardWhere
        ? sectionBoardWhere
        : personnelWhere
          ? personnelWhere
          : isElevatedUserRole(role) || role === "Admin"
            ? {}
            : null;

  const [
    lastReadAt,
    ticketActivityItems,
    travelApprovals,
    travelConfirmations,
    phaseDelayItems,
    accountRows,
    taskVerificationItems,
  ] = await Promise.all([
    getStaffNotificationsLastReadAt(email),
    loadTicketActivityItems({ ticketWhere, cap: activityCap }).catch(() => []),
    operator?.id
      ? listPendingTravelApprovalsForAgent(operator.id).catch(() => [])
      : Promise.resolve([]),
    operator?.id
      ? listPendingTravelConfirmationsForAgent(operator.id).catch(() => [])
      : Promise.resolve([]),
    loadPhaseDelayItems({
      agentId: operator?.id ?? null,
      isMonitor: isAdminRole,
    }).catch(() => []),
    isAdminRole
      ? prisma.accountActionRequest.findMany({
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            requestType: true,
            createdAt: true,
            portalAccount: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve([]),
    loadTaskVerificationItems({
      session: args.session,
      agentId: operator?.id ?? null,
    }).catch(() => []),
  ]);

  const items: StaffNotificationFeedItem[] = [...ticketActivityItems];

  for (const n of travelApprovals) {
    const label = n.kpiMainTask || n.kpiTitle || "Travel Order";
    const levels = n.approvalLevels ?? [];
    const pending =
      operator?.id && hasHierarchicalApprovals(levels)
        ? getOperatorActionableApprovalLevel(levels, operator.id)
        : null;
    items.push({
      key: `to-approve-${n.id}`,
      kind: "travel_approval",
      at: toIso(n.updatedAt),
      title:
        pending?.level != null
          ? `Travel approval needed (L${pending.level}${pending.optional ? ", optional" : ""})`
          : "Travel approval needed",
      subtitle: label,
      meta: n.orderRequest?.trim() || "Work plan / travel order",
      travelOrderId: n.id,
      kpiMaintenanceId: n.kpiMaintenanceId,
      pendingLevel: pending?.level ?? null,
      pendingLevelOptional: pending?.optional === true,
      href: `/agent/tasks?task=${encodeURIComponent(n.kpiMaintenanceId)}&travelOrder=${encodeURIComponent(n.id)}`,
    });
  }

  for (const n of travelConfirmations) {
    const label = n.kpiMainTask || n.kpiTitle || "Travel Order";
    items.push({
      key: `to-confirm-${n.id}`,
      kind: "travel_confirmation",
      at: toIso(n.updatedAt),
      title: "Travel confirmation needed",
      subtitle: label,
      meta: n.orderRequest?.trim() || "Confirm travel order",
      travelOrderId: n.id,
      kpiMaintenanceId: n.kpiMaintenanceId,
      href: `/agent/tasks?task=${encodeURIComponent(n.kpiMaintenanceId)}&travelOrder=${encodeURIComponent(n.id)}`,
    });
  }

  items.push(...phaseDelayItems);
  items.push(...taskVerificationItems);

  for (const n of accountRows) {
    const typeLabel =
      n.requestType === "DELETION"
        ? "Account deletion request"
        : n.requestType === "PASSWORD_RESET"
          ? "Password reset request"
          : "Account suspension request";
    items.push({
      key: `account-${n.id}`,
      kind: "account_request",
      at: toIso(n.createdAt),
      title: typeLabel,
      subtitle: `${n.portalAccount.name} · ${n.portalAccount.email}`,
      meta: "Pending review",
      href: "/admin/account",
      accountRequestType: n.requestType,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const withFlags = items.map((item) => withUnread(item, lastReadAt));
  const unreadCount = withFlags.reduce((n, item) => n + (item.unread ? 1 : 0), 0);
  const total = withFlags.length;
  const start = (page - 1) * pageSize;
  const pageItems = withFlags.slice(start, start + pageSize);

  return {
    items: pageItems,
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
    unreadCount,
    lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
  };
}

/** Badge count for the nav bell (unread feed items, capped for polling cost). */
export async function loadStaffNotificationUnreadCount(session: Session): Promise<{
  total: number;
  lastReadAt: string | null;
}> {
  const feed = await loadStaffNotificationFeed({
    session,
    page: 1,
    pageSize: 1,
    activityCap: 80,
  });
  return {
    total: feed.unreadCount,
    lastReadAt: feed.lastReadAt,
  };
}
