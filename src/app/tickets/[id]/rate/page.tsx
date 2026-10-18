import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { customerCanAccessTicket, requireSession } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";
import { TicketRatingForm } from "./ui";

export const dynamic = "force-dynamic";

export default async function TicketRatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stars?: string }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const { stars } = await searchParams;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { feedback: true },
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

  const verificationAudit = await prisma.ticketActivity.findMany({
    where: {
      ticketId: id,
      summary: { in: ["Resolution verification approved", "Resolution verification rejected"] },
    },
    orderBy: { createdAt: "asc" },
    select: { summary: true },
  });
  let resolutionVerified = false;
  for (const a of verificationAudit) {
    if (a.summary === "Resolution verification approved") resolutionVerified = true;
    if (a.summary === "Resolution verification rejected") resolutionVerified = false;
  }
  if (!resolutionVerified) {
    redirect(`/tickets/${id}/verification`);
  }

  const seedStars = Math.min(5, Math.max(1, Number.parseInt(stars ?? "5", 10) || 5));

  return (
    <main className="mx-auto max-w-3xl space-y-4 bg-zinc-50 px-3 py-4 text-zinc-900 dark:bg-[#0e0e0d] dark:text-zinc-100 sm:px-4">
      <h1 className="text-2xl font-semibold text-zinc-50">
        Rate ticket {ticket.ticketNumber}
      </h1>
      <p className="text-sm text-zinc-400">{ticket.title}</p>
      <TicketRatingForm ticketId={ticket.id} initialStars={seedStars} />
      <Link href={`/tickets/${ticket.id}`} className="text-sm text-orange-300 hover:underline">
        Back to ticket details
      </Link>
    </main>
  );
}
