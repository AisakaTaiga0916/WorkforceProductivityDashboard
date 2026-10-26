/** Remembers each report page's last query string for the browser session (client-only). */

function storageKey(path: string): string {
  return `wpd:report-query:${path}`;
}

export function rememberReportQuery(path: string, search: string): void {
  try {
    window.sessionStorage.setItem(storageKey(path), search.replace(/^\?/, ""));
  } catch {
    /* storage unavailable (private mode) — links just open the default view */
  }
}

/** `path` plus its remembered query, so tab / icon navigation keeps report filters. */
export function recallReportHref(path: string): string {
  try {
    const search = window.sessionStorage.getItem(storageKey(path));
    return search ? `${path}?${search}` : path;
  } catch {
    return path;
  }
}
