import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { verifyEmailVerificationToken } from "@/lib/email-verification-token";
import { prisma } from "@/modules/platform/db/prisma";
import { EmailVerificationClient } from "@/app/verification/email/ui";

export const dynamic = "force-dynamic";

export default async function CustomerEmailVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; action?: string }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (session.user.role !== "Customer") redirect("/");

  const { token, action } = await searchParams;
  const parsed = token ? verifyEmailVerificationToken(token) : null;
  if (!token || !parsed) notFound();

  const ticket = await prisma.ticket.findUnique({
    where: { id: parsed.ticketId },
    select: {
      ticketNumber: true,
      title: true,
      contactName: true,
      requestorEmail: true,
      contactEmail: true,
    },
  });
  if (!ticket) notFound();
  const target = (ticket.requestorEmail ?? ticket.contactEmail).toLowerCase();
  const sessionEmail = (session.user.email ?? "").toLowerCase();
  if (target !== parsed.recipientEmail.toLowerCase()) notFound();
  if (sessionEmail !== target && sessionEmail !== ticket.contactEmail.toLowerCase()) redirect("/my-tickets");

  return (
    <EmailVerificationClient
      token={token}
      ticketNumber={ticket.ticketNumber}
      title={ticket.title}
      greetingName={ticket.contactName}
      initialAction={action === "reject" ? "reject" : null}
    />
  );
}
