import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { verifyEmailVerificationToken } from "@/lib/email-verification-token";
import { isAwaitingCustomerConfirmation } from "@/modules/requests/customer-pending-resolution";
import { prisma } from "@/modules/platform/db/prisma";
import { logActivity } from "@/modules/requests/ticket-actions";
import {
  normalizeFeedbackComment,
  validateFeedbackForRating,
} from "@/modules/requests/ticket-feedback-policy";

const RATING_ALLOWED_STATUSES = ["FOR_CONFIRMATION", "RESOLVED", "CLOSED"] as const;

function verifiedFromActivities(activities: Array<{ summary: string }>) {
  let verified = false;
  for (const a of activities) {
    if (a.summary === "Resolution verification approved") verified = true;
    if (a.summary === "Resolution verification rejected") verified = false;
  }
  return verified;
}

function htmlMessage(title: string, message: string, tone: "ok" | "warn" | "error" = "ok") {
  const toneColor = tone === "ok" ? "#16a34a" : tone === "warn" ? "#f59e0b" : "#dc2626";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return new Response(
    `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${safeTitle}</title></head>
<body style="margin:0;background:#090909;color:#f5f5f5;font-family:Arial,sans-serif;">
  <main style="max-width:640px;margin:40px auto;padding:0 16px;">
    <section style="border:1px solid #27272a;background:#101010;border-radius:14px;padding:20px;">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a1a1aa;margin:0 0 10px;">Ticket verification</p>
      <h1 style="margin:0 0 10px;font-size:24px;">${safeTitle}</h1>
      <p style="margin:0 0 14px;color:#d4d4d8;">${safeMessage}</p>
      <span style="display:inline-block;background:${toneColor};color:#fff;font-size:12px;font-weight:700;padding:6px 10px;border-radius:999px;">Email action captured</span>
    </section>
  </main>
</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlRatingForm(ticketNumber: string, token: string, message?: string) {
  const safeTicketNumber = escapeHtml(ticketNumber);
  const safeToken = encodeURIComponent(token);
  const safeMessage = message ? `<p style="margin:0 0 14px;color:#fdba74;">${escapeHtml(message)}</p>` : "";
  return new Response(
    `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Submit feedback</title></head>
<body style="margin:0;background:#090909;color:#f5f5f5;font-family:Arial,sans-serif;">
  <main style="max-width:640px;margin:40px auto;padding:0 16px;">
    <section style="border:1px solid #27272a;background:#101010;border-radius:14px;padding:20px;">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a1a1aa;margin:0 0 10px;">Requestor feedback</p>
      <h1 style="margin:0 0 10px;font-size:24px;">Ticket ${safeTicketNumber}</h1>
      ${safeMessage}
      <p style="margin:0 0 12px;color:#d4d4d8;">Choose your star rating. Feedback is required for ratings of 3 stars or below.</p>
      <form method="get" action="/api/tickets/email-verification" style="display:grid;gap:12px;">
        <input type="hidden" name="token" value="${safeToken}" />
        <input type="hidden" name="action" value="rate" />
        <label style="display:grid;gap:6px;">
          <span style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#a1a1aa;">Star rating</span>
          <select id="stars" name="stars" required style="background:#0a0a0a;border:1px solid #3f3f46;color:#f5f5f5;border-radius:10px;padding:10px 12px;">
            <option value="">Select rating</option>
            <option value="5">5 - Excellent</option>
            <option value="4">4 - Good</option>
            <option value="3">3 - Fair</option>
            <option value="2">2 - Poor</option>
            <option value="1">1 - Very poor</option>
          </select>
        </label>
        <label style="display:grid;gap:6px;">
          <span style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#a1a1aa;">Feedback <span id="feedback-required-label" style="color:#fdba74;"></span></span>
          <textarea id="comment" name="comment" rows="5" placeholder="Tell us what went well or what we can improve..."
            style="background:#0a0a0a;border:1px solid #3f3f46;color:#f5f5f5;border-radius:10px;padding:10px 12px;resize:vertical;"></textarea>
        </label>
        <button type="submit" style="background:#ff5c00;color:#fff;border:0;border-radius:999px;padding:11px 14px;font-weight:700;cursor:pointer;">Submit review</button>
      </form>
    </section>
  </main>
  <script>
    const stars = document.getElementById("stars");
    const comment = document.getElementById("comment");
    const requiredLabel = document.getElementById("feedback-required-label");
    function updateFeedbackRequirement() {
      const required = Number(stars.value) <= 3 && Number(stars.value) >= 1;
      comment.required = required;
      requiredLabel.textContent = required ? "(required)" : "(optional)";
      comment.placeholder = required
        ? "Please share what went wrong or what we should improve."
        : "Tell us what went well or what we can improve...";
    }
    stars.addEventListener("change", updateFeedbackRequirement);
    updateFeedbackRequirement();
  </script>
</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function htmlRedirectToPortal(token: string, action: "reject") {
  const safeToken = encodeURIComponent(token);
  return new Response(
    `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="refresh" content="0;url=/customer/verification/email?token=${safeToken}&action=${action}"/>
<title>Redirecting…</title></head>
<body style="margin:0;background:#090909;color:#f5f5f5;font-family:Arial,sans-serif;">
  <main style="max-width:640px;margin:40px auto;padding:0 16px;">
    <section style="border:1px solid #27272a;background:#101010;border-radius:14px;padding:20px;">
      <h1 style="margin:0 0 10px;font-size:22px;">Redirecting to secure form…</h1>
      <p style="margin:0;color:#d4d4d8;">Please continue here: <a href="/customer/verification/email?token=${safeToken}&action=${action}" style="color:#fdba74;">open verification form</a></p>
    </section>
  </main>
</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = (searchParams.get("token") || "").trim();
  const action = (searchParams.get("action") || "").trim();
  const stars = Number(searchParams.get("stars") || "");
  const comment = (searchParams.get("comment") || "").trim();
  if (!token || !action) return htmlMessage("Invalid request", "Missing token or action.", "error");
  const payload = verifyEmailVerificationToken(token);
  if (!payload) return htmlMessage("Link expired", "Invalid or expired verification link.", "error");

  const ticket = await prisma.ticket.findUnique({
    where: { id: payload.ticketId },
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
  if (!ticket) return htmlMessage("Ticket not found", "No matching ticket was found.", "error");
  const targetEmail = (ticket.requestorEmail ?? ticket.contactEmail).toLowerCase();
  if (targetEmail !== payload.recipientEmail.toLowerCase()) {
    return htmlMessage("Invalid recipient", "This action link does not match the requestor email.", "error");
  }

  if (action === "verify") {
    if (!isAwaitingCustomerConfirmation(ticket.status)) {
      return htmlMessage("No action needed", "This ticket is no longer awaiting verification.", "warn");
    }
    await logActivity(
      ticket.id,
      "USER",
      "Resolution verification approved",
      "Requestor confirmed resolution via email action link.",
    );
    return htmlRatingForm(ticket.ticketNumber, token, "Verification confirmed. Please submit your star rating and feedback.");
  }

  if (action === "reject") {
    return htmlRedirectToPortal(token, "reject");
  }

  if (action === "rate") {
    if (!searchParams.get("stars")) {
      if (!RATING_ALLOWED_STATUSES.includes(ticket.status as (typeof RATING_ALLOWED_STATUSES)[number])) {
        return htmlMessage("Rating unavailable", "Ticket is not ready for star review.", "warn");
      }
      if (!verifiedFromActivities(ticket.activities)) {
        return htmlMessage("Verification required", "Please click Verify first before submitting feedback.", "warn");
      }
      return htmlRatingForm(ticket.ticketNumber, token);
    }
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      return htmlMessage("Invalid rating", "Please use a valid star review link from the email.", "error");
    }
    if (!RATING_ALLOWED_STATUSES.includes(ticket.status as (typeof RATING_ALLOWED_STATUSES)[number])) {
      return htmlMessage("Rating unavailable", "Ticket is not ready for star review.", "warn");
    }
    if (!verifiedFromActivities(ticket.activities)) {
      return htmlMessage("Verification required", "Please click Verify first before selecting a star review.", "warn");
    }
    const normalizedComment = normalizeFeedbackComment(comment);
    const feedbackError = validateFeedbackForRating(stars, normalizedComment);
    if (feedbackError) {
      return htmlRatingForm(ticket.ticketNumber, token, feedbackError);
    }
    await prisma.ticketFeedback.upsert({
      where: { ticketId: ticket.id },
      create: { ticketId: ticket.id, csat: stars, comment: normalizedComment },
      update: { csat: stars, comment: normalizedComment },
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    await logActivity(
      ticket.id,
      "USER",
      "Feedback captured",
      normalizedComment ? `CSAT ${stars}/5. Comment: ${normalizedComment}` : `CSAT ${stars}/5 via email action link.`,
    );
    await logActivity(ticket.id, "USER", "Status → CLOSED", "Ticket closed after verified star rating.");
    return htmlMessage("Thanks for your review", `Your ${stars}-star review was recorded. Ticket is now fully resolved.`, "ok");
  }

  return htmlMessage("Invalid action", "Unsupported email action.", "error");
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "Customer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as {
      token?: string;
      action?: "verify" | "reject" | "rate";
      reason?: string;
      stars?: number;
      comment?: string;
    };
    const token = (body.token || "").trim();
    const action = body.action;
    if (!token || !action) {
      return NextResponse.json({ error: "token and action are required." }, { status: 400 });
    }
    const payload = verifyEmailVerificationToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired verification link." }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: payload.ticketId },
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
    if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    const targetEmail = (ticket.requestorEmail ?? ticket.contactEmail).toLowerCase();
    if (targetEmail !== payload.recipientEmail.toLowerCase()) {
      return NextResponse.json({ error: "Verification email does not match this ticket." }, { status: 403 });
    }
    const sessionEmail = (session.user.email ?? "").toLowerCase();
    if (sessionEmail !== targetEmail && sessionEmail !== ticket.contactEmail.toLowerCase()) {
      return NextResponse.json({ error: "Ticket does not belong to this account." }, { status: 403 });
    }

    if (action === "verify") {
      if (!isAwaitingCustomerConfirmation(ticket.status)) {
        return NextResponse.json({ error: "Ticket is no longer awaiting verification." }, { status: 400 });
      }
      await logActivity(
        ticket.id,
        "USER",
        "Resolution verification approved",
        "Requestor confirmed resolution via email verification.",
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
      if (!isAwaitingCustomerConfirmation(ticket.status)) {
        return NextResponse.json({ error: "Ticket is no longer awaiting verification." }, { status: 400 });
      }
      const reason = (body.reason || "").trim();
      if (!reason) {
        return NextResponse.json({ error: "Reason is required." }, { status: 400 });
      }
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: "OPEN",
          resolvedAt: null,
          reopenCount: ticket.reopenCount + 1,
        },
      });
      await logActivity(ticket.id, "USER", "Resolution verification rejected", reason);
      return NextResponse.json({ ok: true });
    }

    if (action === "rate") {
      if (!RATING_ALLOWED_STATUSES.includes(ticket.status as (typeof RATING_ALLOWED_STATUSES)[number])) {
        return NextResponse.json({ error: "Ticket is not ready for rating." }, { status: 400 });
      }
      if (!verifiedFromActivities(ticket.activities)) {
        return NextResponse.json(
          { error: "Verification is required before star rating." },
          { status: 400 },
        );
      }
      const stars = Number(body.stars);
      if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
        return NextResponse.json({ error: "stars must be 1-5." }, { status: 400 });
      }
      const comment = normalizeFeedbackComment(body.comment);
      const feedbackError = validateFeedbackForRating(stars, comment);
      if (feedbackError) {
        return NextResponse.json({ error: feedbackError }, { status: 400 });
      }
      await prisma.ticketFeedback.upsert({
        where: { ticketId: ticket.id },
        create: {
          ticketId: ticket.id,
          csat: stars,
          comment,
        },
        update: {
          csat: stars,
          comment,
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
        comment ? `CSAT ${stars}/5. Comment: ${comment}` : "CSAT via email verification flow.",
      );
      await logActivity(ticket.id, "USER", "Status → CLOSED", "Ticket closed after verified star rating.");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Verification update failed." }, { status: 500 });
  }
}
