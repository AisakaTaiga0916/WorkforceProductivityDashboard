import { PORTAL_ROLES } from "@/lib/staff-role";

export function portalRegistryRoleLabel(role: (typeof PORTAL_ROLES)[number]) {
  if (role === "SuperAdmin") return "Super Admin (platform)";
  if (role === "HighAdmin") return "High Admin (platform + approver)";
  return role;
}
