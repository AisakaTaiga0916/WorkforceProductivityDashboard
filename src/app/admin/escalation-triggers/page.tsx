import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Priority alerts now live in SuperAdmin Settings → System Settings. */
export default async function EscalationTriggersPage() {
  redirect("/admin/superadmin-settings?tab=system");
}
