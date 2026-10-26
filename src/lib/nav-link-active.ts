/** Shared active-state logic for sidebar / shell navigation. */
export function navLinkActive(
  pathname: string,
  href: string,
  searchParams?: URLSearchParams | null,
): boolean {
  const params = searchParams ?? null;
  const [path, queryString] = href.split("?");
  const hrefParams = queryString ? new URLSearchParams(queryString) : null;

  if (hrefParams) {
    const onPath = pathname === path || pathname.startsWith(`${path}/`);
    if (!onPath) return false;
    if (path === "/agent" && !hrefParams.has("pane") && params?.get("pane") === "mine") {
      return false;
    }
    for (const [key, value] of hrefParams.entries()) {
      const current = params?.get(key);
      if (key === "board" && path === "/agent" && value === "ticket" && !current) {
        continue;
      }
      if (current !== value) return false;
    }
    return true;
  }

  if (path === "/") return pathname === "/";
  if (path === "/work/tasks") {
    return pathname === "/work/tasks" || pathname.startsWith("/work/tasks/");
  }
  if (path === "/work/projects") {
    return pathname === "/work/projects" || pathname.startsWith("/work/projects/");
  }
  if (path === "/work") {
    return pathname === "/work" || pathname.startsWith("/work/");
  }
  if (path === "/agent/tasks") {
    return pathname === "/agent/tasks" || pathname.startsWith("/agent/tasks/");
  }
  if (path === "/agent") {
    // Requests board only — do not treat Task Board (/agent/tasks) as active.
    if (pathname === "/agent/tasks" || pathname.startsWith("/agent/tasks/")) return false;
    if (
      pathname === "/agent" ||
      pathname === "/agent/reports" ||
      pathname.startsWith("/agent/tickets") ||
      pathname === "/admin/manual-assignment"
    ) {
      if (params?.get("assigned") === "UNASSIGNED") return false;
      if (params?.get("board") === "company") return false;
      if (params?.get("view") === "approvals") return false;
      if (params?.get("pane") === "mine") return false;
      return true;
    }
    return false;
  }
  if (path === "/admin/workforce") {
    return pathname === "/admin/workforce" || pathname.startsWith("/admin/workforce/");
  }
  if (path === "/admin/personnel" || path === "/admin/activities") {
    return pathname.startsWith("/admin/workforce");
  }
  if (path === "/admin/superadmin-settings" || path === "/admin/escalation-triggers") {
    return (
      pathname.startsWith("/admin/superadmin-settings") ||
      pathname.startsWith("/admin/escalation-triggers")
    );
  }
  if (path === "/admin/account" && pathname.startsWith("/admin/account")) return true;
  if (path === "/customer/profile" && pathname.startsWith("/customer")) return true;
  if (path === "/my-tickets" && pathname.startsWith("/my-tickets")) return true;
  if (pathname === path) return true;
  return pathname.startsWith(`${path}/`);
}
