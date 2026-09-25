import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/lib/prisma";
import { isPersonnelGuardPortalRole } from "@/lib/staff-role";
import {
  TRAVEL_ORDER_STATUS,
  canApproveTravelOrderNow,
  canCancelTravelOrderNow,
  canConfirmTravelOrderNow,
  getOperatorActionableApprovalLevel,
  hasHierarchicalApprovals,
  isTravelOrderApproved,
  isTravelOrderConfirmReady,
  isTravelOrderTraveler,
  isValidLatLng,
  parseOptionalDateTimeInput,
  travelOrderHasGatePass,
  validateTravelOrderGatePass,
  emptyGatePassDraft,
  gatePassDraftHasAnyData,
  type TravelOrderGatePassDraft,
} from "@/lib/travel-order";
import { isWorkPlanOrder, workPlanUsesGatePass } from "@/lib/work-plan";
import {
  approveTravelOrderSequential,
  findTravelOrderById,
  serializeTravelOrder,
  updateTravelOrderGatePass,
  updateTravelOrderStatus,
} from "@/lib/travel-order-db";
import { releaseRfpAfterTravelOrderApproved } from "@/lib/travel-order-rfp";
import { triggerTravelOrderConfirmedSideEffects } from "@/lib/sync/travel-order-confirm-side-effects";

/**
 * PATCH /api/kpi-maintenance/:id/travel-orders/:travelOrderId
 * Approve (flat or sequential level) / confirm / reject / update status.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; travelOrderId: string }> },
) {
  const { session, unauthorized } = await requireRole([
    "Admin",
    "Personnel",
    "Personnel-Guard",
  ]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId } = await ctx.params;
  const isGuard = isPersonnelGuardPortalRole(session.user.role);

  const kpi = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: { id: true, assignedAgentId: true },
  });
  if (!kpi) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const order = await findTravelOrderById(travelOrderId);
  if (!order || order.kpiMaintenanceId !== id) {
    return NextResponse.json({ error: "Travel order not found." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    status?: string;
    action?: string;
    rejectionReason?: string;
    gatePass?: Partial<TravelOrderGatePassDraft> & {
      visitAction?: "start" | "end";
      latitude?: number;
      longitude?: number;
      capturedAt?: string;
    };
  };
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const statusRaw = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  const operatorId = perms.operator?.id ?? null;
  const canAssignWork = Boolean(perms.canAssignWork);
  const workPlan = isWorkPlanOrder(order);
  const workPlanGatePass = workPlanUsesGatePass(order);

  if (
    workPlan &&
    (action === "gate-pass" || action === "gate-pass-visit") &&
    !workPlanGatePass
  ) {
    return NextResponse.json(
      {
        error: "Gate Pass is only available on Travel Orders that include travel.",
      },
      { status: 400 },
    );
  }

  if (isGuard && action !== "gate-pass-visit") {
    return NextResponse.json(
      { error: "Personnel-Guard can only record Gate Pass Start/End." },
      { status: 403 },
    );
  }

  if (action === "gate-pass" || action === "gate-pass-visit") {
    const isTraveler = isTravelOrderTraveler(operatorId, order);
    if (action === "gate-pass-visit" && isGuard) {
      if (!travelOrderHasGatePass(order) && !workPlanGatePass) {
        return NextResponse.json(
          { error: "Gate Pass Start/End is only available on orders with a Gate Pass." },
          { status: 403 },
        );
      }
    } else if (!canAssignWork && !isTraveler) {
      return NextResponse.json(
        { error: "Only travelers (or an admin) can update Gate Pass details." },
        { status: 403 },
      );
    }

    if (action === "gate-pass-visit") {
      if (!isTravelOrderApproved(order.status)) {
        return NextResponse.json(
          {
            error:
              "Actual departure and arrival can only be captured after the travel order is fully approved.",
          },
          { status: 403 },
        );
      }
      const visitAction = body.gatePass?.visitAction;
      if (visitAction !== "start" && visitAction !== "end") {
        return NextResponse.json({ error: "Provide visitAction start or end." }, { status: 400 });
      }
      const capturedAt = parseOptionalDateTimeInput(body.gatePass?.capturedAt) ?? new Date();
      const lat =
        typeof body.gatePass?.latitude === "number" && Number.isFinite(body.gatePass.latitude)
          ? body.gatePass.latitude
          : null;
      const lng =
        typeof body.gatePass?.longitude === "number" && Number.isFinite(body.gatePass.longitude)
          ? body.gatePass.longitude
          : null;
      if (!isValidLatLng(lat, lng)) {
        return NextResponse.json(
          {
            error:
              "Could not capture a valid GPS position for Gate Pass. Allow location access and try again.",
          },
          { status: 400 },
        );
      }
      const startGuardOnDuty =
        typeof body.gatePass?.startGuardOnDuty === "string"
          ? body.gatePass.startGuardOnDuty
          : undefined;
      const endGuardOnDuty =
        typeof body.gatePass?.endGuardOnDuty === "string"
          ? body.gatePass.endGuardOnDuty
          : undefined;
      try {
        const updated = await updateTravelOrderGatePass({
          travelOrderId,
          kpiMaintenanceId: id,
          included: true,
          visitAction,
          actualDepartureStartedAt: visitAction === "start" ? capturedAt : undefined,
          actualDepartureStartedLatitude: visitAction === "start" ? lat : undefined,
          actualDepartureStartedLongitude: visitAction === "start" ? lng : undefined,
          gatePassStartGuardOnDuty: visitAction === "start" ? startGuardOnDuty : undefined,
          actualDepartureEndedAt: visitAction === "end" ? capturedAt : undefined,
          actualDepartureEndedLatitude: visitAction === "end" ? lat : undefined,
          actualDepartureEndedLongitude: visitAction === "end" ? lng : undefined,
          gatePassEndGuardOnDuty: visitAction === "end" ? endGuardOnDuty : undefined,
        });
        if (!updated) {
          return NextResponse.json({ error: "Travel order could not be updated." }, { status: 500 });
        }
        return NextResponse.json({ travelOrder: serializeTravelOrder(updated) });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not update Gate Pass.";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const raw = body.gatePass ?? {};
    const draft: TravelOrderGatePassDraft = {
      ...emptyGatePassDraft(),
      included: raw.included !== false,
      estDepartureAt: typeof raw.estDepartureAt === "string" ? raw.estDepartureAt : "",
      estArrivalAt: typeof raw.estArrivalAt === "string" ? raw.estArrivalAt : "",
      actualDepartureStartedAt:
        typeof raw.actualDepartureStartedAt === "string" ? raw.actualDepartureStartedAt : null,
      actualDepartureStartedLatitude:
        typeof raw.actualDepartureStartedLatitude === "number"
          ? raw.actualDepartureStartedLatitude
          : null,
      actualDepartureStartedLongitude:
        typeof raw.actualDepartureStartedLongitude === "number"
          ? raw.actualDepartureStartedLongitude
          : null,
      actualDepartureEndedAt:
        typeof raw.actualDepartureEndedAt === "string" ? raw.actualDepartureEndedAt : null,
      actualDepartureEndedLatitude:
        typeof raw.actualDepartureEndedLatitude === "number"
          ? raw.actualDepartureEndedLatitude
          : null,
      actualDepartureEndedLongitude:
        typeof raw.actualDepartureEndedLongitude === "number"
          ? raw.actualDepartureEndedLongitude
          : null,
      startGuardOnDuty: typeof raw.startGuardOnDuty === "string" ? raw.startGuardOnDuty : "",
      endGuardOnDuty: typeof raw.endGuardOnDuty === "string" ? raw.endGuardOnDuty : "",
    };
    if (!draft.included && !gatePassDraftHasAnyData(draft)) {
      draft.included = false;
    } else {
      draft.included = true;
    }
    const gateErr = validateTravelOrderGatePass(draft);
    if (gateErr) {
      return NextResponse.json({ error: gateErr }, { status: 400 });
    }
    try {
      const updated = await updateTravelOrderGatePass({
        travelOrderId,
        kpiMaintenanceId: id,
        included: draft.included,
        estDepartureAt: parseOptionalDateTimeInput(draft.estDepartureAt),
        estArrivalAt: parseOptionalDateTimeInput(draft.estArrivalAt),
        // Estimates / Guard edits must never overwrite captured Actual Departure GPS.
        gatePassStartGuardOnDuty: draft.startGuardOnDuty,
        gatePassEndGuardOnDuty: draft.endGuardOnDuty,
      });
      if (!updated) {
        return NextResponse.json({ error: "Travel order could not be updated." }, { status: 500 });
      }
      return NextResponse.json({ travelOrder: serializeTravelOrder(updated) });
    } catch (err) {
      console.error("[travel-orders] gate-pass update failed:", err);
      return NextResponse.json({ error: "Could not update Gate Pass." }, { status: 500 });
    }
  }

  // Sequential / flat approve via action or APPROVED status.
  if (action === "approve-level" || statusRaw === TRAVEL_ORDER_STATUS.APPROVED) {
    try {
      const updated = await approveTravelOrderSequential({
        travelOrderId,
        kpiMaintenanceId: id,
        operatorAgentId: operatorId,
        canAssignWork,
      });
      if (
        updated.status === TRAVEL_ORDER_STATUS.APPROVED &&
        order.status !== TRAVEL_ORDER_STATUS.APPROVED
      ) {
        try {
          await releaseRfpAfterTravelOrderApproved(updated.id);
        } catch (err) {
          console.error("[travel-orders] release linked RFP failed:", err);
        }
      }
      return NextResponse.json({ travelOrder: serializeTravelOrder(updated) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not approve travel order.";
      const status =
        message.includes("Only") || message.includes("designated") || message.includes("approver")
          ? 403
          : message.includes("not found")
            ? 404
            : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (action === "reject" || statusRaw === TRAVEL_ORDER_STATUS.REJECTED) {
    const canRejectAsApprover = canApproveTravelOrderNow(operatorId, order, { canAssignWork });
    const canRejectAsConfirmer = canConfirmTravelOrderNow(operatorId, order, { canAssignWork });
    if (!canRejectAsApprover && !canRejectAsConfirmer) {
      return NextResponse.json(
        {
          error:
            "Only the current assigned approver or confirmer can decline this travel order.",
        },
        { status: 403 },
      );
    }
    const rejectionReason =
      typeof body.rejectionReason === "string" ? body.rejectionReason.trim() : "";
    if (!rejectionReason) {
      return NextResponse.json(
        { error: "Please provide a reason for declining this travel order." },
        { status: 400 },
      );
    }
    if (rejectionReason.length > 2000) {
      return NextResponse.json(
        { error: "Decline reason must be 2000 characters or fewer." },
        { status: 400 },
      );
    }
    try {
      const rejectedAtLevel = canRejectAsApprover
        ? hasHierarchicalApprovals(order.approvalLevels ?? [])
          ? (getOperatorActionableApprovalLevel(order.approvalLevels ?? [], operatorId, {
              canAssignWork,
            })?.level ?? null)
          : null
        : null;
      const updated = await updateTravelOrderStatus({
        travelOrderId,
        kpiMaintenanceId: id,
        status: TRAVEL_ORDER_STATUS.REJECTED,
        rejectionReason,
        rejectedByAgentId: operatorId,
        rejectedAtLevel,
      });
      if (!updated) {
        return NextResponse.json({ error: "Travel order could not be updated." }, { status: 500 });
      }
      return NextResponse.json({ travelOrder: serializeTravelOrder(updated) });
    } catch (err) {
      console.error("[travel-orders] reject failed:", err);
      return NextResponse.json({ error: "Could not decline travel order." }, { status: 500 });
    }
  }

  if (action === "cancel" || statusRaw === TRAVEL_ORDER_STATUS.CANCELLED) {
    if (!canCancelTravelOrderNow(operatorId, order)) {
      return NextResponse.json(
        {
          error:
            "Only the person who created this travel order can cancel it, and only before it is confirmed.",
        },
        { status: 403 },
      );
    }
    try {
      const updated = await updateTravelOrderStatus({
        travelOrderId,
        kpiMaintenanceId: id,
        status: TRAVEL_ORDER_STATUS.CANCELLED,
      });
      if (!updated) {
        return NextResponse.json({ error: "Travel order could not be updated." }, { status: 500 });
      }
      return NextResponse.json({ travelOrder: serializeTravelOrder(updated) });
    } catch (err) {
      console.error("[travel-orders] cancel failed:", err);
      return NextResponse.json({ error: "Could not cancel travel order." }, { status: 500 });
    }
  }

  if (!statusRaw) {
    return NextResponse.json({ error: "Provide status." }, { status: 400 });
  }

  if (
    statusRaw !== TRAVEL_ORDER_STATUS.CONFIRMED &&
    statusRaw !== TRAVEL_ORDER_STATUS.SUBMITTED
  ) {
    return NextResponse.json({ error: "Invalid travel order status." }, { status: 400 });
  }

  try {
    if (statusRaw === TRAVEL_ORDER_STATUS.CONFIRMED) {
      if (!canConfirmTravelOrderNow(operatorId, order, { canAssignWork })) {
        if (order.status !== TRAVEL_ORDER_STATUS.APPROVED) {
          return NextResponse.json(
            { error: "Only a running (approved) travel order can be confirmed." },
            { status: 400 },
          );
        }
        if (!order.confirmationByAgentId) {
          return NextResponse.json(
            { error: "This travel order has no confirmation person assigned." },
            { status: 400 },
          );
        }
        return NextResponse.json(
          { error: "Only the designated confirmer can confirm this travel order." },
          { status: 403 },
        );
      }
      if (!isTravelOrderConfirmReady(order)) {
        return NextResponse.json(
          {
            error: isWorkPlanOrder(order)
              ? "Confirm unlocks after every approver has signed."
              : travelOrderHasGatePass(order)
                ? "Confirm unlocks after Gate Pass Actual Arrival End is captured."
                : "Confirm unlocks after every location visit is completed.",
          },
          { status: 400 },
        );
      }
    }

    const updated = await updateTravelOrderStatus({
      travelOrderId,
      kpiMaintenanceId: id,
      status: statusRaw,
    });
    if (!updated) {
      return NextResponse.json({ error: "Travel order could not be updated." }, { status: 500 });
    }
    if (statusRaw === TRAVEL_ORDER_STATUS.CONFIRMED) {
      triggerTravelOrderConfirmedSideEffects(updated);
    }
    return NextResponse.json({ travelOrder: serializeTravelOrder(updated) });
  } catch (err) {
    console.error("[travel-orders] update failed:", err);
    return NextResponse.json({ error: "Could not update travel order." }, { status: 500 });
  }
}
