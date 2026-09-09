"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { FaqLaunchControl } from "@/components/faq/FaqLaunchControl";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { usePhilippineTimeSync } from "@/hooks/usePhilippineTimeSync";
import { formatPhilippineBarClock } from "@/lib/philippine-time";
import { cn } from "@/lib/cn";

export const launchPadLabelClass =
  "block text-[10px] font-bold uppercase tracking-[0.2em] text-[#ff6b00]";

export const launchPadInputClass =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition " +
  "focus:border-[#ff6b00] focus:shadow-[0_0_0_1px_#ff6b00] " +
  "dark:border-[#333] dark:bg-[rgba(10,10,10,0.6)] dark:text-white dark:placeholder:text-[#666]";

export const launchPadPrimaryButtonClass =
  "relative z-0 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#e66000] to-[#ff7a1a] py-3 text-sm font-semibold text-white transition " +
  "hover:from-[#ff7a1a] hover:to-[#e66000] hover:shadow-[0_4px_15px_rgba(255,107,0,0.3)] " +
  "disabled:pointer-events-none disabled:opacity-55";

export const launchPadOutlineButtonClass =
  "w-full rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-900 transition " +
  "hover:border-zinc-400 hover:bg-zinc-100 " +
  "dark:border-white/10 dark:bg-white/[0.02] dark:text-white dark:hover:border-white/20 dark:hover:bg-white/[0.05] " +
  "disabled:pointer-events-none disabled:opacity-55";

function LaunchPadClock({ className }: { className?: string }) {
  const epochMs = usePhilippineTimeSync();
  const parts = epochMs != null ? formatPhilippineBarClock(epochMs) : null;
  const time =
    parts != null ? `${parts.hours}:${parts.minutes}:${parts.seconds}` : "--:--:--";

  return (
    <div
      className={cn("relative w-full", className)}
      aria-live="polite"
      aria-label={parts?.ariaLabel ?? "Loading Philippine time"}
    >
      <div
        aria-hidden
        className="absolute inset-0 rounded-2xl bg-[#ff6b00]/15 blur-3xl dark:bg-[#ff6b00]/20"
      />
      <div
        className={cn(
          "relative flex w-full items-center justify-center gap-4",
          "rounded-2xl border border-zinc-200 bg-white/80 px-5 py-3.5 shadow-[0_8px_30px_rgba(255,107,0,0.12)] backdrop-blur-md sm:gap-5 sm:px-6 sm:py-4",
          "dark:animate-[launchpad-glow_3s_ease-in-out_infinite_alternate] dark:border-white/10 dark:bg-black/60 dark:shadow-none",
        )}
      >
        <div
          aria-hidden
          className="flex h-10 w-2 flex-col justify-between border-l border-[#ff6b00]/30 py-1"
        >
          <div className="h-px w-2 bg-[#ff6b00]/50" />
          <div className="h-px w-1 bg-[#ff6b00]/30" />
          <div className="h-px w-2 bg-[#ff6b00]/50" />
        </div>
        <div
          className={cn(
            "font-mono text-4xl font-bold tabular-nums tracking-[0.1em] text-[#ff6b00] sm:text-5xl",
            "[text-shadow:0_0_10px_rgba(255,107,0,0.35)] dark:[text-shadow:0_0_10px_rgba(255,107,0,0.5)]",
          )}
        >
          {time}
        </div>
        <div
          aria-hidden
          className="flex h-10 w-2 flex-col items-end justify-between border-r border-[#ff6b00]/30 py-1"
        >
          <div className="h-px w-2 bg-[#ff6b00]/50" />
          <div className="h-px w-1 bg-[#ff6b00]/30" />
          <div className="h-px w-2 bg-[#ff6b00]/50" />
        </div>
      </div>
    </div>
  );
}

export function SignInLaunchPadShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  /** Wider card for multi-field forms (e.g. signup). */
  wide?: boolean;
}) {
  const stackMax = wide ? "max-w-lg" : "max-w-md";

  return (
    <div className="relative flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 antialiased selection:bg-[#ff6b00] selection:text-white dark:bg-[#050505] dark:text-[#e0e0e0]">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_15%_50%,rgba(255,107,0,0.08),transparent_40%),radial-gradient(circle_at_85%_30%,rgba(255,107,0,0.04),transparent_40%)] dark:bg-[radial-gradient(circle_at_15%_50%,rgba(255,107,0,0.05),transparent_40%),radial-gradient(circle_at_85%_30%,rgba(255,107,0,0.03),transparent_40%)]"
      />

      <header className="relative z-20 flex w-full shrink-0 items-center justify-end border-b border-zinc-200/80 bg-white/90 px-5 py-2.5 backdrop-blur-sm dark:border-white/5 dark:bg-[#050505]/95">
        <nav className="flex items-center gap-3 text-sm font-medium sm:gap-6">
          <ThemeToggle />
          <Link
            href="/process"
            className="text-zinc-600 transition-colors hover:text-zinc-950 dark:text-gray-300 dark:hover:text-white"
          >
            Support
          </Link>
          <FaqLaunchControl className="cursor-pointer border-0 bg-transparent p-0 font-medium text-zinc-600 transition-colors hover:text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6b00] dark:text-gray-300 dark:hover:text-white" />
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-start px-6 pb-6 pt-3 sm:pt-4">
        <div className={cn("flex w-full flex-col items-center gap-3 sm:gap-3.5", stackMax)}>
          <div className="w-full animate-[launchpad-float_6s_ease-in-out_infinite]">
            <LaunchPadClock />
          </div>
          <Link
            href="/signin"
            className="inline-flex w-full items-center justify-center"
            title="Workforce Productivity Dashboard"
          >
            <BrandLogo
              width={300}
              className="h-auto w-[min(88vw,14rem)] sm:w-[min(88vw,16rem)] md:w-[min(88vw,18rem)]"
            />
          </Link>

          <div
            className={cn(
              "relative w-full rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.12)] backdrop-blur-[12px] sm:p-6",
              "dark:border-white/5 dark:bg-[rgba(26,26,26,0.4)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]",
            )}
          >
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-300 to-transparent dark:via-white/20"
            />
            {children}
          </div>
        </div>
      </main>

      <footer className="relative z-10 flex w-full shrink-0 flex-col items-center justify-between gap-4 border-t border-zinc-200/80 bg-white/90 px-6 py-4 text-xs text-zinc-500 backdrop-blur-sm dark:border-white/5 dark:bg-[#050505]/95 dark:text-gray-500 sm:flex-row sm:gap-0">
        <div>
          © {new Date().getFullYear()} AGC Technologies &amp; Business Solutions. All rights
          reserved.
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          <span className="cursor-default transition-colors hover:text-zinc-800 dark:hover:text-gray-300">
            Privacy Policy
          </span>
          <span className="cursor-default transition-colors hover:text-zinc-800 dark:hover:text-gray-300">
            Terms of Service
          </span>
          <span className="cursor-default transition-colors hover:text-zinc-800 dark:hover:text-gray-300">
            Security Architecture
          </span>
        </div>
      </footer>
    </div>
  );
}
