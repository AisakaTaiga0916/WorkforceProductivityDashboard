import { isElevatedUserRole } from "@/modules/platform/auth";
import { isPersonnelGuardPortalRole } from "@/lib/staff-role";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerHomeDashboard } from "@/components/portal/CustomerHomeDashboard";
import { PersonalizedStaffDashboard } from "@/components/dashboard/PersonalizedStaffDashboard";
import {
  customerHasPendingResolvedTicket,
  customerPendingTicketHref,
} from "@/modules/requests/customer-pending-resolution";
import { loadStaffDashboardHome } from "@/lib/dashboard-home";
import { safeGetServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await safeGetServerSession();

  if (isPersonnelGuardPortalRole(session?.user?.role)) {
    redirect("/travel-orders");
  }

  if (session?.user?.role === "Customer") {
    const email = session.user.email ?? "";
    const first = session.user.name?.split(" ")[0] ?? "there";
    const pending = email
      ? await customerHasPendingResolvedTicket(email, session.user.authProvider)
      : null;
    return (
      <CustomerHomeDashboard
        email={email}
        firstName={first}
        canCreateTickets={!pending}
        pendingVerificationHref={pending ? customerPendingTicketHref(pending) : null}
      />
    );
  }

  if (
    isElevatedUserRole(session?.user?.role) ||
    session?.user?.role === "Admin" ||
    session?.user?.role === "Personnel"
  ) {
    const user = session!.user;
    const now = new Date();
    const nowLabel = `${now.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    })} · ${now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
    const data = await loadStaffDashboardHome(session!);

    return (
      <PersonalizedStaffDashboard data={data} role={user.role ?? "Personnel"} nowLabel={nowLabel} />
    );
  }

  if (session?.user) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-[#0a0b12] dark:text-zinc-100">
        <div className="mx-auto max-w-6xl space-y-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-[0_12px_40px_rgba(0,0,0,0.06)] md:p-10 dark:border-zinc-800/90 dark:bg-[#12161c] dark:shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
              General-purpose ticketing
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight text-zinc-900 md:text-4xl dark:text-white">
              Capture requests, honor SLAs, and close the loop with customers.
            </h1>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/tickets/new"
                className="inline-flex items-center justify-center rounded-full bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-500"
              >
                Submit a ticket
              </Link>
              <Link
                href="/agent"
                className="inline-flex items-center justify-center rounded-full border border-zinc-400 px-6 py-2.5 text-sm font-semibold text-zinc-800 transition hover:border-zinc-600 hover:text-zinc-950 dark:border-zinc-500 dark:text-zinc-100 dark:hover:border-zinc-300 dark:hover:text-white"
              >
                Open agent console
              </Link>
              <Link
                href="/agent/reports"
                className="inline-flex items-center justify-center rounded-full border border-zinc-400 px-6 py-2.5 text-sm font-semibold text-zinc-800 transition hover:border-zinc-600 hover:text-zinc-950 dark:border-zinc-500 dark:text-zinc-100 dark:hover:border-zinc-300 dark:hover:text-white"
              >
                View reports
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  redirect("/signin");
}
