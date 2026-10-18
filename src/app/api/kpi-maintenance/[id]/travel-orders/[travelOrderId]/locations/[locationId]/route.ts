import { unlink } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { isTravelOrderApproved, isTravelOrderTraveler, isValidLatLng, travelOrderLocationsUnlocked } from "@/modules/work-plans/travel-order";
import {
  findTravelOrderById,
  serializeTravelOrder,
  updateTravelOrderLocationAttachments,
  updateTravelOrderLocationRemarks,
  updateTravelOrderLocationVisit,
} from "@/modules/work-plans/travel-order-db";
import { persistTravelOrderImage, travelOrderUploadDir } from "@/modules/work-plans/travel-order-uploads";

const MAX_LOCATION_IMAGES = 5;

async function loadApprovedLocation(
  sessionPerms: Awaited<ReturnType<typeof resolveOpsPermissions>>,
  id: string,
  travelOrderId: string,
  locationId: string,
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
  if (!canAccess) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  if (!isTravelOrderApproved(order.status)) {
    return {
      error: NextResponse.json(
        {
          error:
            "Location Start/End GPS, remarks, and images are available after the travel order is approved.",
        },
        { status: 400 },
      ),
    };
  }

  if (!travelOrderLocationsUnlocked(order)) {
    return {
      error: NextResponse.json(
        {
          error:
            "Locations stay locked until Gate Pass Actual Departure Start is captured.",
        },
        { status: 400 },
      ),
    };
  }

  const loc = order.locations.find((l) => l.id === locationId);
  if (!loc) return { error: NextResponse.json({ error: "Location not found." }, { status: 404 }) };

  return { order, loc };
}

/**
 * PATCH /api/kpi-maintenance/:id/travel-orders/:travelOrderId/locations/:locationId
 * Start/End visit GPS, update remarks, or remove an attachment — only when order is APPROVED.
 */
export async function PATCH(
  req: Request,
  ctx: {
    params: Promise<{ id: string; travelOrderId: string; locationId: string }>;
  },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const moduleOff = await moduleDisabledResponse("work_plans");
  if (moduleOff) return moduleOff;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId, locationId } = await ctx.params;

  const loaded = await loadApprovedLocation(perms, id, travelOrderId, locationId);
  if ("error" in loaded) return loaded.error;
  const { loc } = loaded;

  const body = (await req.json().catch(() => ({}))) as {
    checked?: boolean;
    visitAction?: "start" | "end";
    latitude?: number | null;
    longitude?: number | null;
    checkedAt?: string | null;
    capturedAt?: string | null;
    remarks?: string | null;
    removeAttachment?: string | null;
  };

  const visitAction =
    body.visitAction === "start" || body.visitAction === "end"
      ? body.visitAction
      : typeof body.checked === "boolean"
        ? body.checked
          ? ("end" as const)
          : null
        : null;
  const hasVisit = visitAction != null;
  const hasRemarks = "remarks" in body;
  const removeName =
    typeof body.removeAttachment === "string" ? path.basename(body.removeAttachment.trim()) : "";
  const hasRemove = Boolean(removeName);

  if (!hasVisit && !hasRemarks && !hasRemove) {
    return NextResponse.json(
      { error: "Provide visitAction (start|end), remarks, and/or removeAttachment." },
      { status: 400 },
    );
  }

  try {
    if (hasVisit && visitAction) {
      if (visitAction === "start" && loc.startedAt) {
        return NextResponse.json(
          { error: "This location was already started." },
          { status: 409 },
        );
      }
      if (visitAction === "end") {
        if (loc.endedAt || loc.checkedAt) {
          return NextResponse.json(
            { error: "This location was already completed." },
            { status: 409 },
          );
        }
        if (!loc.startedAt) {
          return NextResponse.json(
            { error: "Press Start and capture GPS before ending this location." },
            { status: 400 },
          );
        }
      }

      const latitude = body.latitude == null ? null : Number(body.latitude);
      const longitude = body.longitude == null ? null : Number(body.longitude);
      if (!isValidLatLng(latitude, longitude)) {
        return NextResponse.json(
          { error: "Could not capture a valid GPS position. Allow location access and try again." },
          { status: 400 },
        );
      }
      await updateTravelOrderLocationVisit({
        locationId,
        travelOrderId,
        visitAction,
        latitude,
        longitude,
        capturedAtIso:
          typeof body.capturedAt === "string"
            ? body.capturedAt
            : typeof body.checkedAt === "string"
              ? body.checkedAt
              : null,
      });
    }

    if (hasRemarks) {
      const remarks =
        typeof body.remarks === "string" && body.remarks.trim() ? body.remarks.trim() : null;
      await updateTravelOrderLocationRemarks({
        locationId,
        travelOrderId,
        remarks,
      });
    }

    if (hasRemove) {
      const next = loc.attachments.filter((a) => a.storedFileName !== removeName);
      if (next.length === loc.attachments.length) {
        return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
      }
      await updateTravelOrderLocationAttachments(locationId, next);
      const fullPath = path.join(travelOrderUploadDir(id, travelOrderId), removeName);
      await unlink(fullPath).catch(() => undefined);
    }

    const fresh = await findTravelOrderById(travelOrderId);
    if (!fresh) {
      return NextResponse.json({ error: "Travel order could not be reloaded." }, { status: 500 });
    }
    return NextResponse.json({ travelOrder: serializeTravelOrder(fresh) });
  } catch (err) {
    console.error("[travel-orders] location patch failed:", err);
    return NextResponse.json({ error: "Could not update location." }, { status: 500 });
  }
}

/**
 * POST /api/kpi-maintenance/:id/travel-orders/:travelOrderId/locations/:locationId
 * Upload remark images (multipart) — only when order is APPROVED.
 */
export async function POST(
  req: Request,
  ctx: {
    params: Promise<{ id: string; travelOrderId: string; locationId: string }>;
  },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const moduleOff = await moduleDisabledResponse("work_plans");
  if (moduleOff) return moduleOff;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId, locationId } = await ctx.params;

  const loaded = await loadApprovedLocation(perms, id, travelOrderId, locationId);
  if ("error" in loaded) return loaded.error;
  const { loc } = loaded;

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart form data with images." }, { status: 400 });
  }

  const form = await req.formData();
  const files: File[] = [];
  for (const value of form.getAll("images")) {
    if (value instanceof File && value.size > 0) files.push(value);
  }
  const single = form.get("image");
  if (single instanceof File && single.size > 0) files.push(single);

  if (files.length === 0) {
    return NextResponse.json({ error: "Add at least one image." }, { status: 400 });
  }

  const remaining = MAX_LOCATION_IMAGES - loc.attachments.length;
  if (remaining <= 0) {
    return NextResponse.json(
      { error: `At most ${MAX_LOCATION_IMAGES} images per location.` },
      { status: 400 },
    );
  }

  try {
    const uploaded = [];
    for (const file of files.slice(0, remaining)) {
      const saved = await persistTravelOrderImage(id, travelOrderId, file);
      if ("error" in saved) {
        return NextResponse.json({ error: saved.error }, { status: 400 });
      }
      uploaded.push(saved);
    }
    await updateTravelOrderLocationAttachments(locationId, [
      ...loc.attachments,
      ...uploaded,
    ]);

    const fresh = await findTravelOrderById(travelOrderId);
    if (!fresh) {
      return NextResponse.json({ error: "Travel order could not be reloaded." }, { status: 500 });
    }
    return NextResponse.json({ travelOrder: serializeTravelOrder(fresh) }, { status: 201 });
  } catch (err) {
    console.error("[travel-orders] location image upload failed:", err);
    return NextResponse.json({ error: "Could not upload images." }, { status: 500 });
  }
}
