/** Create / release Request for Payment tickets linked to Work Plans. */

import type { TicketPriority } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";
import {
  formatPaymentRequestDescription,
  formatPaymentRequestTitle,
  MODE_OF_PAYMENT_CHECK,
  normalizePaymentAmountInput,
  parsePaymentRequestDescription,
  type PaymentRequestFields,
} from "@/lib/request-for-payment";
import {
  defaultPaymentApprovalMeta,
  parsePaymentApprovalMeta,
  paymentApprovalStartStep,
  type PaymentApprovalMeta,
} from "@/lib/request-for-payment-approval";
import { loadPaymentApprovalMeta, savePaymentApprovalMeta } from "@/lib/payment-approval-db";
import { addHours, getSlaPolicy } from "@/lib/sla";
import { nextTicketNumber } from "@/lib/ticket-number";
import { logActivity } from "@/lib/ticket-actions";
import type { TravelOrderRow } from "@/lib/travel-order-db";
import { requestTypeLabel } from "@/lib/request-types";
import { ensureTicketLinkedTravelOrderColumn } from "@/lib/ensure-ticket-linked-travel-order-column";
import { TO_RFP_DEFAULT_IN_PAYMENT_OF } from "@/lib/travel-order-rfp-constants";
import {
  resolveDefaultSendToSectionForBudgetCompany,
  resolveRfpBookkeeperForBudgetCompany,
} from "@/lib/intake-approval-recommendations";
import {
  resolveMergedSourceUserIdForAgent,
  resolveMergedSourceUserIdForSessionEmail,
} from "@/lib/approval-position-resolver";
import { resolveDeepestOrgChartSectionIdForMergedUser } from "@/lib/org-chart-section-roster";

export type LinkedRfpSummary = {
  id: string;
  ticketNumber: string;
  title: string;
  awaitingTravelOrderApproval: boolean;
};

function paymentFieldsFromTravelOrder(order: TravelOrderRow): PaymentRequestFields {
  const meta = order.workPlanMeta;
  // Payee = Travel Order requestor (creator), not Requesting Party / designation.
  const payee =
    (order.createdByAgent?.name ?? "").trim() ||
    (order.createdBy ?? "").trim() ||
    "Payee";
  const inPaymentOf = TO_RFP_DEFAULT_IN_PAYMENT_OF;
  const amountRaw = (meta?.totalEstimatedBudget ?? "").trim();
  const amount = normalizePaymentAmountInput(amountRaw) || amountRaw || "0.00";
  return {
    payee,
    inPaymentOf,
    accountTitle: "",
    amount,
    modeOfPayment: MODE_OF_PAYMENT_CHECK,
    deliveryOfCheck: "Encashment",
    notes: "",
  };
}

/** Requestor's designated org-chart department (deepest section membership). */
async function resolveRequestorDesignatedDepartment(opts: {
  agentId?: string | null;
  email?: string | null;
}): Promise<{ sectionId: string; sectionName: string } | null> {
  const agentId = (opts.agentId ?? "").trim();
  const email = (opts.email ?? "").trim();
  const mergedId =
    (agentId ? await resolveMergedSourceUserIdForAgent(agentId) : null) ||
    (email ? await resolveMergedSourceUserIdForSessionEmail(email) : null);
  if (!mergedId) return null;
  const sectionId = await resolveDeepestOrgChartSectionIdForMergedUser(mergedId);
  if (!sectionId) return null;
  const section = await prisma.orgChartSection.findUnique({
    where: { id: sectionId },
    select: { id: true, name: true },
  });
  const name = section?.name?.trim() || "";
  if (!section || !name) return null;
  return { sectionId: section.id, sectionName: name };
}

export async function findLinkedRfpByTravelOrderId(
  travelOrderId: string,
): Promise<LinkedRfpSummary | null> {
  await ensureTicketLinkedTravelOrderColumn();
  const id = travelOrderId.trim();
  if (!id) return null;
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        ticket_number: string;
        title: string;
        payment_approval_meta: unknown;
      }>
    >`
      SELECT id, ticket_number, title, payment_approval_meta
      FROM tickets
      WHERE linked_travel_order_id = ${id}
        AND request_type = 'REQUEST_FOR_PAYMENT'
      ORDER BY created_at ASC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const meta = parsePaymentApprovalMeta(row.payment_approval_meta);
    return {
      id: row.id,
      ticketNumber: row.ticket_number,
      title: row.title,
      awaitingTravelOrderApproval: meta?.awaitingTravelOrderApproval === true,
    };
  } catch (err) {
    console.error("[travel-order-rfp] findLinkedRfpByTravelOrderId failed:", err);
    return null;
  }
}

/**
 * Create a held RFP from a submitted Travel Order. Idempotent on linked_travel_order_id.
 * Soft-fail friendly: callers should catch and keep TO submit successful.
 */
export async function createRfpFromSubmittedTravelOrder(
  order: TravelOrderRow,
): Promise<LinkedRfpSummary> {
  await ensureTicketLinkedTravelOrderColumn();
  const existing = await findLinkedRfpByTravelOrderId(order.id);
  if (existing) return existing;

  const creatorAgentId = order.createdByAgentId?.trim() || order.createdByAgent?.id || null;
  const creator = creatorAgentId
    ? await prisma.agent.findUnique({
        where: { id: creatorAgentId },
        select: { id: true, name: true, email: true, teamId: true },
      })
    : null;

  const contactName =
    (creator?.name ?? "").trim() || (order.createdBy ?? "").trim() || "Requestor";
  const contactEmail =
    (creator?.email ?? "").trim() ||
    (typeof order.createdBy === "string" && order.createdBy.includes("@")
      ? order.createdBy.trim()
      : "") ||
    "noreply@localhost";

  const teamId =
    (order.companyTeamId ?? "").trim() ||
    (creator?.teamId ?? "").trim() ||
    null;

  const defaultSection = teamId
    ? await resolveDefaultSendToSectionForBudgetCompany(teamId)
    : null;
  const requestorDepartment = await resolveRequestorDesignatedDepartment({
    agentId: creator?.id,
    email: contactEmail,
  });
  const budgetCompany = teamId
    ? await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true },
      })
    : null;
  const bookkeeper = teamId
    ? await resolveRfpBookkeeperForBudgetCompany({
        companyTeamId: teamId,
        sendToSectionId: defaultSection?.sectionId,
      })
    : null;

  const fields = paymentFieldsFromTravelOrder(order);
  const title = formatPaymentRequestTitle(fields);
  const description = formatPaymentRequestDescription(fields);

  const priority: TicketPriority = "MEDIUM";
  const policy = await getSlaPolicy(priority);
  const now = new Date();
  const firstResponseDueAt = addHours(now, policy.firstResponseHours);
  const resolutionDueAt = addHours(now, policy.resolutionHours);
  const ticketNumber = await nextTicketNumber();

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber,
      title,
      description,
      category: "FINANCE",
      priority,
      contactName,
      contactEmail,
      contactPhone: null,
      team: teamId ? { connect: { id: teamId } } : undefined,
      ...(defaultSection?.sectionId
        ? { orgChartSection: { connect: { id: defaultSection.sectionId } } }
        : {}),
      ...(requestorDepartment?.sectionId
        ? {
            requestorOrgChartSection: {
              connect: { id: requestorDepartment.sectionId },
            },
          }
        : {}),
      firstResponseDueAt,
      resolutionDueAt,
    },
  });

  const paymentMeta = defaultPaymentApprovalMeta({
    skipNotedBy: true,
    skipApprovedBy: true,
    awaitingTravelOrderApproval: true,
  });
  if (creator?.id) {
    paymentMeta.preparedByAgentId = creator.id;
  }
  if (bookkeeper?.agentId) {
    paymentMeta.accountingAgentId = bookkeeper.agentId;
  }
  const metaJson = JSON.stringify(paymentMeta);

  await prisma.$executeRaw`
    UPDATE tickets
    SET
      request_type = 'REQUEST_FOR_PAYMENT',
      requestor_email = ${contactEmail},
      linked_travel_order_id = ${order.id},
      payment_approval_meta = ${metaJson}::jsonb
    WHERE id = ${ticket.id}
  `;

  await logActivity(
    ticket.id,
    "SYSTEM",
    "Ticket logged",
    `Created from Work Plan ${order.id}. Held until the Work Plan is fully approved.`,
  );
  await logActivity(ticket.id, "SYSTEM", "Request type", requestTypeLabel("REQUEST_FOR_PAYMENT"));
  await logActivity(
    ticket.id,
    "SYSTEM",
    "Linked Work Plan",
    `Work Plan ${order.id} · awaiting Work Plan approval before Bookkeeper step.`,
  );
  if (budgetCompany?.name) {
    await logActivity(ticket.id, "SYSTEM", "Requesting company", budgetCompany.name);
  }
  if (defaultSection?.sectionName) {
    await logActivity(
      ticket.id,
      "SYSTEM",
      "Send request to department",
      defaultSection.sectionName,
    );
  }
  if (requestorDepartment?.sectionName) {
    await logActivity(
      ticket.id,
      "SYSTEM",
      "Requesting department",
      requestorDepartment.sectionName,
    );
  }
  if (bookkeeper?.agentName) {
    await logActivity(
      ticket.id,
      "SYSTEM",
      "Prepared by Bookkeeper",
      `${bookkeeper.agentName}${
        budgetCompany?.name
          ? ` (from ${budgetCompany.name}${
              bookkeeper.sectionName ? ` · ${bookkeeper.sectionName}` : ""
            })`
          : ""
      }`,
    );
  }
  await logActivity(
    ticket.id,
    "SYSTEM",
    "Noted By / Approved By skipped",
    "Work Plan approval covers these steps. Chain starts at Prepared by Bookkeeper after the Work Plan is approved.",
  );

  return {
    id: ticket.id,
    ticketNumber,
    title,
    awaitingTravelOrderApproval: true,
  };
}

/**
 * When a Work Plan first reaches APPROVED, release the held linked RFP
 * onto the Bookkeeper step (skips Noted By + Approved By).
 */
export async function releaseRfpAfterTravelOrderApproved(
  travelOrderId: string,
): Promise<LinkedRfpSummary | null> {
  const linked = await findLinkedRfpByTravelOrderId(travelOrderId);
  if (!linked) return null;

  const rows = await prisma.$queryRaw<Array<{ payment_approval_meta: unknown }>>`
    SELECT payment_approval_meta FROM tickets WHERE id = ${linked.id} LIMIT 1
  `;
  const meta =
    parsePaymentApprovalMeta(rows[0]?.payment_approval_meta) ??
    defaultPaymentApprovalMeta({ skipNotedBy: true, skipApprovedBy: true });

  if (!meta.awaitingTravelOrderApproval) {
    return { ...linked, awaitingTravelOrderApproval: false };
  }

  const next: PaymentApprovalMeta = {
    ...meta,
    skipNotedBy: true,
    skipApprovedBy: true,
    notedByAgentId: null,
    approvedByAgentId: null,
    proceduralStep: paymentApprovalStartStep(true, true),
    awaitingTravelOrderApproval: false,
  };

  // Ensure bookkeeper is set from Request Budget From (company) ∩ Accounting.
  if (!next.accountingAgentId?.trim()) {
    const ticketRow = await prisma.ticket.findUnique({
      where: { id: linked.id },
      select: { teamId: true, orgChartSectionId: true },
    });
    const companyTeamId = (ticketRow?.teamId ?? "").trim();
    if (companyTeamId) {
      const bookkeeper = await resolveRfpBookkeeperForBudgetCompany({
        companyTeamId,
        sendToSectionId: ticketRow?.orgChartSectionId,
      });
      if (bookkeeper?.agentId) {
        next.accountingAgentId = bookkeeper.agentId;
        await logActivity(
          linked.id,
          "SYSTEM",
          "Prepared by Bookkeeper",
          `${bookkeeper.agentName}${
            bookkeeper.sectionName ? ` · ${bookkeeper.sectionName}` : ""
          }`,
        );
      }
    }
  }

  await savePaymentApprovalMeta(linked.id, next);

  await logActivity(
    linked.id,
    "SYSTEM",
    "Work Plan approved",
    "Linked Work Plan is fully approved. Request for Payment is released to Prepared by Bookkeeper.",
  );

  return { ...linked, awaitingTravelOrderApproval: false };
}

/**
 * Backfill Accounting send-to, requestor designated department, and Payee
 * on an existing Work Plan–linked RFP. Safe to call on ticket page load.
 */
export async function ensureLinkedRfpAccountingDefaults(opts: {
  ticketId: string;
  companyTeamId?: string | null;
  requestorName?: string | null;
  requestorEmail?: string | null;
  requestorAgentId?: string | null;
}): Promise<{
  orgChartSectionId: string | null;
  orgChartSectionName: string | null;
  requestorOrgChartSectionId: string | null;
  requestorOrgChartSectionName: string | null;
  requestBudgetFromCompanyTeamId: string | null;
  requestBudgetFromCompanyName: string | null;
  bookkeeperAgentId: string | null;
  bookkeeperAgentName: string | null;
} | null> {
  const ticketId = opts.ticketId.trim();
  if (!ticketId) return null;

  await ensureTicketLinkedTravelOrderColumn();
  const rows = await prisma.$queryRaw<
    Array<{
      linked_travel_order_id: string | null;
      team_id: string | null;
      org_chart_section_id: string | null;
      requestor_org_chart_section_id: string | null;
      contact_name: string | null;
      contact_email: string | null;
      requestor_email: string | null;
      description: string | null;
      title: string | null;
    }>
  >`
    SELECT
      linked_travel_order_id,
      team_id,
      org_chart_section_id,
      requestor_org_chart_section_id,
      contact_name,
      contact_email,
      requestor_email,
      description,
      title
    FROM tickets
    WHERE id = ${ticketId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.linked_travel_order_id) return null;

  const companyTeamId =
    (opts.companyTeamId ?? "").trim() || (row.team_id ?? "").trim() || "";
  const requestorName =
    (opts.requestorName ?? "").trim() || (row.contact_name ?? "").trim() || "";
  const requestorEmail =
    (opts.requestorEmail ?? "").trim() ||
    (row.requestor_email ?? "").trim() ||
    (row.contact_email ?? "").trim() ||
    "";

  let sectionId = (row.org_chart_section_id ?? "").trim() || null;
  let sectionName: string | null = null;

  if (sectionId) {
    sectionName =
      (
        await prisma.orgChartSection.findUnique({
          where: { id: sectionId },
          select: { name: true },
        })
      )?.name?.trim() ?? null;
  }

  const needsAccounting =
    !sectionId || !(sectionName && /\baccounting\b/i.test(sectionName));

  if (needsAccounting && companyTeamId) {
    const defaultSection = await resolveDefaultSendToSectionForBudgetCompany(companyTeamId);
    if (defaultSection?.sectionId) {
      sectionId = defaultSection.sectionId;
      sectionName = defaultSection.sectionName;
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { orgChartSection: { connect: { id: sectionId } } },
      });
      await logActivity(
        ticketId,
        "SYSTEM",
        "Send request to department",
        sectionName,
      );
    }
  }

  let requestorSectionId = (row.requestor_org_chart_section_id ?? "").trim() || null;
  let requestorSectionName: string | null = null;
  if (requestorSectionId) {
    requestorSectionName =
      (
        await prisma.orgChartSection.findUnique({
          where: { id: requestorSectionId },
          select: { name: true },
        })
      )?.name?.trim() ?? null;
  }
  if (!requestorSectionId || !requestorSectionName) {
    const designated = await resolveRequestorDesignatedDepartment({
      agentId: opts.requestorAgentId,
      email: requestorEmail,
    });
    if (designated) {
      requestorSectionId = designated.sectionId;
      requestorSectionName = designated.sectionName;
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          requestorOrgChartSection: { connect: { id: requestorSectionId } },
        },
      });
      await logActivity(
        ticketId,
        "SYSTEM",
        "Requesting department",
        requestorSectionName,
      );
    }
  }

  // Request Budget From (company) + Prepared by Bookkeeper.
  let budgetCompanyName: string | null = null;
  let bookkeeperAgentId: string | null = null;
  let bookkeeperAgentName: string | null = null;
  if (companyTeamId) {
    const company = await prisma.team.findUnique({
      where: { id: companyTeamId },
      select: { id: true, name: true },
    });
    budgetCompanyName = company?.name?.trim() || null;
    if (company?.name) {
      const existingCompanyLog = await prisma.ticketActivity.findFirst({
        where: { ticketId, summary: "Requesting company" },
        select: { id: true },
      });
      if (!existingCompanyLog) {
        await logActivity(ticketId, "SYSTEM", "Requesting company", company.name);
      }
      // Keep ticket team = Request Budget From company.
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { team: { connect: { id: company.id } } },
      });
    }

    const meta = await loadPaymentApprovalMeta(ticketId);
    if (meta) {
      bookkeeperAgentId = meta.accountingAgentId?.trim() || null;
      if (!bookkeeperAgentId) {
        const bookkeeper = await resolveRfpBookkeeperForBudgetCompany({
          companyTeamId,
          sendToSectionId: sectionId,
        });
        if (bookkeeper?.agentId) {
          bookkeeperAgentId = bookkeeper.agentId;
          bookkeeperAgentName = bookkeeper.agentName;
          await savePaymentApprovalMeta(ticketId, {
            ...meta,
            accountingAgentId: bookkeeper.agentId,
          });
          await logActivity(
            ticketId,
            "SYSTEM",
            "Prepared by Bookkeeper",
            `${bookkeeper.agentName}${
              company?.name
                ? ` (from ${company.name}${
                    bookkeeper.sectionName ? ` · ${bookkeeper.sectionName}` : ""
                  })`
                : bookkeeper.sectionName
                  ? ` · ${bookkeeper.sectionName}`
                  : ""
            }`,
          );
        }
      } else {
        const agent = await prisma.agent.findUnique({
          where: { id: bookkeeperAgentId },
          select: { name: true },
        });
        bookkeeperAgentName = agent?.name?.trim() || null;
      }
    }
  }

  // Keep Payee = requestor and rename legacy Travel Order in-payment copy.
  const parsed = parsePaymentRequestDescription(row.description ?? "");
  if (parsed) {
    const nextPayee = requestorName || parsed.payee;
    const nextInPaymentOf =
      /travel\s*order/i.test(parsed.inPaymentOf)
        ? TO_RFP_DEFAULT_IN_PAYMENT_OF
        : parsed.inPaymentOf;
    if (
      nextPayee.trim() !== parsed.payee.trim() ||
      nextInPaymentOf.trim() !== parsed.inPaymentOf.trim()
    ) {
      const nextFields: PaymentRequestFields = {
        ...parsed,
        payee: nextPayee,
        inPaymentOf: nextInPaymentOf,
      };
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          description: formatPaymentRequestDescription(nextFields),
          title: formatPaymentRequestTitle(nextFields),
        },
      });
    }
  }

  return {
    orgChartSectionId: sectionId,
    orgChartSectionName: sectionName,
    requestorOrgChartSectionId: requestorSectionId,
    requestorOrgChartSectionName: requestorSectionName,
    requestBudgetFromCompanyTeamId: companyTeamId || null,
    requestBudgetFromCompanyName: budgetCompanyName,
    bookkeeperAgentId,
    bookkeeperAgentName,
  };
}
