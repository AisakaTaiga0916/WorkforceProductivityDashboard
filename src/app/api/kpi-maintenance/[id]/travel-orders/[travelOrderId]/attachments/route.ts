import { unlink } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";
import {
  isTravelOrderApproved,
  isTravelOrderTraveler,
  MAX_TRAVEL_ORDER_ATTACHMENTS,
} from "@/modules/work-plans/travel-order";
import {
  findTravelOrderById,
  serializeTravelOrder,
  updateTravelOrderAttachments,
} from "@/modules/work-plans/travel-order-db";
import {
  persistTravelOrderAttachment,
  travelOrderUploadDir,
} from "@/modules/work-plans/travel-order-uploads";

async function loadOrderForTravelerAttachments(
  sessionPerms: Awaited<ReturnType<typeof resolveOpsPermissions>>,
  id: string,
  travelOrderId: string,
) {
  const kpi = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: { id: true, assignedAgentId: true },
  });
  if (!kpi) return { error: NextResponse.json({ error: "Task not found." }, { status: 404 }) };

  const order = await findTravelOrderById(travelOrderId);
  if (!order || order.kpiMaintenanceId !== id) {
    return { error: NextResponse.json({ error: "Travel order not found." }, { status: 404 }) };
  }

  const operatorId = sessionPerms.operator?.id ?? null;
  const canAccess =
    sessionPerms.canAssignWork ||
    kpi.assignedAgentId === operatorId ||
    isTravelOrderTraveler(operatorId, order);
  if (!canAccess) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  if (!isTravelOrderApproved(order.status)) {
    return {
      error: NextResponse.json(
        {
          error:
            "Order attachments can be added after the travel order is approved (while it is running).",
        },
        { status: 400 },
      ),
    };
  }

  return { order };
}

/**
 * POST /api/kpi-maintenance/:id/travel-orders/:travelOrderId/attachments
 * Travelers (and admins) may add order-level files while the TO is approved/running.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; travelOrderId: string }> },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const moduleOff = await moduleDisabledResponse("work_plans");
  if (moduleOff) return moduleOff;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId } = await ctx.params;

  const loaded = await loadOrderForTravelerAttachments(perms, id, travelOrderId);
  if ("error" in loaded) return loaded.error;
  const { order } = loaded;

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart form data with attachments." },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const files: File[] = [];
  for (const key of ["attachment", "attachments", "files", "file"]) {
    for (const value of form.getAll(key)) {
      if (value instanceof File && value.size > 0) files.push(value);
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: "Add at least one file." }, { status: 400 });
  }

  const existing = order.attachments ?? [];
  const remaining = MAX_TRAVEL_ORDER_ATTACHMENTS - existing.length;
  if (remaining <= 0) {
    return NextResponse.json(
      { error: `You can attach at most ${MAX_TRAVEL_ORDER_ATTACHMENTS} files.` },
      { status: 400 },
    );
  }

  try {
    const uploaded = [];
    for (const file of files.slice(0, remaining)) {
      const saved = await persistTravelOrderAttachment(id, travelOrderId, file);
      if ("error" in saved) {
        return NextResponse.json({ error: saved.error }, { status: 400 });
      }
      uploaded.push(saved);
    }
    await updateTravelOrderAttachments(travelOrderId, [...existing, ...uploaded]);

    const fresh = await findTravelOrderById(travelOrderId);
    if (!fresh) {
      return NextResponse.json({ error: "Travel order could not be reloaded." }, { status: 500 });
    }
    return NextResponse.json({ travelOrder: serializeTravelOrder(fresh) }, { status: 201 });
  } catch (err) {
    console.error("[travel-orders] order attachment upload failed:", err);
    return NextResponse.json({ error: "Could not upload attachments." }, { status: 500 });
  }
}

/**
 * PATCH /api/kpi-maintenance/:id/travel-orders/:travelOrderId/attachments
 * Remove one order-level attachment while the TO is approved/running.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; travelOrderId: string }> },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const moduleOff = await moduleDisabledResponse("work_plans");
  if (moduleOff) return moduleOff;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId } = await ctx.params;

  const loaded = await loadOrderForTravelerAttachments(perms, id, travelOrderId);
  if ("error" in loaded) return loaded.error;
  const { order } = loaded;

  const body = (await req.json().catch(() => ({}))) as { removeAttachment?: string | null };
  const removeName =
    typeof body.removeAttachment === "string" ? path.basename(body.removeAttachment.trim()) : "";
  if (!removeName) {
    return NextResponse.json({ error: "Provide removeAttachment." }, { status: 400 });
  }

  const existing = order.attachments ?? [];
  const next = existing.filter((a) => a.storedFileName !== removeName);
  if (next.length === existing.length) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  try {
    await updateTravelOrderAttachments(travelOrderId, next);
    const fullPath = path.join(travelOrderUploadDir(id, travelOrderId), removeName);
    await unlink(fullPath).catch(() => undefined);

    const fresh = await findTravelOrderById(travelOrderId);
    if (!fresh) {
      return NextResponse.json({ error: "Travel order could not be reloaded." }, { status: 500 });
    }
    return NextResponse.json({ travelOrder: serializeTravelOrder(fresh) });
  } catch (err) {
    console.error("[travel-orders] order attachment remove failed:", err);
    return NextResponse.json({ error: "Could not remove attachment." }, { status: 500 });
  }
}
