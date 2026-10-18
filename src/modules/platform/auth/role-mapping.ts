import type { PortalRole } from "@/lib/staff-role";

export type HrisRoleMappingInput = {
  hrisRole: string;
  position?: string | null;
  department?: string | null;
};

export type MappedPortalRole = {
  portalRole: PortalRole;
  headPrivileges: boolean;
};

/** Default HRIS → portal mappings when auth_role_mappings row is absent. */
export const DEFAULT_HRIS_ROLE_MAPPINGS: ReadonlyArray<{
  hrisRole: string;
  portalRole: PortalRole;
  headPrivileges: boolean;
}> = [
  { hrisRole: "super_admin", portalRole: "SuperAdmin", headPrivileges: false },
  { hrisRole: "high_admin", portalRole: "HighAdmin", headPrivileges: false },
  // Staff Admin vs Personnel is driven by org-chart department / sub-department heads.
  { hrisRole: "admin", portalRole: "Personnel", headPrivileges: false },
  { hrisRole: "employee", portalRole: "Personnel", headPrivileges: false },
];

function normalizeHrisToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

const ADMIN_TITLE_PATTERN = /\b(head|leader)\b/;

/**
 * Detect head/leader titles in position or department (legacy helper).
 * Org-chart section heads are the source of truth for portal Admin; title
 * matching no longer auto-elevates on HRIS sync.
 */
export function isHrisHeadTitle(input: Pick<HrisRoleMappingInput, "position" | "department" | "hrisRole">): boolean {
  const tokens = [
    normalizeHrisToken(input.position),
    normalizeHrisToken(input.department),
    normalizeHrisToken(input.hrisRole),
  ].filter(Boolean);

  return tokens.some((t) => ADMIN_TITLE_PATTERN.test(t));
}

/**
 * Map HRIS profile to portal role.
 * - super_admin → SuperAdmin
 * - high_admin → HighAdmin
 * - Everyone else → Personnel (Admin comes from org-chart department / sub-department heads)
 */
export function mapHrisToPortalRole(
  input: HrisRoleMappingInput,
  overrides?: Partial<MappedPortalRole> | null,
): MappedPortalRole {
  const roleKey = normalizeHrisToken(input.hrisRole);

  if (roleKey === "super_admin") {
    return { portalRole: "SuperAdmin", headPrivileges: false };
  }
  if (roleKey === "high_admin") {
    return { portalRole: "HighAdmin", headPrivileges: false };
  }

  if (overrides?.portalRole) {
    const portalRole = overrides.portalRole;
    if (portalRole === "SuperAdmin" || portalRole === "HighAdmin") {
      return { portalRole, headPrivileges: false };
    }
    if (portalRole === "Customer" || portalRole === "Personnel-Guard") {
      return {
        portalRole,
        headPrivileges: overrides.headPrivileges ?? false,
      };
    }
    // Staff overrides: chart reconcile owns Admin; HRIS stays Personnel by default.
    if (portalRole === "Admin") {
      return { portalRole: "Personnel", headPrivileges: false };
    }
    return {
      portalRole: "Personnel",
      headPrivileges: false,
    };
  }

  return { portalRole: "Personnel", headPrivileges: false };
}
