import type { TicketPriority } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";

export async function getEscalationTrigger(priority: TicketPriority) {
  return prisma.escalationTrigger.findUnique({ where: { priority } });
}

export async function shouldNotifyAdminOnCreate(priority: TicketPriority) {
  const trigger = await getEscalationTrigger(priority);
  if (!trigger?.enabled) return false;
  const target = (trigger.notifyTarget ?? (trigger.notifyAdmin ? "ADMIN" : "NONE")).toUpperCase();
  return target === "ADMIN" || target === "ADMIN_AND_SUPERADMIN";
}

export async function shouldNotifySuperAdminOnCreate(priority: TicketPriority) {
  const trigger = await getEscalationTrigger(priority);
  if (!trigger?.enabled) return false;
  const target = (trigger.notifyTarget ?? (trigger.notifyAdmin ? "ADMIN" : "NONE")).toUpperCase();
  return target === "SUPERADMIN" || target === "ADMIN_AND_SUPERADMIN";
}
