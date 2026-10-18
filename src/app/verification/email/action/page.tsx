import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyEmailVerificationToken } from "@/lib/email-verification-token";
import { prisma } from "@/modules/platform/db/prisma";
import { isAwaitingCustomerConfirmation } from "@/modules/requests/customer-pending-resolution";
import { logActivity } from "@/modules/requests/ticket-actions";
import { normalizeFeedbackComment, validateFeedbackForRating } from "@/modules/requests/ticket-feedback-policy";

const RATING_ALLOWED_STATUSES = ["FOR_CONFIRMATION", "RESOLVED", "CLOSED"];

type Action = "verify" | "reject" | "rate";

function verifiedFromActivities(activities: Array<{ summary: string }>) {
  let verified = false;
  for (const a of activities) {
    if (a.summary === "Resolution verification approved") verified = true;
    if (a.summary === "Resolution verification rejected") verified = false;
  }
  return verified;
}

export default async function EmailActionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; action?: string; stars?: string; comment?: string }>;
}) {
  const { token, action, stars, comment } = await searchParams;
  const parsed = token ? verifyEmailVerificationToken(token) : null;
  if (!parsed || !action) notFound();
  const act = action as Action;
  if (!["verify", "reject", "rate"].includes(act)) notFound();

  const ticket = await prisma.ticket.findUnique({
    where: { id: parsed.ticketId },
    include: {
      activities: {
        where: {
          summary: { in: ["Resolution verification approved", "Resolution verification rejected"] },
        },
        orderBy: { createdAt: "asc" },
        select: { summary: true },
      },
    },
  });
  if (!ticket) notFound();
  const targetEmail = (ticket.requestorEmail ?? ticket.contactEmail).toLowerCase();
  if (targetEmail !== parsed.recipientEmail.toLowerCase()) notFound();

  let title = "Action completed";
  let message = "Your response has been recorded.";

  if (act === "verify") {
    if (isAwaitingCustomerConfirmation(ticket.status)) {
      await logActivity(
        ticket.id,
        "USER",
        "Resolution verification approved",
        "Requestor confirmed resolution via email action link.",
      );
      title = "Verification confirmed";
      message = "Resolution verified. You can now submit a star review from this email.";
    } else {
      title = "No action taken";
      message = "This ticket is no longer awaiting verification.";
    }
  }

  if (act === "reject") {
    if (isAwaitingCustomerConfirmation(ticket.status)) {
      const reopenStatus = ticket.priority === "UNSET" ? "OPEN" : "IN_PROGRESS";
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: reopenStatus,
          resolvedAt: null,
          reopenCount: ticket.reopenCount + 1,
        },
      });
      await logActivity(
        ticket.id,
        "USER",
        "Resolution verification rejected",
        "Rejected from email action link.",
      );
      title = "Marked as not verified";
      message =
        reopenStatus === "OPEN"
          ? "Ticket has been returned to the open queue until a priority level is set."
          : "Ticket has been returned to In progress for further work.";
    } else {
      title = "No action taken";
      message = "This ticket is no longer awaiting verification.";
    }
  }

  if (act === "rate") {
    const value = Number(stars);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      title = "Invalid star rating";
      message = "Please use a valid star link from the email.";
    } else if (!RATING_ALLOWED_STATUSES.includes(ticket.status)) {
      title = "Rating not allowed";
      message = "Ticket is not in a state that accepts rating.";
    } else if (!verifiedFromActivities(ticket.activities)) {
      title = "Verification required";
      message = "Please click Verify first before submitting star rating.";
    } else if (validateFeedbackForRating(value, comment)) {
      title = "Feedback required";
      message = "Ratings of 3 stars or below require written feedback. Please open the portal rating form to complete your review.";
    } else {
      const normalizedComment = normalizeFeedbackComment(comment);
      await prisma.ticketFeedback.upsert({
        where: { ticketId: ticket.id },
        create: {
          ticketId: ticket.id,
          csat: value,
          comment: normalizedComment,
        },
        update: {
          csat: value,
          comment: normalizedComment,
        },
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      await logActivity(
        ticket.id,
        "USER",
        "Feedback captured",
        normalizedComment ? `CSAT ${value}/5. Comment: ${normalizedComment}` : `CSAT ${value}/5 via email action link.`,
      );
      await logActivity(ticket.id, "USER", "Status → CLOSED", "Ticket closed after verified star rating.");
      title = "Thank you for your rating";
      message = `Your ${value}-star review was recorded and the ticket is now fully resolved.`;
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-12 text-zinc-900 dark:text-zinc-100">
      <article className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#0b1220] p-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Ticket: {ticket.ticketNumber}</p>
        <div className="mt-5">
          <Link href="/signin" className="text-sm font-semibold text-orange-300 hover:underline">
            Open portal
          </Link>
        </div>
      </article>
    </main>
  );
}
