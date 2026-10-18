import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { resolveAgentDesignatedCompanyId } from "@/modules/platform/scope/staff-company-scope";
import { prisma } from "@/modules/platform/db/prisma";
import {
  agentIdsFromApprovalLevels,
  isDesignatedApprover,
  isTravelOrderTraveler,
  isValidLatLng,
  normalizeApprovalLevelsForStore,
} from "@/modules/work-plans/travel-order";
import {
  createTravelOrderWithLocations,
  findTravelOrderById,
  findTravelOrdersByKpiId,
  serializeTravelOrder,
  updateTravelOrderAttachments,
  updateTravelOrderLocationAttachments,
} from "@/modules/work-plans/travel-order-db";
import {
  MAX_TRAVEL_ORDER_ATTACHMENTS,
  persistTravelOrderAttachment,
  persistTravelOrderImage,
} from "@/modules/work-plans/travel-order-uploads";

/** GET /api/kpi-maintenance/:id/travel-orders — list travel orders for a task. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const { id } = await ctx.params;

  const kpi = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: { id: true, assignedAgentId: true },
  });
  if (!kpi) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const rows = await findTravelOrdersByKpiId(id);
  const operatorId = perms.operator?.id ?? null;
  const isStakeholder = Boolean(
    operatorId &&
      rows.some(
        (order) =>
          isDesignatedApprover(operatorId, order) ||
          order.confirmationByAgentId === operatorId ||
          order.createdByAgentId === operatorId ||
          isTravelOrderTraveler(operatorId, order),
      ),
  );
  const companyTeamId = operatorId
    ? await resolveAgentDesignatedCompanyId(operatorId)
    : null;
  const sameCompany = Boolean(
    companyTeamId &&
      rows.some((order) => order.companyTeamId && order.companyTeamId === companyTeamId),
  );
  const canAccess =
    perms.canAssignWork ||
    kpi.assignedAgentId === operatorId ||
    isStakeholder ||
    sameCompany;
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ travelOrders: rows.map(serializeTravelOrder) });
}

type LocationBody = {
  label?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  remarks?: string | null;
};

/** POST /api/kpi-maintenance/:id/travel-orders — create a travel order (admins). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const moduleOff = await moduleDisabledResponse("work_plans");
  if (moduleOff) return moduleOff;
  const perms = await resolveOpsPermissions(session);
  if (!perms.isAdminRole && !perms.canAssignWork) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const kpi = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!kpi) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const contentType = req.headers.get("content-type") || "";
  let orderRequest = "";
  let approvedByAgentIds: string[] = [];
  let approvalLevels: ReturnType<typeof normalizeApprovalLevelsForStore> = [];
  let locations: LocationBody[] = [];
  const pendingFilesByIndex = new Map<number, File[]>();
  const pendingOrderAttachments: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    orderRequest = String(form.get("orderRequest") ?? "").trim();
    const approvedByAgentId = String(form.get("approvedByAgentId") ?? "").trim();
    const approvedByAgentIdsRaw = String(form.get("approvedByAgentIds") ?? "").trim();
    if (approvedByAgentIdsRaw) {
      try {
        const parsed = JSON.parse(approvedByAgentIdsRaw) as unknown;
        if (Array.isArray(parsed)) {
          approvedByAgentIds = parsed
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean);
        }
      } catch {
        return NextResponse.json({ error: "Invalid approvedByAgentIds." }, { status: 400 });
      }
    }
    if (approvedByAgentIds.length === 0 && approvedByAgentId) {
      approvedByAgentIds = [approvedByAgentId];
    }
    const approvalLevelsJson = String(form.get("approvalLevels") ?? "").trim();
    if (approvalLevelsJson) {
      try {
        const parsed = JSON.parse(approvalLevelsJson) as unknown;
        approvalLevels = normalizeApprovalLevelsForStore(Array.isArray(parsed) ? parsed : []);
      } catch {
        return NextResponse.json({ error: "Invalid approvalLevels." }, { status: 400 });
      }
    }
    const rawLocations = String(form.get("locationsJson") ?? "[]");
    try {
      locations = JSON.parse(rawLocations) as LocationBody[];
    } catch {
      return NextResponse.json({ error: "Invalid locationsJson." }, { status: 400 });
    }
    for (const [key, value] of form.entries()) {
      if (!(value instanceof File) || value.size <= 0) continue;
      if (key === "attachment" || key === "attachments") {
        pendingOrderAttachments.push(value);
        continue;
      }
      const match = /^location_(\d+)_image$/.exec(key);
      if (!match) continue;
      const idx = Number(match[1]);
      const list = pendingFilesByIndex.get(idx) ?? [];
      list.push(value);
      pendingFilesByIndex.set(idx, list);
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as {
      orderRequest?: string;
      approvedByAgentId?: string | null;
      approvedByAgentIds?: string[];
      approvalLevels?: Array<{ level?: number; agentId?: string | null }>;
      locations?: LocationBody[];
    };
    orderRequest = String(body.orderRequest ?? "").trim();
    if (Array.isArray(body.approvedByAgentIds)) {
      approvedByAgentIds = body.approvedByAgentIds
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    const approvedByAgentId = String(body.approvedByAgentId ?? "").trim();
    if (approvedByAgentIds.length === 0 && approvedByAgentId) {
      approvedByAgentIds = [approvedByAgentId];
    }
    if (Array.isArray(body.approvalLevels)) {
      approvalLevels = normalizeApprovalLevelsForStore(body.approvalLevels);
    }
    locations = Array.isArray(body.locations) ? body.locations : [];
  }

  if (approvalLevels.length > 0) {
    for (const lvl of approvalLevels) {
      if (!lvl.agentId) {
        return NextResponse.json(
          { error: `Assign an approver for Level ${lvl.level}.` },
          { status: 400 },
        );
      }
    }
    approvedByAgentIds = agentIdsFromApprovalLevels(approvalLevels);
  }

  if (!orderRequest) {
    return NextResponse.json({ error: "Order request details are required." }, { status: 400 });
  }
  if (approvedByAgentIds.length === 0) {
    return NextResponse.json({ error: "Select at least one approver." }, { status: 400 });
  }
  const approvers = await prisma.agent.findMany({
    where: { id: { in: approvedByAgentIds } },
    select: { id: true },
  });
  if (approvers.length !== approvedByAgentIds.length) {
    return NextResponse.json({ error: "One or more approved-by users were not found." }, { status: 400 });
  }
  if (!Array.isArray(locations) || locations.length === 0) {
    return NextResponse.json({ error: "Add at least one location." }, { status: 400 });
  }

  const normalizedLocations: Array<{
    label: string;
    latitude: number | null;
    longitude: number | null;
    remarks: string | null;
    sortOrder: number;
  }> = [];

  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i] ?? {};
    const label = String(loc.label ?? "").trim();
    if (!label) {
      return NextResponse.json({ error: `Location ${i + 1}: name/address is required.` }, { status: 400 });
    }
    const latRaw = loc.latitude;
    const lngRaw = loc.longitude;
    const latitude =
      latRaw == null || (typeof latRaw === "string" && latRaw.trim() === "")
        ? null
        : Number(latRaw);
    const longitude =
      lngRaw == null || (typeof lngRaw === "string" && lngRaw.trim() === "")
        ? null
        : Number(lngRaw);
    if (
      (latitude != null || longitude != null) &&
      !isValidLatLng(latitude, longitude)
    ) {
      return NextResponse.json(
        { error: `Location ${i + 1}: GPS coordinates are invalid.` },
        { status: 400 },
      );
    }
    normalizedLocations.push({
      label,
      latitude,
      longitude,
      remarks: typeof loc.remarks === "string" && loc.remarks.trim() ? loc.remarks.trim() : null,
      sortOrder: i,
    });
  }

  const createdBy =
    typeof session.user?.email === "string" && session.user.email.trim()
      ? session.user.email.trim()
      : typeof session.user?.name === "string"
        ? session.user.name
        : "admin";

  let created;
  try {
    created = await createTravelOrderWithLocations({
      kpiMaintenanceId: id,
      orderRequest,
      approvedByAgentIds,
      approvalLevels,
      createdBy,
      status: "SUBMITTED",
      locations: normalizedLocations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create the travel order.";
    console.error("[travel-orders] create failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (pendingFilesByIndex.size > 0 || pendingOrderAttachments.length > 0) {
    const locs = [...created.locations].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < locs.length; i++) {
      const files = pendingFilesByIndex.get(i) ?? [];
      if (files.length === 0) continue;
      const loc = locs[i]!;
      const uploaded = [];
      for (const file of files.slice(0, 5)) {
        const saved = await persistTravelOrderImage(id, created.id, file);
        if ("error" in saved) {
          return NextResponse.json({ error: saved.error }, { status: 400 });
        }
        uploaded.push(saved);
      }
      await updateTravelOrderLocationAttachments(loc.id, [
        ...loc.attachments,
        ...uploaded,
      ]);
    }

    if (pendingOrderAttachments.length > 0) {
      if (pendingOrderAttachments.length > MAX_TRAVEL_ORDER_ATTACHMENTS) {
        return NextResponse.json(
          { error: `You can attach at most ${MAX_TRAVEL_ORDER_ATTACHMENTS} files.` },
          { status: 400 },
        );
      }
      const uploaded = [];
      for (const file of pendingOrderAttachments.slice(0, MAX_TRAVEL_ORDER_ATTACHMENTS)) {
        const saved = await persistTravelOrderAttachment(id, created.id, file);
        if ("error" in saved) {
          return NextResponse.json({ error: saved.error }, { status: 400 });
        }
        uploaded.push(saved);
      }
      await updateTravelOrderAttachments(created.id, [
        ...(created.attachments ?? []),
        ...uploaded,
      ]);
    }
  }

  const fresh =
    pendingFilesByIndex.size > 0 || pendingOrderAttachments.length > 0
      ? await findTravelOrderById(created.id)
      : created;
  if (!fresh) {
    return NextResponse.json({ error: "Travel order could not be loaded after create." }, { status: 500 });
  }
  return NextResponse.json({ travelOrder: serializeTravelOrder(fresh) }, { status: 201 });
}
