import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const positionId = searchParams.get("positionId")?.trim();
  const companyTeamId = searchParams.get("companyTeamId")?.trim();

  const assignments = await prisma.positionAssignment.findMany({
    where: {
      ...(positionId ? { positionId } : {}),
      ...(companyTeamId ? { companyTeamId } : {}),
    },
    include: { position: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  return NextResponse.json({ assignments });
}

export async function POST(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => ({}))) as {
    positionId?: string;
    mergedSourceUserId?: string;
    companyTeamId?: string | null;
    isActing?: boolean;
    portalAccountId?: string;
    primaryPosition?: boolean;
    reportsToPortalAccountId?: string | null;
  };

  const positionId = String(body.positionId ?? "").trim();
  const mergedSourceUserId = String(body.mergedSourceUserId ?? "").trim();
  if (!positionId || !mergedSourceUserId) {
    return NextResponse.json(
      { error: "positionId and mergedSourceUserId are required." },
      { status: 400 },
    );
  }

  const rawCompanyTeamId = body.companyTeamId?.trim() || "";
  let companyTeamId: string | null = rawCompanyTeamId || null;
  if (companyTeamId) {
    // Synthetic roster keys (company:…) are not Team rows — treat as unscoped.
    if (companyTeamId.startsWith("company:")) {
      companyTeamId = null;
    } else {
      const team = await prisma.company.findUnique({
        where: { id: companyTeamId },
        select: { id: true },
      });
      if (!team) {
        return NextResponse.json(
          {
            error:
              "Invalid company scope. Leave company blank for a global assignment, or pick a real company.",
          },
          { status: 400 },
        );
      }
    }
  }

  const position = await prisma.position.findUnique({
    where: { id: positionId },
    select: { id: true },
  });
  if (!position) {
    return NextResponse.json({ error: "Position not found." }, { status: 400 });
  }

  let assignment;
  try {
    assignment = await prisma.positionAssignment.create({
      data: {
        positionId,
        mergedSourceUserId,
        companyTeamId,
        isActing: Boolean(body.isActing),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Assign failed.";
    console.error("[position-assignments] create failed", err);
    return NextResponse.json(
      { error: message.includes("Foreign key") ? "Invalid company or position reference." : "Assign failed." },
      { status: 400 },
    );
  }

  const portalAccountId =
    body.portalAccountId?.trim() ||
    (
      await prisma.portalAccount.findFirst({
        where: {
          mergedSourceUserId: (() => {
            try {
              return BigInt(mergedSourceUserId);
            } catch {
              return null;
            }
          })(),
        },
        select: { id: true },
      })
    )?.id;

  if (portalAccountId && body.primaryPosition) {
    await prisma.portalAccount.update({
      where: { id: portalAccountId },
      data: {
        primaryPositionId: positionId,
        ...(body.reportsToPortalAccountId !== undefined
          ? { reportsToPortalAccountId: body.reportsToPortalAccountId }
          : {}),
      },
    });
  }

  if (body.primaryPosition) {
    await prisma.orgChartNode.updateMany({
      where: { mergedSourceUserId },
      data: { primaryPositionId: positionId },
    });
  }

  return NextResponse.json({ assignment }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin", "Admin"]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  await prisma.positionAssignment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
