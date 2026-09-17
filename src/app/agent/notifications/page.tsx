import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { isElevatedUserRole } from "@/lib/auth";
import { NotificationsHistoryClient } from "@/components/notifications/NotificationsHistoryClient";

export const dynamic = "force-dynamic";

export default async function NotificationsHistoryPage() {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");

  const role = session.user.role;
  if (role !== "Admin" && role !== "Personnel" && !isElevatedUserRole(role)) {
    redirect("/agent");
  }

  return <NotificationsHistoryClient userEmail={session.user.email ?? "unknown"} />;
}
