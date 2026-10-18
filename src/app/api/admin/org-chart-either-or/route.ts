import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prismaPrimary } from "@/modules/platform/db/prisma";

/** SuperAdmin-only guard. Writes additionally require the given RBAC permission. */
async function guardSuperAdmin(permissionKey?: string) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (permissionKey) {
    const denied = await permissionDenied(session, permissionKey);
    if (denied) return denied;
  }
  return null;
}

/** Canonical undirected order so (A,B) and (B,A) collide on the unique index. */
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function serialize(link: {
  id: string;
  nodeAId: string;
  nodeBId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: link.id,
    nodeAId: link.nodeAId,
    nodeBId: link.nodeBId,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

export async function GET() {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  const links = await prismaPrimary.orgChartEitherOrLink.findMany({
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(links.map(serialize));
}

export async function POST(req: Request) {
  const denied = await guardSuperAdmin("hierarchy.update");
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      body = JSON.parse(text) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const rawA = String(
    body.nodeAId ?? body.nodeIdA ?? searchParams.get("nodeAId") ?? "",
  ).trim();
  const rawB = String(
    body.nodeBId ?? body.nodeIdB ?? searchParams.get("nodeBId") ?? "",
  ).trim();
  if (!rawA || !rawB) {
    return NextResponse.json(
      { error: "Select two org-chart members to link." },
      { status: 400 },
    );
  }
  if (rawA === rawB) {
    return NextResponse.json(
      { error: "An either/or link needs two different members." },
      { status: 400 },
    );
  }

  const [nodeAId, nodeBId] = canonicalPair(rawA, rawB);
  const found = await prismaPrimary.orgChartNode.findMany({
    where: { id: { in: [nodeAId, nodeBId] } },
    select: { id: true },
  });
  if (found.length !== 2) {
    return NextResponse.json(
      { error: "One or both members were not found on the chart." },
      { status: 404 },
    );
  }

  const existing = await prismaPrimary.orgChartEitherOrLink.findUnique({
    where: { nodeAId_nodeBId: { nodeAId, nodeBId } },
  });
  if (existing) {
    return NextResponse.json(serialize(existing));
  }

  const created = await prismaPrimary.orgChartEitherOrLink.create({
    data: { nodeAId, nodeBId },
  });
  return NextResponse.json(serialize(created), { status: 201 });
}

export async function DELETE(req: Request) {
  const denied = await guardSuperAdmin("hierarchy.update");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();
  const rawA = searchParams.get("nodeAId")?.trim() || searchParams.get("nodeIdA")?.trim();
  const rawB = searchParams.get("nodeBId")?.trim() || searchParams.get("nodeIdB")?.trim();

  if (id) {
    const existing = await prismaPrimary.orgChartEitherOrLink.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Either/or link not found." }, { status: 404 });
    }
    await prismaPrimary.orgChartEitherOrLink.delete({ where: { id } });
    return NextResponse.json({ removed: id });
  }

  if (rawA && rawB) {
    const [nodeAId, nodeBId] = canonicalPair(rawA, rawB);
    const existing = await prismaPrimary.orgChartEitherOrLink.findUnique({
      where: { nodeAId_nodeBId: { nodeAId, nodeBId } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Either/or link not found." }, { status: 404 });
    }
    await prismaPrimary.orgChartEitherOrLink.delete({ where: { id: existing.id } });
    return NextResponse.json({ removed: existing.id });
  }

  return NextResponse.json(
    { error: "Provide link id or both node ids." },
    { status: 400 },
  );
}
