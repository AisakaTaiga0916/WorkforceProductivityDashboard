import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client/primary";
import { requireSession } from "@/lib/access";
import { prismaPrimary, prismaSecondary } from "@/lib/prisma";
import { resolveRosterCompanyName } from "@/lib/hris-company-aliases";
import { mapHrisToPortalRole } from "@/lib/auth/role-mapping";

/** SuperAdmin-only guard. Note: hasRole() intentionally lets HighAdmin pass
 *  elevated gates, so the org chart must be explicitly limited to SuperAdmin. */
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

async function snapshotPerson(mergedSourceUserId: string) {
  const id = Number(mergedSourceUserId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const person = await prismaSecondary.mergedUser.findFirst({
    where: { sourceUserId: BigInt(id), isActive: true },
    select: { name: true, role: true, position: true, department: true, companyName: true },
  });
  if (!person) return null;
  const mapped = mapHrisToPortalRole({
    hrisRole: person.role,
    position: person.position,
    department: person.department,
  });
  return {
    personName: person.name,
    personRole: mapped.portalRole,
    companyName: resolveRosterCompanyName(person.companyName) ?? person.companyName,
  };
}

/** Next sortOrder value among the node's siblings (appends to the end). */
async function nextSortOrder(parentId: string | null) {
  const [max] = await prismaPrimary.orgChartNode.findMany({
    where: { parentId },
    orderBy: { sortOrder: "desc" },
    take: 1,
    select: { sortOrder: true },
  });
  return (max?.sortOrder ?? -1) + 1;
}

async function isDescendantOf(nodeId: string, ancestorId: string): Promise<boolean> {
  const all = await prismaPrimary.orgChartNode.findMany({
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string | null, string[]>();
  for (const n of all) {
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n.id);
    childrenOf.set(n.parentId, list);
  }
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === ancestorId) return true;
    for (const child of childrenOf.get(current) ?? []) stack.push(child);
  }
  return false;
}

/**
 * Resolve parent assignment from either a person node or a shared either/or link.
 * Layout always hangs under one concrete parentId; the link id marks shared parenting.
 */
async function resolveParentAssignment(opts: {
  parentId?: unknown;
  parentEitherOrLinkId?: unknown;
}): Promise<
  | { parentId: string | null; parentEitherOrLinkId: string | null }
  | { error: string; status: number }
> {
  const linkRaw =
    opts.parentEitherOrLinkId !== undefined &&
    opts.parentEitherOrLinkId !== null &&
    opts.parentEitherOrLinkId !== ""
      ? String(opts.parentEitherOrLinkId).trim()
      : "";

  if (linkRaw) {
    const link = await prismaPrimary.orgChartEitherOrLink.findUnique({
      where: { id: linkRaw },
      select: { id: true, nodeAId: true, nodeBId: true },
    });
    if (!link) {
      return { error: "Either/or link not found.", status: 400 };
    }
    // Canonical layout parent is nodeA (lexicographically smaller id from create).
    return { parentId: link.nodeAId, parentEitherOrLinkId: link.id };
  }

  if (opts.parentId === undefined) {
    return { parentId: null, parentEitherOrLinkId: null };
  }

  const parentId = opts.parentId ? String(opts.parentId).trim() : null;
  if (!parentId) {
    return { parentId: null, parentEitherOrLinkId: null };
  }
  const parent = await prismaPrimary.orgChartNode.findUnique({
    where: { id: parentId },
    select: { id: true },
  });
  if (!parent) {
    return { error: "Parent node not found.", status: 400 };
  }
  return { parentId: parent.id, parentEitherOrLinkId: null };
}

export async function GET() {
  const denied = await guardSuperAdmin();
  if (denied) return denied;
  const nodes = await prismaPrimary.orgChartNode.findMany({
    include: {
      section: { select: { name: true } },
      sectionMemberships: {
        select: {
          sectionId: true,
          roleId: true,
          role: { select: { id: true, label: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  // Keep node company labels in sync with HRIS (e.g. FAMES vs stale LPG).
  const mergedIds = [
    ...new Set(nodes.map((n) => n.mergedSourceUserId.trim()).filter(Boolean)),
  ]
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (mergedIds.length > 0) {
    const people = await prismaSecondary.mergedUser.findMany({
      where: { sourceUserId: { in: mergedIds.map((id) => BigInt(id)) }, isActive: true },
      select: {
        sourceUserId: true,
        name: true,
        role: true,
        position: true,
        department: true,
        companyName: true,
      },
    });
    const byMerged = new Map(
      people.map((person) => {
        const mapped = mapHrisToPortalRole({
          hrisRole: person.role,
          position: person.position,
          department: person.department,
        });
        return [
          person.sourceUserId.toString(),
          {
            personName: person.name,
            personRole: mapped.portalRole,
            companyName: resolveRosterCompanyName(person.companyName) ?? person.companyName,
          },
        ] as const;
      }),
    );

    const refreshOps: Prisma.PrismaPromise<unknown>[] = [];
    for (const node of nodes) {
      const snap = byMerged.get(node.mergedSourceUserId.trim());
      if (!snap) continue;
      let nextCompany = snap.companyName ?? null;
      if (/fames/i.test(node.section?.name ?? "")) {
        nextCompany = "MCHISI FAMES";
      }
      const companyChanged = (node.companyName ?? null) !== nextCompany;
      const nameChanged = node.personName !== snap.personName;
      const roleChanged = (node.personRole ?? null) !== (snap.personRole ?? null);
      if (!companyChanged && !nameChanged && !roleChanged) continue;
      refreshOps.push(
        prismaPrimary.orgChartNode.update({
          where: { id: node.id },
          data: {
            companyName: nextCompany,
            personName: snap.personName,
            personRole: snap.personRole,
          },
        }),
      );
      node.companyName = nextCompany;
      node.personName = snap.personName;
      node.personRole = snap.personRole;
    }
    if (refreshOps.length > 0) {
      await prismaPrimary.$transaction(refreshOps);
    }
  }

  // Preserve prior response shape (section was only loaded for label sync).
  const payload = nodes.map(({ section: _section, ...rest }) => rest);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  const body = (await req.json()) as Record<string, unknown>;
  const fromList = Array.isArray(body.mergedSourceUserIds)
    ? body.mergedSourceUserIds.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  const single = String(body.mergedSourceUserId ?? "").trim();
  const mergedSourceUserIds = [...new Set(fromList.length > 0 ? fromList : single ? [single] : [])];

  if (mergedSourceUserIds.length === 0) {
    return NextResponse.json({ error: "At least one roster member is required." }, { status: 400 });
  }

  const parentResolved = await resolveParentAssignment({
    parentId: body.parentId,
    parentEitherOrLinkId: body.parentEitherOrLinkId,
  });
  if ("error" in parentResolved) {
    return NextResponse.json({ error: parentResolved.error }, { status: parentResolved.status });
  }
  const { parentId, parentEitherOrLinkId } = parentResolved;

  const alreadyOnChart = await prismaPrimary.orgChartNode.findMany({
    where: { mergedSourceUserId: { in: mergedSourceUserIds } },
    select: { id: true, mergedSourceUserId: true },
  });
  const alreadyByRosterId = new Map(
    alreadyOnChart.map((n) => [n.mergedSourceUserId, n.id] as const),
  );
  const candidates = mergedSourceUserIds.filter((id) => !alreadyByRosterId.has(id));

  let sectionId: string | null = null;
  if (body.sectionId !== undefined && body.sectionId !== null && body.sectionId !== "") {
    sectionId = String(body.sectionId);
    const section = await prismaPrimary.orgChartSection.findUnique({
      where: { id: sectionId },
      select: { id: true },
    });
    if (!section) {
      return NextResponse.json({ error: "Section not found." }, { status: 400 });
    }
  }

  // Adding straight into a department: people already on the chart just get
  // membership; only missing people need new nodes.
  if (candidates.length === 0 && !sectionId) {
    return NextResponse.json(
      { error: "Those members are already on the chart." },
      { status: 409 },
    );
  }

  const snapshots = await Promise.all(
    candidates.map(async (id) => [id, await snapshotPerson(id)] as const),
  );
  const missing = snapshots.filter(([, person]) => !person).map(([id]) => id);
  const toCreate = snapshots.filter((entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] =>
    entry[1] != null,
  );
  if (toCreate.length === 0 && alreadyOnChart.length === 0) {
    return NextResponse.json(
      { error: "Members were not found in the active roster." },
      { status: 400 },
    );
  }
  if (toCreate.length === 0 && sectionId == null) {
    return NextResponse.json(
      { error: "Those members are already on the chart." },
      { status: 409 },
    );
  }

  let order = await nextSortOrder(parentId);
  const created =
    toCreate.length > 0
      ? await prismaPrimary.$transaction(
          toCreate.map(([mergedSourceUserId, person]) =>
            prismaPrimary.orgChartNode.create({
              data: {
                mergedSourceUserId,
                personName: person.personName,
                personRole: person.personRole,
                companyName: person.companyName,
                parentId,
                parentEitherOrLinkId,
                sectionId,
                sectionMemberships:
                  sectionId != null
                    ? {
                        create: [{ sectionId }],
                      }
                    : undefined,
                sortOrder: order++,
              },
            }),
          ),
        )
      : [];

  let assignedExisting: string[] = [];
  if (sectionId && alreadyOnChart.length > 0) {
    await prismaPrimary.orgChartNodeSectionMembership.createMany({
      data: alreadyOnChart.map((n) => ({ nodeId: n.id, sectionId })),
      skipDuplicates: true,
    });
    assignedExisting = alreadyOnChart.map((n) => n.id);
    // Keep primary sectionId label in sync for nodes that had none.
    await prismaPrimary.orgChartNode.updateMany({
      where: { id: { in: assignedExisting }, sectionId: null },
      data: { sectionId },
    });
  }

  if (created.length === 0 && assignedExisting.length === 0) {
    return NextResponse.json(
      {
        error:
          missing.length > 0
            ? "Members were not found in the active roster."
            : "Those members are already in this department (or on the chart).",
      },
      { status: missing.length > 0 ? 400 : 409 },
    );
  }

  return NextResponse.json(
    {
      created,
      assignedExisting,
      skippedAlreadyOnChart: sectionId ? [] : [...alreadyByRosterId.keys()],
      skippedMissingRoster: missing,
    },
    { status: 201 },
  );
}

export async function PATCH(req: Request) {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  const body = await req.json();

  // Batch lock / unlock reports-to (Shift-click multi-select).
  if (
    body.ids !== undefined &&
    body.parentLocked !== undefined &&
    body.parentId === undefined &&
    body.parentEitherOrLinkId === undefined
  ) {
    const rawIds: unknown = body.ids;
    const ids = Array.isArray(rawIds)
      ? [...new Set(rawIds.map((x: unknown) => String(x)).filter(Boolean))]
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "At least one node id is required." }, { status: 400 });
    }
    const parentLocked = Boolean(body.parentLocked);
    const result = await prismaPrimary.orgChartNode.updateMany({
      where: { id: { in: ids } },
      data: { parentLocked },
    });
    return NextResponse.json({
      updatedCount: result.count,
      ids,
      parentLocked,
    });
  }

  // Batch re-parent: move several nodes under a single new manager (or root)
  // in one operation. Each moved node's direct reports re-attach to that node's
  // former parent (the next head up), same rule as single-node reparent.
  if (body.ids !== undefined) {
    const rawIds: unknown = body.ids;
    const ids = Array.isArray(rawIds)
      ? [...new Set(rawIds.map((x: unknown) => String(x)).filter(Boolean))]
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "At least one node id is required." }, { status: 400 });
    }

    const parentResolved = await resolveParentAssignment({
      parentId: body.parentId,
      parentEitherOrLinkId: body.parentEitherOrLinkId,
    });
    if ("error" in parentResolved) {
      return NextResponse.json({ error: parentResolved.error }, { status: parentResolved.status });
    }
    const { parentId, parentEitherOrLinkId } = parentResolved;

    if (parentId && ids.includes(parentId)) {
      return NextResponse.json(
        { error: "A member cannot report to themselves." },
        { status: 400 },
      );
    }
    const peerIdsToCheck = new Set<string>();
    if (parentId) peerIdsToCheck.add(parentId);
    if (parentEitherOrLinkId) {
      const link = await prismaPrimary.orgChartEitherOrLink.findUnique({
        where: { id: parentEitherOrLinkId },
        select: { nodeAId: true, nodeBId: true },
      });
      if (link) {
        peerIdsToCheck.add(link.nodeAId);
        peerIdsToCheck.add(link.nodeBId);
      }
    }
    for (const peerId of peerIdsToCheck) {
      if (ids.includes(peerId)) {
        return NextResponse.json(
          { error: "A member cannot report to themselves." },
          { status: 400 },
        );
      }
      for (const nodeId of ids) {
        if (await isDescendantOf(nodeId, peerId)) {
          return NextResponse.json(
            { error: "A member cannot report to one of their own reports." },
            { status: 400 },
          );
        }
      }
    }

    const selected = await prismaPrimary.orgChartNode.findMany({
      where: { id: { in: ids } },
      include: { children: { select: { id: true } } },
    });
    if (selected.length !== ids.length) {
      return NextResponse.json({ error: "One or more nodes were not found." }, { status: 404 });
    }

    const locked = selected.filter((n) => n.parentLocked);
    const toMove = selected.filter((n) => !n.parentLocked);
    if (toMove.length === 0) {
      return NextResponse.json(
        { error: "All selected members are locked to their current manager." },
        { status: 400 },
      );
    }

    const moveIds = toMove.map((n) => n.id);
    const selectedSet = new Set(moveIds);
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    // 1) For every moved node, re-attach only unlocked direct reports that are
    //    not also being moved. Locked children stay under their manager and move
    //    with them when the parent is reparented.
    const childRows =
      toMove.length > 0
        ? await prismaPrimary.orgChartNode.findMany({
            where: { parentId: { in: toMove.map((n) => n.id) } },
            select: { id: true, parentId: true, parentLocked: true },
          })
        : [];
    const orphansByMovedParent = new Map<string, string[]>();
    for (const child of childRows) {
      if (child.parentLocked || !child.parentId || selectedSet.has(child.id)) continue;
      const group = orphansByMovedParent.get(child.parentId) ?? [];
      group.push(child.id);
      orphansByMovedParent.set(child.parentId, group);
    }
    const reattachByParent = new Map<string | null, string[]>();
    for (const n of toMove) {
      const orphans = orphansByMovedParent.get(n.id);
      if (!orphans?.length) continue;
      const group = reattachByParent.get(n.parentId) ?? [];
      group.push(...orphans);
      reattachByParent.set(n.parentId, group);
    }
    for (const [oldParentId, orphanIds] of reattachByParent) {
      const existingSiblings = await prismaPrimary.orgChartNode.findMany({
        where: { parentId: oldParentId, id: { notIn: [...selectedSet] } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const renumbered = [...existingSiblings.map((s) => s.id), ...orphanIds];
      renumbered.forEach((siblingId, i) => {
        ops.push(
          prismaPrimary.orgChartNode.update({
            where: { id: siblingId },
            data: { parentId: oldParentId, sortOrder: i },
          }),
        );
      });
    }

    // 2) Move every unlocked selected node under the new parent, appending in order.
    let order = await nextSortOrder(parentId);
    for (const n of toMove) {
      ops.push(
        prismaPrimary.orgChartNode.update({
          where: { id: n.id },
          data: { parentId, parentEitherOrLinkId, sortOrder: order++ },
        }),
      );
    }

    await prismaPrimary.$transaction(ops);
    return NextResponse.json({
      moved: toMove.map((n) => n.id),
      skippedLocked: locked.map((n) => n.id),
    });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Node id is required." }, { status: 400 });

  const node = await prismaPrimary.orgChartNode.findUnique({
    where: { id },
    include: { children: { select: { id: true } } },
  });
  if (!node) return NextResponse.json({ error: "Node not found." }, { status: 404 });

  // Reorder within the current parent (swap sortOrder with the neighbour).
  if (body.moveUp === true || body.moveDown === true) {
    const siblings = await prismaPrimary.orgChartNode.findMany({
      where: { parentId: node.parentId, id: { not: node.id } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const index = siblings.findIndex((s) => s.sortOrder > node.sortOrder);
    const neighbour =
      body.moveUp === true
        ? siblings[index - 1]
        : index === -1
          ? siblings[siblings.length - 1]
          : siblings[index];
    if (!neighbour) return NextResponse.json(node);
    const updated = await prismaPrimary.$transaction([
      prismaPrimary.orgChartNode.update({
        where: { id: node.id },
        data: { sortOrder: neighbour.sortOrder },
      }),
      prismaPrimary.orgChartNode.update({
        where: { id: neighbour.id },
        data: { sortOrder: node.sortOrder },
      }),
    ]);
    return NextResponse.json(updated[0]);
  }

  // Assign (or clear) labeled section grouping. Hierarchy is unchanged.
  if (body.sectionId !== undefined) {
    let sectionId: string | null = null;
    if (body.sectionId !== null && body.sectionId !== "") {
      sectionId = String(body.sectionId);
      const section = await prismaPrimary.orgChartSection.findUnique({
        where: { id: sectionId },
        select: { id: true },
      });
      if (!section) {
        return NextResponse.json({ error: "Section not found." }, { status: 400 });
      }
    }
    const updated = await prismaPrimary.orgChartNode.update({
      where: { id: node.id },
      data: {
        sectionId,
        sectionMemberships:
          sectionId != null
            ? {
                upsert: {
                  where: {
                    nodeId_sectionId: {
                      nodeId: node.id,
                      sectionId,
                    },
                  },
                  create: { sectionId },
                  update: {},
                },
              }
            : undefined,
      },
      include: {
        sectionMemberships: {
          select: {
            sectionId: true,
            roleId: true,
            role: { select: { id: true, label: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return NextResponse.json(updated);
  }

  // Lock or unlock reports-to assignment for this member.
  if (body.parentLocked !== undefined) {
    const updated = await prismaPrimary.orgChartNode.update({
      where: { id: node.id },
      data: { parentLocked: Boolean(body.parentLocked) },
    });
    return NextResponse.json(updated);
  }

  // Reparent: move this node individually under a new manager, shared either/or
  // link, or root. Unlocked direct reports re-attach to the former parent; locked
  // children stay under this node and move with it. Sending only parentId (drag/drop)
  // clears any shared-link assignment on the moved node itself.
  if (body.parentId !== undefined || body.parentEitherOrLinkId !== undefined) {
    if (node.parentLocked) {
      return NextResponse.json(
        { error: "This member is locked to their current manager. Unlock before changing reports-to." },
        { status: 400 },
      );
    }
    const resolved = await resolveParentAssignment({
      parentId: body.parentEitherOrLinkId ? undefined : body.parentId,
      parentEitherOrLinkId: body.parentEitherOrLinkId,
    });
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { parentId, parentEitherOrLinkId } = resolved;

    if (parentId === node.id) {
      return NextResponse.json(
        { error: "A member cannot report to themselves." },
        { status: 400 },
      );
    }
    const peerIdsToCheck = new Set<string>();
    if (parentId) peerIdsToCheck.add(parentId);
    if (parentEitherOrLinkId) {
      const link = await prismaPrimary.orgChartEitherOrLink.findUnique({
        where: { id: parentEitherOrLinkId },
        select: { nodeAId: true, nodeBId: true },
      });
      if (link) {
        peerIdsToCheck.add(link.nodeAId);
        peerIdsToCheck.add(link.nodeBId);
      }
    }
    for (const peerId of peerIdsToCheck) {
      if (peerId === node.id || (await isDescendantOf(node.id, peerId))) {
        return NextResponse.json(
          { error: "A member cannot report to one of their own reports." },
          { status: 400 },
        );
      }
    }

    const oldParentId = node.parentId;
    if (parentId === oldParentId && parentEitherOrLinkId === (node.parentEitherOrLinkId ?? null)) {
      return NextResponse.json(node);
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    const childRows = await prismaPrimary.orgChartNode.findMany({
      where: { parentId: node.id },
      select: { id: true, parentLocked: true },
    });
    const orphanIds = childRows.filter((c) => !c.parentLocked).map((c) => c.id);
    if (orphanIds.length > 0) {
      const existingSiblings = await prismaPrimary.orgChartNode.findMany({
        where: { parentId: oldParentId, id: { not: node.id } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      const renumbered = [...existingSiblings.map((s) => s.id), ...orphanIds];
      renumbered.forEach((siblingId, i) => {
        ops.push(
          prismaPrimary.orgChartNode.update({
            where: { id: siblingId },
            data: { parentId: oldParentId, sortOrder: i },
          }),
        );
      });
    }

    ops.push(
      prismaPrimary.orgChartNode.update({
        where: { id: node.id },
        data: {
          parentId,
          parentEitherOrLinkId,
          sortOrder: await nextSortOrder(parentId),
        },
      }),
    );
    const [updated] = await prismaPrimary.$transaction(ops);
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const denied = await guardSuperAdmin();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Node id is required." }, { status: 400 });

  try {
    const node = await prismaPrimary.orgChartNode.findUnique({
      where: { id },
      include: { children: { select: { id: true } } },
    });
    if (!node) return NextResponse.json({ error: "Node not found." }, { status: 404 });

    // Collect the full descendant tree and delete deepest-first so hierarchy FKs
    // never block removal (works even if the DB cascade differs from the schema).
    const toDelete: string[] = [];
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      toDelete.push(cur);
      const kids = await prismaPrimary.orgChartNode.findMany({
        where: { parentId: cur },
        select: { id: true },
      });
      for (const k of kids) stack.push(k.id);
    }
    toDelete.reverse();

    await prismaPrimary.$transaction(
      toDelete.map((nodeId) => prismaPrimary.orgChartNode.delete({ where: { id: nodeId } })),
    );

    return NextResponse.json({
      removed: node.id,
      removedReports: Math.max(0, toDelete.length - 1),
    });
  } catch (e) {
    console.error("[org-chart DELETE]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not remove member from the chart." },
      { status: 500 },
    );
  }
}
