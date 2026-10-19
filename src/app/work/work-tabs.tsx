"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useSystemModules } from "@/modules/platform/settings/system-modules-client";

const TABS = [
  { id: "tasks", href: "/work/tasks", label: "Tasks" },
  { id: "projects", href: "/work/projects", label: "Projects" },
] as const;

export function WorkTabs() {
  const pathname = usePathname();
  const modules = useSystemModules();
  const visible = TABS.filter((tab) => modules[tab.id]);
  if (visible.length <= 1) return null;

  return (
    <nav
      aria-label="Work sections"
      className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800"
    >
      {visible.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
              active
                ? "border-orange-600 text-orange-700 dark:border-orange-400 dark:text-orange-300"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
