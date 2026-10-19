import { requireSession } from "@/lib/access";
import { redirect } from "next/navigation";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";
import { ModuleDisabledNotice } from "@/components/ModuleDisabledNotice";
import { ProjectStatusBoard } from "./project-status-board";

export const dynamic = "force-dynamic";

export default async function WorkProjectsPage() {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!["SuperAdmin", "HighAdmin", "Personnel", "Admin"].includes(session.user.role)) redirect("/");
  if (!(await isSystemModuleEnabled("projects"))) return <ModuleDisabledNotice module="projects" />;
  return <ProjectStatusBoard />;
}
