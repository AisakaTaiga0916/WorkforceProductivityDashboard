/**
 * Fuzzy person-name matching for portal ↔ HRIS merge reconciliation.
 * Token Jaccard after normalizing accents / punctuation.
 */
import { normalizePersonName } from "@/lib/person-name";

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

export function personNameTokens(value: string): Set<string> {
  const normalized = stripDiacritics(normalizePersonName(value))
    .replace(/,/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stop = new Set(["jr", "sr", "ii", "iii", "iv"]);
  return new Set(
    normalized
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !stop.has(t)),
  );
}

/** 0..1 Jaccard similarity on name tokens. */
export function personNameSimilarity(a: string, b: string): number {
  const ta = personNameTokens(a);
  const tb = personNameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * True when names likely refer to the same person.
 * Requires high token overlap and at least 2 shared tokens (or exact normalized match).
 */
export function samePersonName(a: string, b: string, minSimilarity = 0.5): boolean {
  const na = stripDiacritics(normalizePersonName(a)).replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const nb = stripDiacritics(normalizePersonName(b)).replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = personNameTokens(a);
  const tb = personNameTokens(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (inter < 2) return false;
  return personNameSimilarity(a, b) >= minSimilarity;
}
