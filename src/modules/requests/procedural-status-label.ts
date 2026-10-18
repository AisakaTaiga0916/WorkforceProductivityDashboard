/** Format procedural status as "<STEP LABEL> IS MISSING" (keeps role "BY"). */
export function formatNeedsToBeProceduralLabel(stepLabel: string): string {
  const cleaned = stepLabel.replace(/\s+/g, " ").trim();
  return `${cleaned} IS MISSING`;
}
