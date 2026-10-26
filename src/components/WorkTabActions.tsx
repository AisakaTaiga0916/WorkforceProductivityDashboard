"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Right side of the Work tab bar; each tab portals its own actions here. */
export const WORK_TAB_ACTIONS_ID = "work-tab-actions";

export const WORK_ACTION_ICON_CLASS =
  "relative inline-flex size-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-800 transition hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-orange-500/40 dark:hover:bg-orange-500/10 dark:hover:text-orange-100";

/**
 * Renders the active tab's action icons in the Work tab bar. Outside the Work shell
 * (no slot on the page) the actions render inline instead.
 */
export function WorkTabActions({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<{ el: HTMLElement | null } | null>(null);

  useEffect(() => {
    queueMicrotask(() => setSlot({ el: document.getElementById(WORK_TAB_ACTIONS_ID) }));
  }, []);

  if (!slot) return null;
  if (slot.el) return createPortal(children, slot.el);
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
