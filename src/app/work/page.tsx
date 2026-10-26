import { redirect } from "next/navigation";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";

export const dynamic = "force-dynamic";

const WORK_TABS = [
  { module: "tasks", href: "/work/tasks" },
  { module: "projects", href: "/work/projects" },
  { module: "work_plans", href: "/work/work-plans" },
] as const;

export default async function WorkIndexPage() {
  for (const tab of WORK_TABS) {
    if (await isSystemModuleEnabled(tab.module)) redirect(tab.href);
  }
  redirect("/work/tasks");
}
