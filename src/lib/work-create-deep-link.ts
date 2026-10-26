"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { WORK_CREATE_PARAM } from "@/lib/work-deep-link-params";

/**
 * Runs `open` once when `?<param>=1` is present, then drops the param so a refresh or Back
 * does not reopen it. Waits until `enabled` (e.g. permissions or rows loaded).
 * `open` must be referentially stable.
 */
export function useOneShotQueryParam(param: string, enabled: boolean, open: () => void) {
  const searchParams = useSearchParams();
  const requested = searchParams.get(param) === "1";

  useEffect(() => {
    if (!requested || !enabled) return;
    queueMicrotask(open);
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [param, requested, enabled, open]);
}

export function useWorkCreateDeepLink(enabled: boolean, open: () => void) {
  useOneShotQueryParam(WORK_CREATE_PARAM, enabled, open);
}
