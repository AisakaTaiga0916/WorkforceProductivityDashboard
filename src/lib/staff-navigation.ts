import { isElevatedPlatformRole } from "@/lib/staff-role";

export type StaffNavItem = {
  id: string;
  href: string;
  label: string;
  /** When set, item is shown only for these roles. */
  roles?: string[];
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  /** Hidden for Personnel (and Personnel-Guard). */
  staffOnly?: boolean;
};

export type StaffNavSection = {
  id: string;
  label: string;
  items: StaffNavItem[];
  adminOnly?: boolean;
  superAdminOnly?: boolean;
};

const MAIN: StaffNavSection = {
  id: "main",
  label: "Main",
  items: [
    { id: "home", href: "/", label: "Home / Dashboard" },
    { id: "create", href: "/tickets/new", label: "Create Request" },
  ],
};

const MY_WORK: StaffNavSection = {
  id: "my-work",
  label: "My Work",
  items: [
    { id: "my-assigned", href: "/agent", label: "My Assigned" },
    { id: "my-requests", href: "/agent?pane=mine", label: "My Requests" },
  ],
};

const BOARDS: StaffNavSection = {
  id: "boards",
  label: "Boards",
  items: [
    {
      id: "assignment-board",
      href: "/admin/manual-assignment",
      label: "Assign Requests",
      adminOnly: true,
    },
    { id: "work", href: "/work", label: "Work (Tasks, Projects & Work Plans)" },
    { id: "unassigned", href: "/agent?assigned=UNASSIGNED", label: "Unassigned", adminOnly: true },
  ],
};

const MANAGEMENT: StaffNavSection = {
  id: "management",
  label: "Management",
  adminOnly: true,
  items: [
    {
      id: "workforce",
      href: "/admin/workforce",
      label: "Workforce",
      adminOnly: true,
    },
  ],
};

const SUPERADMIN_SETTINGS: StaffNavSection = {
  id: "superadmin-settings",
  label: "SuperAdmin Settings",
  superAdminOnly: true,
  items: [
    {
      id: "superadmin-settings",
      href: "/admin/superadmin-settings",
      label: "SuperAdmin Settings",
      superAdminOnly: true,
    },
  ],
};

const INSIGHTS: StaffNavSection = {
  id: "insights",
  label: "Reports",
  items: [
    { id: "request-reports", href: "/agent/reports", label: "Request Reports" },
    { id: "work-reports", href: "/work/reports", label: "Work Reports" },
    { id: "process", href: "/process", label: "Process Controls" },
  ],
};

const SYSTEM: StaffNavSection = {
  id: "system",
  label: "System",
  adminOnly: true,
  items: [
    {
      id: "account",
      href: "/admin/account",
      label: "My account",
      adminOnly: true,
    },
  ],
};

const GUARD_MAIN: StaffNavSection = {
  id: "main",
  label: "Main",
  items: [{ id: "travel-orders", href: "/travel-orders", label: "Travel Orders" }],
};

function itemVisible(item: StaffNavItem, role: string | undefined): boolean {
  if (!role) return false;
  if (item.superAdminOnly && role !== "SuperAdmin") return false;
  if (item.adminOnly && !isElevatedPlatformRole(role) && role !== "Admin") return false;
  if (item.roles?.length && !item.roles.includes(role)) return false;
  if (role === "Personnel" && item.id === "unassigned") return false;
  if (role === "Personnel" && item.id === "assignment-board") return false;
  return true;
}

function sectionVisible(section: StaffNavSection, role: string | undefined): boolean {
  if (!role) return false;
  if (section.superAdminOnly && role !== "SuperAdmin") return false;
  if (section.adminOnly && !isElevatedPlatformRole(role) && role !== "Admin") return false;
  const visibleItems = section.items.filter((item) => itemVisible(item, role));
  return visibleItems.length > 0;
}

export function staffNavSectionsForRole(role: string | undefined): StaffNavSection[] {
  if (role === "Personnel-Guard") {
    return [GUARD_MAIN];
  }

  const sections = [MAIN, MY_WORK, BOARDS, MANAGEMENT, SUPERADMIN_SETTINGS, INSIGHTS, SYSTEM];
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => itemVisible(item, role)),
    }))
    .filter((section) => sectionVisible(section, role));
}

export function flattenStaffNavItems(role: string | undefined): StaffNavItem[] {
  return staffNavSectionsForRole(role).flatMap((section) => section.items);
}
