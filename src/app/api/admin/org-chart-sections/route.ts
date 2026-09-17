import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { prismaPrimary } from "@/lib/prisma";
import {
  ensurePortalAdminForAllOrgChartSectionHeads,
  reconcilePortalStaffRolesFromOrgChart,
  resolvePortalTechnicalRolesByMergedSourceUserIds,
} from "@/lib/org-chart-section-scope";

async function guardSuperAdmin() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "SuperAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

function serializeSection(s: {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  companyTeamId: string | null;
  headNodeId: string | null;
  reportsToNodeId?: string | null;
  companyTeam: { id: string; name: string } | null;
  headNode: {
    id: string;
    personName: string;
    personRole: string | null;
    companyName: string | null;
    mergedSourceUserId?: string;
  } | null;
  reportsToNode?: {
    id: string;
    personName: string;
    personRole: string | null;
    companyName: string | null;
  } | null;
  roles?: Array<{ id: string; label: string; sortOrder: number }> | null;
  _count: { memberships: number };
  createdAt: Date;
  updatedAt: Date;
}, portalRoleByMergedId?: Map<string, string>) {
  const headMergedId = s.headNode?.mergedSourceUserId?.trim() ?? "";
  const headPortalRole = headMergedId
    ? portalRoleByMergedId?.get(headMergedId) ?? null
    : null;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    sortOrder: s.sortOrder,
    parentId: s.parentId,
    companyTeamId: s.companyTeamId,
    companyName: s.companyTeam?.name ?? null,
    headNodeId: s.headNodeId,
    headName: s.headNode?.personName ?? null,
    // Prefer portal Admin/Personnel over HRIS personRole snapshot on the node.
    headRole: headPortalRole ?? s.headNode?.personRole ?? null,
    headCompanyName: s.headNode?.companyName ?? null,
    reportsToNodeId: s.reportsToNodeId ?? null,
    reportsToName: s.reportsToNode?.personName ?? null,
    reportsToRole: s.reportsToNode?.personRole ?? null,
    reportsToCompanyName: s.reportsToNode?.companyName ?? null,
    roles: (s.roles ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      sortOrder: r.sortOrder,
    })),
    memberCount: s._count.memberships,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function serializeSectionWithHeadPortalRole(s: Parameters<typeof serializeSection>[0]) {
  const mergedId = s.headNode?.mergedSourceUserId?.trim() ?? "";
  const map = mergedId
    ? await resolvePortalTechnicalRolesByMergedSourceUserIds([mergedId])
    : undefined;
  return serializeSection(s, map);
}

const sectionInclude = {
  companyTeam: { select: { id: true, name: true } },
  headNode: {
    select: {
      id: true,
      personName: true,
      personRole: true,
      companyName: true,
      mergedSourceUserId: true,
    },
  },
  reportsToNode: {
    select: {
      id: true,
      personName: true,
      personRole: true,
      companyName: true,
    },
  },
  roles: {
    select: { id: true, label: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" as const }, { label: "asc" as const }],
  },
  _count: { select: { memberships: true } },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sectionIncludeArgs = sectionInclude as any;

/// True when `nodeId` is `ancestorId` or lies somewhere under it in the section tree.
async function isSectionDescendantOf(
  ancestorId: string,
  nodeId: string,
  rows?: Array<{ id: string; parentId: string | null }>,
): Promise<boolean> {
  if (ancestorId === nodeId) return true;
  const all =
    rows ??
    (await prismaPrimary.orgChartSection.findMany({
      select: { id: true, parentId: true },
    }));
  const parentOf = new Map(all.map((s) => [s.id, s.parentId]));
  let current: string | null = nodeId;
  const seen = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) break;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

async function resolveReportsToNodeId(
  raw: unknown,
): Promise<{ reportsToNodeId: string } | { error: string; status: number } | null> {
  if (raw === undefined || raw === null || raw === "") return null;
  const reportsToNodeId = String(raw).trim();
  if (!reportsToNodeId) return null;
  const node = await prismaPrimary.orgChartNode.findUnique({
    where: { id: reportsToNodeId },
    select: { id: true },
  });
  if (!node) {
    return { error: "Reports-to person not found on the org chart.", status: 400 };
  }
  return { reportsToNodeId: node.id };
}

async function resolveParentId(
  raw: unknown,
  opts?: { sectionId?: string },
): Promise<
  { parentId: string; companyTeamId: string | null } | { error: string; status: number } | null
> {
  if (raw === undefined || raw === null || raw === "") return null;
  const parentId = String(raw).trim();
  if (!parentId) return null;
  if (opts?.sectionId && parentId === opts.sectionId) {
    return { error: "A section cannot be its own parent.", status: 400 };
  }
  const parent = await prismaPrimary.orgChartSection.findUnique({
    where: { id: parentId },
    select: { id: true, companyTeamId: true },
  });
  if (!parent) {
    return { error: "Parent section not found.", status: 400 };
  }
  if (opts?.sectionId && (await isSectionDescendantOf(opts.sectionId, parentId))) {
    return {
      error: "A section cannot be nested under one of its own subsections.",
      status: 400,
    };
  }
  return { parentId: parent.id, companyTeamId: parent.companyTeamId };
}

async function resolveHeadNodeId(
  sectionId: string,
  raw: unknown,
): Promise<{ headNodeId: string | null } | { error: string; status: number }> {
  if (raw === undefined) {
    return { error: "Nothing to update.", status: 400 };
  }
  if (raw === null || raw === "") {
    return { headNodeId: null };
  }
  const headNodeId = String(raw).trim();
  const node = await prismaPrimary.orgChartNode.findUnique({
    where: { id: headNodeId },
    select: {
      id: true,
      sectionMemberships: {
        where: { sectionId },
        select: { sectionId: true },
      },
    },
  });
  if (!node) {
    return { error: "That person is not on the org chart.", status: 400 };
  }
  if (node.sectionMemberships.length === 0) {
    return {
      error: "The head must be a member of this section or subsection.",
      status: 400,
    };
  }
  return { headNodeId };
}

async function syncPrimarySections(nodeIds: string[]) {
  if (nodeIds.length === 0) return;
  const nodes = await prismaPrimary.orgChartNode.findMany({
    where: { id: { in: nodeIds } },
    select: {
      id: true,
      sectionId: true,
      sectionMemberships: {
        select: { sectionId: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  await prismaPrimary.$transaction(
    nodes
      .map((node) => {
        const membershipIds = node.sectionMemberships.map((m) => m.sectionId);
        const nextPrimary =
          node.sectionId && membershipIds.includes(node.sectionId)
            ? node.sectionId
            : membershipIds[0] ?? null;
        if (nextPrimary === node.sectionId) return null;
        return prismaPrimary.orgChartNode.update({
          where: { id: node.id },
          data: { sectionId: nextPrimary },
        });
      })
      .filter((op): op is Exclude<typeof op, null> => op != null),
  );
}

/** Clear section head when members leave their section. */
async function clearHeadsForNodes(nodeIds: string[]) {
  if (nodeIds.length === 0) return;
  await prismaPrimary.orgChartSection.updateMany({
    where: { headNodeId: { in: nodeIds } },
    data: { headNodeId: null },
  });
}

export async function GET() {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  // Lazy backfill: align Personnel / Admin with department + sub-department heads.
  await ensurePortalAdminForAllOrgChartSectionHeads();

  const sections = await prismaPrimary.orgChartSection.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: sectionIncludeArgs,
  });

  const headMergedIds = sections
    .map((s) => (s as { headNode?: { mergedSourceUserId?: string | null } | null }).headNode?.mergedSourceUserId)
    .filter((id): id is string => Boolean(id?.trim()));
  const portalRoleByMergedId =
    await resolvePortalTechnicalRolesByMergedSourceUserIds(headMergedIds);

  return NextResponse.json(
    sections.map((s) => serializeSection(s as any, portalRoleByMergedId)),
  );
}

export async function POST(req: Request) {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  const body = (await req.json()) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Section name is required." }, { status: 400 });
  }

  const descriptionRaw = String(body.description ?? "").trim();
  const description = descriptionRaw ? descriptionRaw.slice(0, 500) : null;

  const parentResolved = await resolveParentId(body.parentId);
  if (parentResolved && "error" in parentResolved) {
    return NextResponse.json(
      { error: parentResolved.error },
      { status: parentResolved.status },
    );
  }
  const parentId = parentResolved?.parentId ?? null;

  const reportsResolved = await resolveReportsToNodeId(body.reportsToNodeId);
  if (reportsResolved && "error" in reportsResolved) {
    return NextResponse.json(
      { error: reportsResolved.error },
      { status: reportsResolved.status },
    );
  }
  const reportsToNodeId = reportsResolved?.reportsToNodeId ?? null;
  // Nesting (parentId) and people-chart reports-to are independent — metrics use parentId.

  let companyTeamId: string | null = body.companyTeamId
    ? String(body.companyTeamId).trim()
    : null;
  if (parentResolved && body.companyTeamId === undefined) {
    companyTeamId = parentResolved.companyTeamId;
  }
  if (companyTeamId) {
    if (companyTeamId.startsWith("company:")) {
      companyTeamId = null;
    } else {
      const team = await prismaPrimary.team.findUnique({
        where: { id: companyTeamId },
        select: { id: true },
      });
      if (!team) {
        return NextResponse.json({ error: "Company not found." }, { status: 400 });
      }
    }
  }

  const [max] = await prismaPrimary.orgChartSection.findMany({
    where: { parentId },
    orderBy: { sortOrder: "desc" },
    take: 1,
    select: { sortOrder: true },
  });
  const sortOrder =
    typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
      ? Math.max(0, Math.floor(body.sortOrder))
      : (max?.sortOrder ?? -1) + 1;

  const created = await prismaPrimary.orgChartSection.create({
    data: {
      name: name.slice(0, 120),
      description,
      companyTeamId,
      parentId,
      reportsToNodeId,
      sortOrder,
    },
    include: sectionIncludeArgs,
  });

  return NextResponse.json(await serializeSectionWithHeadPortalRole(created as any), {
    status: 201,
  });
}

export async function PATCH(req: Request) {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  const body = (await req.json()) as Record<string, unknown>;

  // Reorder sibling departments / subsections by sortOrder.
  // Body: { reorder: { parentId: string | null, orderedIds: string[] } }
  if (body.reorder && typeof body.reorder === "object" && body.reorder !== null) {
    const reorder = body.reorder as { parentId?: unknown; orderedIds?: unknown };
    const parentIdRaw = reorder.parentId;
    const parentId =
      parentIdRaw === null || parentIdRaw === undefined || parentIdRaw === ""
        ? null
        : String(parentIdRaw).trim();
    const orderedIds = Array.isArray(reorder.orderedIds)
      ? [...new Set(reorder.orderedIds.map((x) => String(x ?? "").trim()).filter(Boolean))]
      : [];
    if (orderedIds.length === 0) {
      return NextResponse.json(
        { error: "orderedIds is required for department reorder." },
        { status: 400 },
      );
    }
    if (parentId) {
      const parent = await prismaPrimary.orgChartSection.findUnique({
        where: { id: parentId },
        select: { id: true },
      });
      if (!parent) {
        return NextResponse.json({ error: "Parent department not found." }, { status: 404 });
      }
    }
    const siblings = await prismaPrimary.orgChartSection.findMany({
      where: { parentId },
      select: { id: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const siblingIds = new Set(siblings.map((s) => s.id));
    if (
      orderedIds.length !== siblingIds.size ||
      orderedIds.some((id) => !siblingIds.has(id))
    ) {
      return NextResponse.json(
        {
          error:
            "orderedIds must include every department at this level (same parent) exactly once.",
        },
        { status: 400 },
      );
    }
    await prismaPrimary.$transaction(
      orderedIds.map((sectionId, index) =>
        prismaPrimary.orgChartSection.update({
          where: { id: sectionId },
          data: { sortOrder: index },
        }),
      ),
    );
    const refreshed = await prismaPrimary.orgChartSection.findMany({
      where: { id: { in: orderedIds } },
      include: sectionIncludeArgs,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(
      await Promise.all(refreshed.map((s) => serializeSectionWithHeadPortalRole(s as any))),
    );
  }

  const id = String(body.id ?? "").trim();

  const fromList = Array.isArray(body.nodeIds)
    ? body.nodeIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  const single = body.nodeId ? String(body.nodeId).trim() : "";
  const nodeIds = [...new Set(fromList.length > 0 ? fromList : single ? [single] : [])];

  // Assign / clear / remove section memberships for one or many org-chart nodes.
  if (
    nodeIds.length > 0 &&
    (
      body.clear === true ||
      body.remove === true ||
      body.nodeIds !== undefined ||
      body.nodeId !== undefined
    )
  ) {
    const clearAll =
      body.clear === true || body.sectionId === null || (!id && body.clear === true);
    const removeFromSection = body.remove === true && !clearAll;
    let sectionId: string | null = null;
    if (!clearAll) {
      if (!id) {
        return NextResponse.json({ error: "Section id is required." }, { status: 400 });
      }
      const existing = await prismaPrimary.orgChartSection.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) {
        return NextResponse.json({ error: "Section not found." }, { status: 404 });
      }
      sectionId = id;
    }

    const found = await prismaPrimary.orgChartNode.findMany({
      where: { id: { in: nodeIds } },
      select: { id: true },
    });
    if (found.length !== nodeIds.length) {
      return NextResponse.json(
        { error: "One or more chart members were not found." },
        { status: 404 },
      );
    }

    if (clearAll) {
      await clearHeadsForNodes(nodeIds);
      await prismaPrimary.orgChartNodeSectionMembership.deleteMany({
        where: { nodeId: { in: nodeIds } },
      });
    } else if (removeFromSection) {
      await prismaPrimary.orgChartSection.updateMany({
        where: { id: sectionId!, headNodeId: { in: nodeIds } },
        data: { headNodeId: null },
      });
      await prismaPrimary.orgChartNodeSectionMembership.deleteMany({
        where: { nodeId: { in: nodeIds }, sectionId: sectionId! },
      });
    } else {
      await prismaPrimary.orgChartNodeSectionMembership.createMany({
        data: nodeIds.map((nodeId) => ({ nodeId, sectionId: sectionId! })),
        skipDuplicates: true,
      });
    }

    await syncPrimarySections(nodeIds);
    await reconcilePortalStaffRolesFromOrgChart();

    return NextResponse.json({
      sectionId: clearAll ? null : sectionId,
      cleared: clearAll,
      removed: removeFromSection,
      updated: nodeIds,
    });
  }

  if (!id) {
    return NextResponse.json({ error: "Section id is required." }, { status: 400 });
  }

  const existing = await prismaPrimary.orgChartSection.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Section not found." }, { status: 404 });
  }

  // Set or clear the section / sub-department head.
  if (body.headNodeId !== undefined) {
    const resolved = await resolveHeadNodeId(id, body.headNodeId);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const updated = await prismaPrimary.orgChartSection.update({
      where: { id },
      data: { headNodeId: resolved.headNodeId },
      include: sectionIncludeArgs,
    });
    // Align Personnel / Admin with chart heads (promotes new head, demotes former).
    await reconcilePortalStaffRolesFromOrgChart();
    return NextResponse.json(await serializeSectionWithHeadPortalRole(updated as any));
  }

  // Create a custom section role (e.g. Deputy, Coordinator).
  if (body.createRole && typeof body.createRole === "object") {
    const createRole = body.createRole as { label?: unknown };
    const label = String(createRole.label ?? "").trim().slice(0, 80);
    if (!label) {
      return NextResponse.json({ error: "Role label is required." }, { status: 400 });
    }
    const [max] = await prismaPrimary.orgChartSectionRole.findMany({
      where: { sectionId: id },
      orderBy: { sortOrder: "desc" },
      take: 1,
      select: { sortOrder: true },
    });
    try {
      await prismaPrimary.orgChartSectionRole.create({
        data: {
          sectionId: id,
          label,
          sortOrder: (max?.sortOrder ?? -1) + 1,
        },
      });
    } catch {
      return NextResponse.json(
        { error: "A role with that label already exists in this section." },
        { status: 409 },
      );
    }
    const updated = await prismaPrimary.orgChartSection.findUniqueOrThrow({
      where: { id },
      include: sectionIncludeArgs,
    });
    return NextResponse.json(await serializeSectionWithHeadPortalRole(updated as any));
  }

  // Delete a custom section role.
  if (body.deleteRoleId !== undefined) {
    const roleId = String(body.deleteRoleId ?? "").trim();
    if (!roleId) {
      return NextResponse.json({ error: "deleteRoleId is required." }, { status: 400 });
    }
    const role = await prismaPrimary.orgChartSectionRole.findFirst({
      where: { id: roleId, sectionId: id },
      select: { id: true },
    });
    if (!role) {
      return NextResponse.json({ error: "Role not found in this section." }, { status: 404 });
    }
    await prismaPrimary.orgChartSectionRole.delete({ where: { id: roleId } });
    const updated = await prismaPrimary.orgChartSection.findUniqueOrThrow({
      where: { id },
      include: sectionIncludeArgs,
    });
    return NextResponse.json(await serializeSectionWithHeadPortalRole(updated as any));
  }

  // Assign / clear a custom role on a section member (not the Head pointer).
  if (body.memberRoleNodeId !== undefined) {
    const nodeId = String(body.memberRoleNodeId ?? "").trim();
    if (!nodeId) {
      return NextResponse.json({ error: "memberRoleNodeId is required." }, { status: 400 });
    }
    const membership = await prismaPrimary.orgChartNodeSectionMembership.findUnique({
      where: { nodeId_sectionId: { nodeId, sectionId: id } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "That person is not a member of this section." },
        { status: 400 },
      );
    }
    let roleId: string | null = null;
    if (body.roleId !== null && body.roleId !== undefined && body.roleId !== "") {
      roleId = String(body.roleId).trim();
      const role = await prismaPrimary.orgChartSectionRole.findFirst({
        where: { id: roleId, sectionId: id },
        select: { id: true },
      });
      if (!role) {
        return NextResponse.json(
          { error: "Role not found in this section." },
          { status: 404 },
        );
      }
    }
    await prismaPrimary.orgChartNodeSectionMembership.update({
      where: { nodeId_sectionId: { nodeId, sectionId: id } },
      data: { roleId },
    });
    return NextResponse.json({
      sectionId: id,
      nodeId,
      roleId,
    });
  }

  const data: {
    name?: string;
    description?: string | null;
    sortOrder?: number;
    companyTeamId?: string | null;
    parentId?: string | null;
    reportsToNodeId?: string | null;
  } = {};

  if (body.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Section name is required." }, { status: 400 });
    }
    data.name = name.slice(0, 120);
  }

  if (body.description !== undefined) {
    const descriptionRaw = String(body.description ?? "").trim();
    data.description = descriptionRaw ? descriptionRaw.slice(0, 500) : null;
  }

  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "Invalid sort order." }, { status: 400 });
    }
    data.sortOrder = Math.max(0, Math.floor(n));
  }

  if (body.parentId !== undefined) {
    const parentResolved = await resolveParentId(body.parentId, { sectionId: id });
    if (parentResolved && "error" in parentResolved) {
      return NextResponse.json(
        { error: parentResolved.error },
        { status: parentResolved.status },
      );
    }
    data.parentId = parentResolved?.parentId ?? null;
    // Nesting under a department owns the tree edge. Setting reportsToNodeId must
    // NOT clear parentId, and must not reparent people-chart nodes.
    data.reportsToNodeId = null;
  }

  if (body.reportsToNodeId !== undefined) {
    const reportsResolved = await resolveReportsToNodeId(body.reportsToNodeId);
    if (reportsResolved && "error" in reportsResolved) {
      return NextResponse.json(
        { error: reportsResolved.error },
        { status: reportsResolved.status },
      );
    }
    data.reportsToNodeId = reportsResolved?.reportsToNodeId ?? null;
  }

  if (body.companyTeamId !== undefined) {
    let companyTeamId: string | null = body.companyTeamId
      ? String(body.companyTeamId).trim()
      : null;
    if (companyTeamId) {
      if (companyTeamId.startsWith("company:")) {
        companyTeamId = null;
      } else {
        const team = await prismaPrimary.team.findUnique({
          where: { id: companyTeamId },
          select: { id: true },
        });
        if (!team) {
          return NextResponse.json({ error: "Company not found." }, { status: 400 });
        }
      }
    }
    data.companyTeamId = companyTeamId;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prismaPrimary.orgChartSection.update({
    where: { id },
    data,
    include: sectionIncludeArgs,
  });

  return NextResponse.json(await serializeSectionWithHeadPortalRole(updated as any));
}

export async function DELETE(req: Request) {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Section id is required." }, { status: 400 });
  }

  const existing = await prismaPrimary.orgChartSection.findUnique({
    where: { id },
    include: {
      _count: { select: { memberships: true, children: true } },
      children: { select: { id: true, _count: { select: { memberships: true } } } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Section not found." }, { status: 404 });
  }

  const childMemberCount = existing.children.reduce((sum, c) => sum + c._count.memberships, 0);
  await prismaPrimary.orgChartSection.delete({ where: { id } });
  return NextResponse.json({
    removed: id,
    removedMemberships: existing._count.memberships + childMemberCount,
    removedSubsections: existing._count.children,
  });
}
