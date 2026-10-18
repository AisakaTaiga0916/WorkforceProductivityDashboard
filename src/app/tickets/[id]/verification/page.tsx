import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { customerCanAccessTicket, requireSession } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";
import { TicketVerificationForm } from "./ui";

export const dynamic = "force-dynamic";

export default async function TicketVerificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
  });
  if (!ticket) notFound();
  if (
    session.user.role === "Customer" &&
    !customerCanAccessTicket(
      { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
      session.user.email,
    )
  ) {
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 bg-zinc-50 px-3 py-4 text-zinc-900 dark:bg-[#0e0e0d] dark:text-zinc-100 sm:px-4">
      <h1 className="text-2xl font-semibold text-zinc-50">
        Verify ticket {ticket.ticketNumber}
      </h1>
      <p className="text-sm text-zinc-400">{ticket.title}</p>
      <TicketVerificationForm ticketId={ticket.id} />
      <Link href={`/tickets/${ticket.id}`} className="text-sm text-orange-300 hover:underline">
        Back to ticket details
      </Link>
    </main>
  );
}
