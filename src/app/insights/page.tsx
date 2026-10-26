import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Retired Metrics & Reports page — keeps old bookmarks working. */
export default async function InsightsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const value = Array.isArray(tab) ? tab[0] : tab;
  redirect(value === "task-metrics" || value === "kpi-mgmt" ? "/work/reports?lens=tasks" : "/agent/reports");
}
