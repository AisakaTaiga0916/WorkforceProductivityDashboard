import { BRAND_TITLE } from "@/lib/brand";
import { isElevatedUserRole } from "@/modules/platform/auth";
import { requireSession } from "@/lib/access";
import { redirect } from "next/navigation";
import { WorkTabs } from "./work-tabs";

export const dynamic = "force-dynamic";

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!isElevatedUserRole(session.user.role) && !["Personnel", "Admin"].includes(session.user.role)) {
    redirect("/");
  }

  return (
    <main className="flex min-h-[calc(100vh-56px)] flex-col bg-zinc-50 px-3 py-4 text-zinc-900 dark:bg-background dark:text-zinc-100 sm:px-4">
      <div className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col space-y-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400/95">
            {BRAND_TITLE} · Work
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:mt-1.5 sm:text-2xl">
            Work
          </h1>
          <p className="mt-1 hidden text-sm text-zinc-600 dark:text-zinc-400 sm:block">
            Tasks, projects, and work plans in one place.
          </p>
        </div>
        <WorkTabs />
        {children}
      </div>
    </main>
  );
}
