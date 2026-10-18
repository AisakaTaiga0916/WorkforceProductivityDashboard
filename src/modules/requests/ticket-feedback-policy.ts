export const REQUIRED_FEEDBACK_MAX_CSAT = 3;

export function requiresFeedbackForRating(csat: number): boolean {
  return Number.isFinite(csat) && csat >= 1 && csat <= REQUIRED_FEEDBACK_MAX_CSAT;
}

export function normalizeFeedbackComment(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

export function validateFeedbackForRating(csat: number, comment: unknown): string | null {
  if (!requiresFeedbackForRating(csat)) return null;
  return normalizeFeedbackComment(comment) ? null : "Feedback is required for ratings of 3 stars or below.";
}
