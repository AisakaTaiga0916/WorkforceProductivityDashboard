import { redirect } from "next/navigation";
import { superAdminSettingsHref } from "@/lib/superadmin-settings-tabs";

/** Account management moved to Settings → User Management (IAM lives there now). */
export default function AccountManagementRedirectPage() {
  redirect(superAdminSettingsHref("users"));
}
