import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { orgChartLayerById } from "./org-chart-layers";
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
  const initialTab =
    tabParam === "access"
      ? "access"
      : tabParam === "faq"
        ? "faq"
        : tabParam === "intake"
          ? "intake"
          : tabParam === "workforce"
            ? "workforce"
            : tabParam === "tasks"
              ? "tasks"
              : "alerts";

  const [triggers, orgLayerNodes] = await Promise.all([
    prisma.escalationTrigger.findMany({ orderBy: { priority: "asc" } }),
    // Only the edges are needed: the access matrix labels the deepest layer.
    prisma.orgChartNode.findMany({ select: { id: true, parentId: true } }),
  ]);

  const layerById = orgChartLayerById(orgLayerNodes);
  let maxOrgLayer = 1;
  for (const layer of layerById.values()) maxOrgLayer = Math.max(maxOrgLayer, layer);

  return (
    <SuperAdminSettingsClient
      initialTab={initialTab}
      initialTriggers={triggers}
      maxOrgLayer={maxOrgLayer}
    />
  );
}
