/** Shared presentation helpers for assignment-style boards. */

export function formatRelativeAgo(iso: string | Date) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function priorityPillClass(priority: string) {
  if (priority === "URGENT") return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200";
  if (priority === "HIGH") return "bg-orange-100 text-orange-800 dark:bg-orange-600/20 dark:text-orange-200";
  if (priority === "MEDIUM") return "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200";
  if (priority === "UNSET")
    return "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200";
  return "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200";
}

export function extractDepartmentFromDescription(raw: string) {
  const newLabel = raw.match(/Request to Company\/SBU:\s*(.+)$/i);
  if (newLabel?.[1]) return newLabel[1].trim();
  const legacy = raw.match(/Department\/Business Unit:\s*(.+)$/i);
  return legacy?.[1]?.trim() ?? null;
}

export function cleanIssuePreview(raw: string) {
  return raw
    .replace(/\s*Request to Company\/SBU:\s*.+$/i, "")
    .replace(/\s*Department\/Business Unit:\s*.+$/i, "")
    .trim();
}
