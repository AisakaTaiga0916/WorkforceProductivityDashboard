"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { normalizeFeedbackComment, requiresFeedbackForRating } from "@/modules/requests/ticket-feedback-policy";

export function TicketRatingForm({
  ticketId,
  initialStars,
}: {
  ticketId: string;
  initialStars: number;
}) {
  const router = useRouter();
  const [stars, setStars] = useState(initialStars);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const feedbackRequired = requiresFeedbackForRating(stars);

  async function submit() {
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      setError("Star rating is required.");
      return;
    }
    const normalizedComment = normalizeFeedbackComment(comment);
    if (feedbackRequired && !normalizedComment) {
      setError("Please tell us what went wrong so the team can improve.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "feedback",
        csat: stars,
        comment: normalizedComment,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not submit rating.");
      return;
    }
    setDone(true);
    router.refresh();
  }

  return (
    <article className="rounded-md border border-zinc-200 bg-white p-5 shadow-[0_14px_28px_rgba(0,0,0,0.06)] dark:border-zinc-700/80 dark:bg-[#10100f] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)]">
      <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-100">Mandatory ticket rating</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Please rate your resolved ticket. This is required to complete closure.
      </p>

      <div className="mt-4 flex gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setStars(value)}
            className={`rounded-md px-3 py-2 text-lg ${
              value <= stars ? "bg-amber-500/20 text-amber-700 dark:text-amber-200" : "bg-zinc-100 text-zinc-500 dark:bg-[#181716]"
            }`}
          >
            ★
          </button>
        ))}
      </div>

      <label className="mt-4 block text-sm text-zinc-600 dark:text-zinc-300">
        {feedbackRequired ? "Feedback (required for 3 stars or below)" : "Optional comment"}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          required={feedbackRequired}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-[#181716] dark:text-zinc-100"
          placeholder={
            feedbackRequired
              ? "Please share what went wrong or what we should improve."
              : "Tell us what went well or what we can improve."
          }
        />
      </label>
      {feedbackRequired ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Feedback is required when rating 3 stars or below.
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy || done}
        onClick={submit}
        className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
      >
        {done ? "Rating submitted" : "Submit rating"}
      </button>

      {error ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {done ? <p className="mt-2 text-sm text-orange-300">Thanks. Your ticket has been closed.</p> : null}
    </article>
  );
}
