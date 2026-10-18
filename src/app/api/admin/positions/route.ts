import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";
import { positionCodeLabel } from "@/modules/hierarchy/position-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const { session, unauthorized } = await requireRole(["SuperAdmin", "Admin"]);
  if (unauthorized || !session) return unauthorized;

  const [positions, assignments] = await Promise.all([
    prisma.position.findMany({
      orderBy: [{ level: "asc" }, { code: "asc" }],
    }),
    prisma.positionAssignment.findMany({
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ]);

  return NextResponse.json({
    positions: positions.map((row) => ({
      ...row,
      label: positionCodeLabel(row.code),
      assignmentCount: assignments.filter((a) => a.positionId === row.id).length,
    })),
    assignments,
  });
}

export async function POST(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    name?: string;
    level?: number;
    description?: string;
    isActive?: boolean;
  };

  const code = String(body.code ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const name = String(body.name ?? "").trim();
  if (!code || !name) {
    return NextResponse.json({ error: "code and name are required." }, { status: 400 });
  }

  const created = await prisma.position.create({
    data: {
      code,
      name,
      level: Number.isFinite(body.level) ? Number(body.level) : 0,
      description: body.description?.trim() || null,
      isActive: body.isActive !== false,
    },
  });

  return NextResponse.json({ position: created }, { status: 201 });
}

export async function PATCH(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    level?: number;
    description?: string | null;
    isActive?: boolean;
  };
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const updated = await prisma.position.update({
    where: { id },
    data: {
      ...(body.name != null ? { name: String(body.name).trim() } : {}),
      ...(Number.isFinite(body.level) ? { level: Number(body.level) } : {}),
      ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
      ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
    },
  });

  return NextResponse.json({ position: updated });
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireRole(["SuperAdmin"]);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  await prisma.position.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
