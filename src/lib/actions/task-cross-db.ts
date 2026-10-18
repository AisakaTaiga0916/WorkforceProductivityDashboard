"use server";

import { prismaPrimary, prismaSecondary } from "@/modules/platform/db/prisma";

export async function getMergedTaskWithPrimaryRelations(taskSourceId: string) {
  const task = await prismaSecondary.mergedTaskItem.findUnique({
    where: { sourceId: taskSourceId },
    include: {
      activities: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!task) return null;

  const createdBy = task.createdBy
    ? await prismaPrimary.portalAccount.findUnique({
        where: { id: task.createdBy },
        select: { id: true, name: true, email: true, role: true },
      })
    : null;

  return { ...task, createdByPortalAccount: createdBy };
}

export async function getMergedEmployeeWithRecentClockIns(sourceUserId: bigint) {
  const [user, clockIns] = await Promise.all([
    prismaSecondary.mergedUser.findUnique({ where: { sourceUserId } }),
    prismaSecondary.mergedAttendanceClockIn.findMany({
      where: { sourceUserId },
      orderBy: { clockInAt: "desc" },
      take: 10,
    }),
  ]);

  if (!user) return null;
  return { user, clockIns };
}
