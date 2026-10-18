import type { PortalRole } from "@/lib/staff-role";

/** Normalized profile used by the sync layer regardless of source DB. */
export type CanonicalUserProfile = {
  email: string;
  name: string;
  username?: string | null;
  image?: string | null;
  portalRole: PortalRole;
  headPrivileges: boolean;
  hrisSourceUserId?: bigint | null;
  hrisRole?: string | null;
  position?: string | null;
  department?: string | null;
  companyName?: string | null;
  companyExternalId?: bigint | null;
  emailVerified?: boolean;
  oauth?: {
    provider: string;
    providerAccountId: string;
  } | null;
};

export type SyncPortalProfileOptions = {
  /** When true, portal/auth roles always follow merged HRIS mapping (no upgrade-only policy). */
  forceRoleRefresh?: boolean;
};

export type SyncSource = "oauth" | "hris" | "migration";

export function normalizeCanonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function fallbackEmailFromUsername(username: string | null | undefined): string {
  const u = username?.trim().toLowerCase();
  if (u) return `${u}@hris.merged`;
  return "unknown@hris.merged";
}
