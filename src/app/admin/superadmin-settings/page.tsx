import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";
import { parseSuperAdminSettingsTab } from "@/lib/superadmin-settings-tabs";
import { SuperAdminSettingsClient } from "./ui";

export const dynamic = "force-dynamic";

export default async function SuperAdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (session.user.role !== "SuperAdmin") redirect("/");

  const params = await searchParams;
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  // Legacy ?tab=orgchart / ?tab=sections / ?tab=positions → Workforce → Org.
  // Chart, which now owns the chart, sectioning, and positions UI.
  if (tabParam === "orgchart" || tabParam === "sections" || tabParam === "positions") {
    redirect("/admin/workforce?view=sections");
  }
  const initialTab = parseSuperAdminSettingsTab(tabParam);

  const triggers = await prisma.escalationTrigger.findMany({ orderBy: { priority: "asc" } });

  return <SuperAdminSettingsClient initialTab={initialTab} initialTriggers={triggers} />;
}
