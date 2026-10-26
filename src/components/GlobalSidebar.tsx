"use client";

import { isElevatedPlatformRole, portalRoleDisplayLabel } from "@/lib/staff-role";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckSquare,
  Gauge,
  GitBranch,
  HelpCircle,
  Home,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  PlusSquare,
  Shield,
  Ticket,
  UserCircle,
  UserRound,
  Users,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { navLinkActive } from "@/lib/nav-link-active";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarOpsWidget } from "@/components/SidebarOpsWidget";
import { closeStaffMobileNav, subscribeStaffMobileNav } from "@/lib/staff-mobile-nav";
import { SESSION_PROFILE_IMAGE_ROUTE } from "@/lib/session-profile-image";
import { cn } from "@/lib/cn";
import { useSystemModules } from "@/modules/platform/settings/system-modules-client";
import { isHrefVisibleForModules, type SystemModuleVisibility } from "@/modules/platform/settings/system-modules";

type NavChild = { href: string; label: string };
type NavItem =
  | { kind: "link"; href: string; label: string }
  | { kind: "group"; label: string; children: NavChild[] };

function linksForRole(role: string | undefined): NavItem[] {
  if (isElevatedPlatformRole(role)) {
    const items: NavItem[] = [
      { kind: "link", href: "/", label: "Dashboard" },
      {
        kind: "group",
        label: "Operations",
        children: [
          { href: "/agent", label: "Requests" },
          { href: "/work", label: "Work" },
        ],
      },
      {
        kind: "group",
        label: "Management",
        children: [
          { href: "/admin/workforce", label: "Workforce" },
          ...(role === "SuperAdmin"
            ? [{ href: "/admin/superadmin-settings", label: "SuperAdmin Settings" }]
            : []),
        ],
      },
    ];
    return items;
  }
  if (role === "Admin") {
    return [
      { kind: "link", href: "/", label: "Dashboard" },
      {
        kind: "group",
        label: "Operations",
        children: [
          { href: "/agent", label: "Requests" },
          { href: "/work", label: "Work" },
        ],
      },
      {
        kind: "group",
        label: "Management",
        children: [{ href: "/admin/workforce", label: "Workforce" }],
      },
    ];
  }
  if (role === "Personnel") {
    return [
      { kind: "link", href: "/", label: "Dashboard" },
      {
        kind: "group",
        label: "Operations",
        children: [
          { href: "/agent", label: "Requests" },
          { href: "/work", label: "Work" },
        ],
      },
    ];
  }
  if (role === "Personnel-Guard") {
    return [{ kind: "link", href: "/travel-orders", label: "Travel Orders" }];
  }
  return [{ kind: "link", href: "/", label: "Home" }];
}

/** Drop links (and emptied groups) for modules turned off in System Settings. */
function filterLinksByModules(links: NavItem[], modules: SystemModuleVisibility): NavItem[] {
  return links.flatMap((item): NavItem[] => {
    if (item.kind === "link") return isHrefVisibleForModules(item.href, modules) ? [item] : [];
    const children = item.children.filter((c) => isHrefVisibleForModules(c.href, modules));
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

function iconForLink(label: string) {
  const key = label.toLowerCase();
  if (key === "dashboard") return LayoutDashboard;
  if (key.includes("my request")) return LayoutDashboard;
  if (key === "tickets") return Ticket;
  if (key === "tasks") return CheckSquare;
  if (key === "work") return CheckSquare;
  if (key.includes("ticket board")) return Ticket;
  if (key.includes("task board")) return CheckSquare;
  if (key.includes("home") || key.includes("dashboard")) return Home;
  if (key.includes("ticket")) return Ticket;
  if (key.includes("metrics") || key.includes("reports")) return BarChart3;
  if (key.includes("metric")) return Gauge;
  if (key.includes("analytics")) return BarChart3;
  if (key.includes("report")) return Activity;
  if (key.includes("workforce")) return Users;
  if (key.includes("personnel")) return Users;
  if (key.includes("activities")) return Activity;
  if (key.includes("org chart") || key.includes("organization")) return GitBranch;
  if (key.includes("section")) return Layers;
  if (key.includes("superadmin")) return Shield;
  if (key.includes("settings")) return Shield;
  if (key === "faq") return HelpCircle;
  if (key.includes("my account")) return UserCircle;
  if (key.includes("account")) return UserCircle;
  if (key.includes("escalation") || key.includes("priority")) return LifeBuoy;
  if (key.includes("process")) return GitBranch;
  if (key.includes("submit")) return PlusSquare;
  if (key.includes("queue metrics")) return Gauge;
  if (key.includes("create request")) return PlusSquare;
  if (key.includes("requests")) return Ticket;
  if (key.includes("travel")) return Ticket;
  return Home;
}

function NavLinkRow({
  href,
  label,
  active,
  onNavigate,
  dense,
  variant = "row",
}: {
  href: string;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  dense?: boolean;
  /** Square app tiles (mobile overlay + desktop sidebar). */
  variant?: "row" | "card" | "tile";
}) {
  const Icon = iconForLink(label);

  if (variant === "tile") {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        className={cn(
          "flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-2.5 text-center transition sm:gap-2.5 sm:px-2.5 sm:py-3",
          active
            ? "border-orange-500/60 bg-orange-500/15 text-orange-950 dark:border-orange-400/70 dark:bg-orange-500/20 dark:text-orange-50"
            : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/12 dark:bg-[var(--surface-elevated)] dark:text-zinc-50 dark:hover:border-white/20 dark:hover:bg-[var(--surface-muted)]",
        )}
      >
        <span
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl sm:size-12",
            active
              ? "bg-orange-600 text-white"
              : "bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-200 dark:bg-[var(--surface-muted)] dark:text-zinc-100 dark:ring-white/15",
          )}
        >
          <Icon size={22} strokeWidth={2.1} />
        </span>
        <span className="line-clamp-2 max-w-full text-[11px] font-semibold leading-snug tracking-tight text-inherit sm:text-[13px]">
          {label}
        </span>
      </Link>
    );
  }

  if (variant === "card") {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2.5 rounded-xl border px-2.5 py-2.5 transition",
          active
            ? "border-orange-500/45 bg-orange-500/15 text-orange-900 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.12)] dark:text-orange-100"
            : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:border-white/20 dark:hover:bg-white/[0.07]",
        )}
      >
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
            active
              ? "bg-orange-600 text-white"
              : "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/10",
          )}
        >
          <Icon size={16} strokeWidth={2.1} />
        </span>
        <span className="min-w-0 flex-1 text-left text-[12px] font-semibold leading-snug tracking-tight">
          {label}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-xl transition",
        dense ? "px-2.5 py-1.5" : "px-3 py-2",
        active
          ? "bg-orange-500/15 text-orange-800 ring-1 ring-inset ring-orange-500/25 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-400/20"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
      )}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg",
          dense ? "size-7" : "size-8",
          active
            ? "bg-orange-600 text-white"
            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
        )}
      >
        <Icon size={dense ? 14 : 16} strokeWidth={2.1} />
      </span>
      <span className={cn("min-w-0 flex-1 truncate font-semibold", dense ? "text-xs" : "text-sm")}>{label}</span>
    </Link>
  );
}

function flattenNavLinks(links: NavItem[]): { href: string; label: string }[] {
  return links.flatMap((item) =>
    item.kind === "link"
      ? [{ href: item.href, label: item.label }]
      : item.children.map((child) => ({ href: child.href, label: child.label })),
  );
}

export function GlobalSidebar({ initialRole }: { initialRole?: string }) {
  return (
    <Suspense fallback={null}>
      <GlobalSidebarInner initialRole={initialRole} />
    </Suspense>
  );
}

function GlobalSidebarInner({ initialRole }: { initialRole?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useSession();
  const role = data?.user?.role ?? initialRole;
  const modules = useSystemModules(Boolean(role) && role !== "Customer");
  const roleLabel = portalRoleDisplayLabel(role) || "Staff";
  const userName = data?.user?.name ?? data?.user?.email ?? "Account";
  const userEmail = data?.user?.email ?? "";
  const avatarEmail = userEmail.trim().toLowerCase();
  const avatarSrc = data?.user
    ? data.user.image && /^https?:\/\//i.test(data.user.image)
      ? data.user.image
      : `${SESSION_PROFILE_IMAGE_ROUTE}?u=${encodeURIComponent(avatarEmail || data.user.id || "me")}`
    : undefined;
  const accountActive = navLinkActive(pathname, "/admin/account");
  const [collapsed, setCollapsed] = useState(false);
  const [mobilePresent, setMobilePresent] = useState(false);
  const [mobileEntered, setMobileEntered] = useState(false);
  const mobileCloseTimer = useRef<number | null>(null);
  const MOBILE_SLIDE_MS = 320;

  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem("sidebar-collapsed");
      setCollapsed(stored === "1");
    });
  }, []);

  useEffect(() => {
    return () => {
      if (mobileCloseTimer.current != null) window.clearTimeout(mobileCloseTimer.current);
    };
  }, []);

  function openMobile() {
    if (mobileCloseTimer.current != null) {
      window.clearTimeout(mobileCloseTimer.current);
      mobileCloseTimer.current = null;
    }
    setMobilePresent(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setMobileEntered(true));
    });
  }

  function closeMobile() {
    setMobileEntered(false);
    if (mobileCloseTimer.current != null) window.clearTimeout(mobileCloseTimer.current);
    mobileCloseTimer.current = window.setTimeout(() => {
      setMobilePresent(false);
      mobileCloseTimer.current = null;
      closeStaffMobileNav();
    }, MOBILE_SLIDE_MS);
  }

  useEffect(() => {
    return subscribeStaffMobileNav((open) => {
      if (open) openMobile();
      else closeMobile();
    });
    // openMobile/closeMobile only use setState + refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mobileCloseTimer.current != null) {
      window.clearTimeout(mobileCloseTimer.current);
      mobileCloseTimer.current = null;
    }
    setMobileEntered(false);
    setMobilePresent(false);
    closeStaffMobileNav();
  }, [pathname]);

  useEffect(() => {
    if (!mobilePresent) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobilePresent]);

  if (
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/customer/signin" ||
    pathname === "/customer/signup"
  ) {
    return null;
  }

  const links = filterLinksByModules(linksForRole(role), modules);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  }

  function onFloatingNavClick() {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      toggleCollapsed();
      return;
    }
    if (mobilePresent) closeMobile();
    else openMobile();
  }

  const showMobileFab = !mobilePresent;

  return (
    <>
      {/* Borderless >> / << control — slides with the sidebar */}
      <button
        type="button"
        onClick={onFloatingNavClick}
        className={cn(
          "fixed top-1/2 z-[88] -translate-y-1/2 text-zinc-500 transition-[left,color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-orange-600 dark:text-zinc-400 dark:hover:text-orange-400",
          "inline-flex items-center justify-center p-1",
          showMobileFab ? "left-2 max-lg:flex" : "max-lg:hidden",
          "lg:flex",
          collapsed ? "lg:left-2" : "lg:left-[calc(16rem+0.35rem)]",
        )}
        aria-label={collapsed ? "Open navigation" : "Hide navigation"}
        title={collapsed ? "Open navigation" : "Hide navigation"}
      >
        <span className="relative inline-flex size-[22px] items-center justify-center">
          <ChevronsRight
            size={22}
            strokeWidth={2.25}
            className={cn(
              "absolute transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              collapsed ? "scale-100 opacity-100" : "scale-75 opacity-0 max-lg:scale-100 max-lg:opacity-100",
              !collapsed && "lg:pointer-events-none",
            )}
            aria-hidden
          />
          <ChevronsLeft
            size={22}
            strokeWidth={2.25}
            className={cn(
              "absolute hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block",
              collapsed ? "pointer-events-none scale-75 opacity-0" : "scale-100 opacity-100",
            )}
            aria-hidden
          />
        </span>
      </button>

      {mobilePresent ? (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={closeMobile}
            className={cn(
              "fixed inset-0 z-[89] bg-zinc-950/45 transition-opacity duration-300 ease-out lg:hidden dark:bg-black/55",
              mobileEntered ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-[90] flex w-full max-w-none flex-col bg-zinc-50 text-zinc-900 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden dark:bg-zinc-950 dark:text-zinc-100",
              mobileEntered ? "translate-x-0" : "-translate-x-full",
            )}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] sm:gap-3 sm:px-4 dark:border-white/10">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold tracking-wide text-zinc-900 dark:text-white">Menu</p>
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-300">
                  Navigate
                </p>
              </div>

              <button
                type="button"
                onClick={closeMobile}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 transition hover:bg-zinc-100 dark:border-white/25 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                aria-label="Close navigation menu"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <nav className="px-4 py-5" aria-label="Primary">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 landscape:grid-cols-3">
                  {flattenNavLinks(links).map((item) => (
                    <NavLinkRow
                      key={`m-${item.href}-${item.label}`}
                      href={item.href}
                      label={item.label}
                      active={navLinkActive(pathname, item.href, searchParams)}
                      onNavigate={closeMobile}
                      variant="tile"
                    />
                  ))}
                </div>
              </nav>

              <div className="px-4 pb-4">
                <SidebarOpsWidget compact />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-4 dark:border-white/10">
              <Link
                href="/admin/account"
                onClick={closeMobile}
                title={`${userName} · ${userEmail}`}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 transition",
                  accountActive
                    ? "bg-orange-500/15 ring-1 ring-inset ring-orange-500/30 dark:bg-orange-500/20 dark:ring-orange-400/40"
                    : "hover:bg-zinc-100 dark:hover:bg-white/10",
                )}
              >
                <Avatar className="size-8 shrink-0 border border-orange-500/40 bg-gradient-to-br from-orange-500 to-orange-700 text-white sm:size-9">
                  <AvatarImage src={avatarSrc} alt={userName} />
                  <AvatarFallback className="bg-transparent">
                    <UserRound className="size-3.5 sm:size-4" aria-hidden />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-snug text-zinc-900 dark:text-white">{userName}</p>
                  <p className="truncate text-[11px] font-medium leading-snug text-orange-600 dark:text-orange-300">{roleLabel}</p>
                </div>
              </Link>

              <button
                type="button"
                onClick={() => {
                  closeMobile();
                  void signOut({ callbackUrl: "/" });
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-orange-600 px-2.5 text-xs font-semibold text-white transition hover:bg-orange-500 sm:px-3"
                title="Sign out"
              >
                <LogOut size={14} aria-hidden />
                <span className="max-sm:sr-only">Sign out</span>
              </button>
            </div>
          </div>
        </>
      ) : null}

      <aside
        className={cn(
          "hidden h-full min-h-0 shrink-0 flex-col self-stretch overflow-hidden lg:flex",
          "transition-[width,min-width,max-width,opacity,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed
            ? "pointer-events-none w-0 min-w-0 max-w-0 border-transparent bg-transparent opacity-0"
            : "w-64 min-w-64 max-w-64 border-r border-zinc-200 bg-zinc-50 opacity-100 dark:border-zinc-800 dark:bg-zinc-950",
        )}
        aria-hidden={collapsed}
      >
        <div
          className={cn(
            "flex h-full w-64 min-h-0 flex-col",
            "transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            collapsed
              ? "pointer-events-none -translate-x-4 opacity-0"
              : "translate-x-0 opacity-100",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200/80 px-3 py-2.5 dark:border-zinc-800">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold tracking-wide text-zinc-900 dark:text-zinc-100">
                Menu
              </p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Navigate
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <nav className="px-2.5 py-2.5" aria-label="Primary">
                <div className="grid grid-cols-2 gap-2">
                  {flattenNavLinks(links).map((item) => (
                    <NavLinkRow
                      key={`d-${item.href}-${item.label}`}
                      href={item.href}
                      label={item.label}
                      active={navLinkActive(pathname, item.href, searchParams)}
                      variant="tile"
                    />
                  ))}
                </div>
              </nav>

              <div className="px-2.5 pb-2.5">
                <SidebarOpsWidget />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-zinc-200/80 px-3 py-2.5 dark:border-zinc-800">
            <Link
              href="/admin/account"
              title={`${userName} · ${userEmail}`}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 transition",
                accountActive
                  ? "bg-orange-500/15 ring-1 ring-inset ring-orange-500/25"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
              )}
            >
              <Avatar className="size-8 shrink-0 border border-orange-500/30 bg-gradient-to-br from-orange-600 to-orange-800 text-white">
                <AvatarImage src={avatarSrc} alt={userName} />
                <AvatarFallback className="bg-transparent">
                  <UserRound className="size-3.5" aria-hidden />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                  {userName}
                </p>
                <p className="truncate text-[11px] font-medium leading-snug text-orange-600 dark:text-orange-400">
                  {roleLabel}
                </p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/" })}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-orange-600 px-2.5 text-xs font-semibold text-white transition hover:bg-orange-500"
              title="Sign out"
            >
              <LogOut size={13} aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
