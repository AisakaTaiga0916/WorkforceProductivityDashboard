import { redirect } from "next/navigation";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";

export const dynamic = "force-dynamic";

export default async function WorkIndexPage() {
  const tasksEnabled = await isSystemModuleEnabled("tasks");
  if (!tasksEnabled && (await isSystemModuleEnabled("projects"))) {
    redirect("/work/projects");
  }
  redirect("/work/tasks");
}
