import Link from "next/link";
import { SYSTEM_MODULE_LABELS, type SystemModuleId } from "@/modules/platform/settings/system-modules";

/** Shown in place of a module page that System Settings has turned off. */
export function ModuleDisabledNotice({ module }: { module: SystemModuleId }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
        Module off
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {SYSTEM_MODULE_LABELS[module]} is turned off
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        A Super Admin has disabled this module for everyone. It can be turned back on in
        SuperAdmin Settings → System Settings.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        Back to Dashboard
      </Link>
    </main>
  );
}
