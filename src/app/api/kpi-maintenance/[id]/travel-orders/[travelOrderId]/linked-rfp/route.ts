import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/lib/prisma";
import {
  formatPaymentRequestDescription,
  formatPaymentRequestTitle,
  normalizePaymentAmountInput,
  parsePaymentRequestDescription,
  validatePaymentModeFields,
} from "@/lib/request-for-payment";
import { loadPaymentApprovalMeta, savePaymentApprovalMeta } from "@/lib/payment-approval-db";
import { logActivity } from "@/lib/ticket-actions";
import { findTravelOrderById, type TravelOrderRow } from "@/lib/travel-order-db";
import {
  createRfpFromSubmittedTravelOrder,
  findLinkedRfpByTravelOrderId,
} from "@/lib/travel-order-rfp";
import { TO_RFP_DEFAULT_IN_PAYMENT_OF } from "@/lib/travel-order-rfp-constants";
import { resolveRfpBookkeeperForBudgetCompany, resolveDefaultSendToSectionForBudgetCompany } from "@/lib/intake-approval-recommendations";

async function loadOrderForLinkedRfp(
  kpiId: string,
  travelOrderId: string,
): Promise<{ order: TravelOrderRow } | { error: NextResponse }> {
  const order = await findTravelOrderById(travelOrderId);
  if (!order || order.kpiMaintenanceId !== kpiId) {
    return { error: NextResponse.json({ error: "Travel order not found." }, { status: 404 }) };
  }
  return { order };
}

function canManageLinkedRfp(opts: {
  isCreator: boolean;
  canAssignWork: boolean;
  role: string;
}): boolean {
  if (opts.isCreator || opts.canAssignWork) return true;
  return ["SuperAdmin", "HighAdmin", "Admin"].includes(opts.role);
}

function travelOrderCreatorName(order: TravelOrderRow): string {
  return (
    (order.createdByAgent?.name ?? "").trim() ||
    (order.createdBy ?? "").trim() ||
    "Requestor"
  );
}

async function resolveBookkeeperForCompany(
  companyTeamId: string | null | undefined,
  sendToSectionId?: string | null,
): Promise<{ id: string; name: string; sectionId: string; sectionName: string | null } | null> {
  const teamId = (companyTeamId ?? "").trim();
  if (!teamId) return null;
  const resolved = await resolveRfpBookkeeperForBudgetCompany({
    companyTeamId: teamId,
    sendToSectionId,
  });
  if (!resolved) return null;
  return {
    id: resolved.agentId,
    name: resolved.agentName,
    sectionId: resolved.sectionId,
    sectionName: resolved.sectionName,
  };
}

async function linkedRfpPayload(opts: {
  order: TravelOrderRow;
  linked: { id: string; ticketNumber: string; title: string; awaitingTravelOrderApproval: boolean };
  previewCompanyTeamId?: string | null;
  previewSendToSectionId?: string | null;
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: opts.linked.id },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      description: true,
      status: true,
      teamId: true,
      orgChartSectionId: true,
      contactName: true,
      contactEmail: true,
    },
  });
  if (!ticket) return null;

  const meta = await loadPaymentApprovalMeta(ticket.id);
  const requestBudgetFromCompanyTeamId =
    (opts.previewCompanyTeamId ?? "").trim() ||
    (ticket.teamId ?? "").trim() ||
    (opts.order.companyTeamId ?? "").trim() ||
    "";
  const companyChanged =
    Boolean((opts.previewCompanyTeamId ?? "").trim()) &&
    (opts.previewCompanyTeamId ?? "").trim() !== (ticket.teamId ?? "").trim();
  // TO-RFPs keep their defaulted Accounting section unless the budget company changes.
  const sendToSectionId = companyChanged
    ? ""
    : (ticket.orgChartSectionId ?? "").trim() ||
      (opts.previewSendToSectionId ?? "").trim() ||
      "";

  let companyName: string | null = null;
  if (requestBudgetFromCompanyTeamId) {
    const team = await prisma.team.findUnique({
      where: { id: requestBudgetFromCompanyTeamId },
      select: { name: true },
    });
    companyName = team?.name ?? null;
  }

  // TO-linked RFPs are assumed to already live on the default Accounting
  // section — prefer the ticket's stored section, else auto-default for company.
  const resolvedBookkeeper = requestBudgetFromCompanyTeamId
    ? await resolveBookkeeperForCompany(requestBudgetFromCompanyTeamId, sendToSectionId || null)
    : null;
  const defaultSection =
    !sendToSectionId && requestBudgetFromCompanyTeamId
      ? await resolveDefaultSendToSectionForBudgetCompany(requestBudgetFromCompanyTeamId)
      : null;

  const bookkeeper =
    (!opts.previewCompanyTeamId &&
      meta?.accountingAgentId &&
      (await prisma.agent.findUnique({
        where: { id: meta.accountingAgentId },
        select: { id: true, name: true },
      }))) ||
    (resolvedBookkeeper
      ? { id: resolvedBookkeeper.id, name: resolvedBookkeeper.name }
      : null);

  const paymentFieldsRaw = parsePaymentRequestDescription(ticket.description);
  const requestorName = travelOrderCreatorName(opts.order);
  const paymentFields = paymentFieldsRaw
    ? {
        ...paymentFieldsRaw,
        // TO-linked RFPs always use the Travel Order requestor as Payee.
        payee: requestorName,
      }
    : null;

  const branchActivity = await prisma.ticketActivity.findFirst({
    where: { ticketId: ticket.id, summary: "Branch" },
    orderBy: { createdAt: "desc" },
    select: { detail: true },
  });
  const branch = (branchActivity?.detail ?? "").trim() || null;

  return {
    linkedRfp: {
      ...opts.linked,
      status: ticket.status,
      contactName: requestorName,
      contactEmail: ticket.contactEmail,
      awaitingTravelOrderApproval: meta?.awaitingTravelOrderApproval === true,
    },
    paymentFields,
    deferPaymentModeToAccounting: meta?.deferPaymentModeToAccounting === true,
    requestBudgetFromCompanyTeamId: requestBudgetFromCompanyTeamId || null,
    requestBudgetFromCompanyName: companyName,
    branch,
    sendToOrgChartSectionId:
      sendToSectionId ||
      resolvedBookkeeper?.sectionId ||
      defaultSection?.sectionId ||
      ticket.orgChartSectionId ||
      null,
    bookkeeper: bookkeeper
      ? {
          id: bookkeeper.id,
          name: bookkeeper.name,
          sectionId: resolvedBookkeeper?.sectionId ?? null,
          sectionName: resolvedBookkeeper?.sectionName ?? null,
        }
      : null,
  };
}

/**
 * GET — load linked RFP summary + payment fields for the travel order.
 * Optional `requestBudgetFromCompanyTeamId` query previews bookkeeper for a company.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; travelOrderId: string }> },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const { id, travelOrderId } = await ctx.params;
  const previewCompanyId =
    new URL(req.url).searchParams.get("requestBudgetFromCompanyTeamId")?.trim() || "";
  const previewSendToSectionId =
    new URL(req.url).searchParams.get("sendToOrgChartSectionId")?.trim() || "";

  const loaded = await loadOrderForLinkedRfp(id, travelOrderId);
  if ("error" in loaded) return loaded.error;
  const { order } = loaded;

  const linked = await findLinkedRfpByTravelOrderId(order.id);
  if (!linked) {
    const previewBookkeeper = previewCompanyId
      ? await resolveBookkeeperForCompany(previewCompanyId, previewSendToSectionId || null)
      : null;
    return NextResponse.json({
      linkedRfp: null,
      paymentFields: null,
      requestedByName: travelOrderCreatorName(order),
      requestBudgetFromCompanyTeamId:
        previewCompanyId || order.companyTeamId || null,
      sendToOrgChartSectionId:
        previewSendToSectionId || previewBookkeeper?.sectionId || null,
      bookkeeper: previewBookkeeper
        ? {
            id: previewBookkeeper.id,
            name: previewBookkeeper.name,
            sectionId: previewBookkeeper.sectionId,
            sectionName: previewBookkeeper.sectionName,
          }
        : null,
    });
  }

  const payload = await linkedRfpPayload({
    order,
    linked,
    previewCompanyTeamId: previewCompanyId || null,
    previewSendToSectionId: previewSendToSectionId || null,
  });
  if (!payload) {
    return NextResponse.json({ linkedRfp: null, paymentFields: null });
  }
  return NextResponse.json(payload);
}

/**
 * POST — create linked RFP if missing (retry after soft-fail on TO submit).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; travelOrderId: string }> },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId } = await ctx.params;

  const loaded = await loadOrderForLinkedRfp(id, travelOrderId);
  if ("error" in loaded) return loaded.error;
  const { order } = loaded;
  const isCreator = Boolean(perms.operator?.id && order.createdByAgentId === perms.operator.id);

  if (
    !canManageLinkedRfp({
      isCreator,
      canAssignWork: perms.canAssignWork,
      role: session.user.role,
    })
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const linkedRfp = await createRfpFromSubmittedTravelOrder(order);
    const budgetCompanyId = (order.companyTeamId ?? "").trim() || null;
    if (budgetCompanyId) {
      const bookkeeper = await resolveBookkeeperForCompany(budgetCompanyId);
      const defaultSection =
        bookkeeper?.sectionId
          ? { sectionId: bookkeeper.sectionId, sectionName: bookkeeper.sectionName }
          : await resolveDefaultSendToSectionForBudgetCompany(budgetCompanyId);
      if (bookkeeper) {
        const meta = await loadPaymentApprovalMeta(linkedRfp.id);
        if (meta) {
          await savePaymentApprovalMeta(linkedRfp.id, {
            ...meta,
            accountingAgentId: bookkeeper.id,
          });
        }
      }
      if (defaultSection?.sectionId) {
        await prisma.$executeRaw`
          UPDATE tickets
          SET org_chart_section_id = ${defaultSection.sectionId}
          WHERE id = ${linkedRfp.id}
        `;
      }
    }
    const payload = await linkedRfpPayload({ order, linked: linkedRfp });
    return NextResponse.json(payload ?? { linkedRfp }, { status: 201 });
  } catch (err) {
    console.error("[linked-rfp] create failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create Request for Payment." },
      { status: 500 },
    );
  }
}

/**
 * PATCH — update payment fields while the RFP is held awaiting TO approval.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; travelOrderId: string }> },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId } = await ctx.params;

  const loaded = await loadOrderForLinkedRfp(id, travelOrderId);
  if ("error" in loaded) return loaded.error;
  const { order } = loaded;
  const isCreator = Boolean(perms.operator?.id && order.createdByAgentId === perms.operator.id);

  if (
    !canManageLinkedRfp({
      isCreator,
      canAssignWork: perms.canAssignWork,
      role: session.user.role,
    })
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let linked = await findLinkedRfpByTravelOrderId(order.id);
  if (!linked) {
    try {
      linked = await createRfpFromSubmittedTravelOrder(order);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Linked RFP not found." },
        { status: 404 },
      );
    }
  }

  const meta = await loadPaymentApprovalMeta(linked.id);
  const held = meta?.awaitingTravelOrderApproval === true;
  if (!held) {
    return NextResponse.json(
      {
        error:
          "Request for Payment is released for approval and can only be edited from the ticket workspace.",
      },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Payee is always the Travel Order requestor for linked RFPs.
  const payee = travelOrderCreatorName(order);
  const inPaymentOf =
    typeof body.inPaymentOf === "string" && body.inPaymentOf.trim()
      ? body.inPaymentOf.trim()
      : TO_RFP_DEFAULT_IN_PAYMENT_OF;
  const accountTitle = typeof body.accountTitle === "string" ? body.accountTitle.trim() : "";
  const amountRaw = typeof body.amount === "string" ? body.amount.trim() : "";
  const amount = normalizePaymentAmountInput(amountRaw) || amountRaw;
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const modeOfPayment = typeof body.modeOfPayment === "string" ? body.modeOfPayment.trim() : "";
  const deliveryOfCheck =
    typeof body.deliveryOfCheck === "string" ? body.deliveryOfCheck.trim() : "";
  const bankNameAccountNumber =
    typeof body.bankNameAccountNumber === "string" ? body.bankNameAccountNumber.trim() : "";
  const deferPaymentModeToAccounting = body.deferPaymentModeToAccounting === true;
  const requestBudgetFromCompanyTeamId =
    typeof body.requestBudgetFromCompanyTeamId === "string"
      ? body.requestBudgetFromCompanyTeamId.trim()
      : "";
  const sendToOrgChartSectionId =
    typeof body.sendToOrgChartSectionId === "string"
      ? body.sendToOrgChartSectionId.trim()
      : "";
  const branch =
    typeof body.branch === "string" ? body.branch.trim().slice(0, 120) : "";

  if (!payee || !inPaymentOf || !amount) {
    return NextResponse.json(
      { error: "Payee, In payment of, and Amount are required." },
      { status: 400 },
    );
  }
  if (!requestBudgetFromCompanyTeamId) {
    return NextResponse.json(
      { error: "Request Budget From (company) is required." },
      { status: 400 },
    );
  }

  const company = await prisma.team.findUnique({
    where: { id: requestBudgetFromCompanyTeamId },
    select: { id: true, name: true },
  });
  if (!company) {
    return NextResponse.json({ error: "Invalid company selection." }, { status: 400 });
  }

  let modeFields = {
    modeOfPayment: "",
    deliveryOfCheck: "",
    bankNameAccountNumber: "",
  };
  if (!deferPaymentModeToAccounting) {
    const modeValidated = validatePaymentModeFields({
      modeOfPayment,
      deliveryOfCheck,
      bankNameAccountNumber,
    });
    if (!modeValidated.ok) {
      return NextResponse.json({ error: modeValidated.error }, { status: 400 });
    }
    modeFields = {
      modeOfPayment: modeValidated.fields.modeOfPayment,
      deliveryOfCheck: modeValidated.fields.deliveryOfCheck ?? "",
      bankNameAccountNumber: modeValidated.fields.bankNameAccountNumber ?? "",
    };
  }

  const fields = {
    payee,
    inPaymentOf,
    accountTitle,
    amount,
    modeOfPayment: modeFields.modeOfPayment,
    deliveryOfCheck: modeFields.deliveryOfCheck,
    bankNameAccountNumber: modeFields.bankNameAccountNumber,
    notes: notes || undefined,
  };
  const description = formatPaymentRequestDescription(fields);
  const title = formatPaymentRequestTitle(fields);
  const requestedBy = travelOrderCreatorName(order);

  // Prefer the ticket's already-defaulted section; otherwise auto Accounting.
  const existingTicket = await prisma.ticket.findUnique({
    where: { id: linked.id },
    select: { orgChartSectionId: true },
  });
  const preferredSectionId =
    sendToOrgChartSectionId ||
    (existingTicket?.orgChartSectionId ?? "").trim() ||
    null;
  const bookkeeper = await resolveBookkeeperForCompany(company.id, preferredSectionId);
  const defaultSection =
    bookkeeper?.sectionId
      ? { sectionId: bookkeeper.sectionId, sectionName: bookkeeper.sectionName }
      : preferredSectionId
        ? {
            sectionId: preferredSectionId,
            sectionName: null as string | null,
          }
        : await resolveDefaultSendToSectionForBudgetCompany(company.id);
  const effectiveSendToSectionId = defaultSection?.sectionId || null;

  await prisma.ticket.update({
    where: { id: linked.id },
    data: {
      description,
      title,
      contactName: requestedBy,
      team: { connect: { id: company.id } },
      ...(effectiveSendToSectionId
        ? { orgChartSection: { connect: { id: effectiveSendToSectionId } } }
        : {}),
    },
  });

  if (meta) {
    await savePaymentApprovalMeta(linked.id, {
      ...meta,
      deferPaymentModeToAccounting,
      accountingAgentId: bookkeeper?.id ?? meta.accountingAgentId,
    });
  }

  await logActivity(linked.id, "USER", "Requesting company", company.name);
  if (branch) {
    await logActivity(linked.id, "USER", "Branch", branch);
  }
  if (bookkeeper) {
    await logActivity(
      linked.id,
      "SYSTEM",
      "Prepared by Bookkeeper",
      `${bookkeeper.name} (from ${company.name}${
        bookkeeper.sectionName ? ` · ${bookkeeper.sectionName}` : ""
      })`,
    );
  }

  await logActivity(
    linked.id,
    "AGENT",
    "Payment request updated",
    "Fields updated from the linked Work Plan Request for Payment editor.",
  );

  if (effectiveSendToSectionId && defaultSection?.sectionName) {
    await logActivity(
      linked.id,
      "SYSTEM",
      "Send request to department",
      defaultSection.sectionName,
    );
  } else if (effectiveSendToSectionId) {
    const section = await prisma.orgChartSection.findUnique({
      where: { id: effectiveSendToSectionId },
      select: { name: true },
    });
    if (section?.name) {
      await logActivity(linked.id, "SYSTEM", "Send request to department", section.name);
    }
  }

  const payload = await linkedRfpPayload({ order, linked });
  return NextResponse.json(
    payload ?? {
      linkedRfp: linked,
      paymentFields: fields,
      deferPaymentModeToAccounting,
      requestBudgetFromCompanyTeamId: company.id,
      requestBudgetFromCompanyName: company.name,
      sendToOrgChartSectionId: effectiveSendToSectionId,
      bookkeeper,
    },
  );
}
