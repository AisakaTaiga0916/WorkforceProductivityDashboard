import { isElevatedPlatformRole, type PortalRole } from "@/lib/staff-role";

/** Roles that can file tickets as a requestor and must confirm their own resolutions. */
export function isTicketRequestorRole(role: string | undefined | null): role is PortalRole {
  return (
    role === "Customer" ||
    role === "Personnel" ||
    role === "Admin" ||
    isElevatedPlatformRole(role)
  );
}

export function ticketRequestorNavLabel(role: string | undefined | null): string {
  if (role === "Admin" || isElevatedPlatformRole(role)) return "Admin";
  if (role === "Personnel") return "Personnel";
  return "Customer";
}
