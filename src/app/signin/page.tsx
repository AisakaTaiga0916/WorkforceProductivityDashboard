"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";
import { GoogleMark } from "@/components/auth/GoogleAuthButton";
import {
  SignInLaunchPadShell,
  launchPadInputClass,
  launchPadLabelClass,
  launchPadOutlineButtonClass,
  launchPadPrimaryButtonClass,
} from "@/components/auth/SignInLaunchPadShell";
import { isSessionExpired, logoutExpiredSession } from "@/lib/session-expiry-client";
import { sanitizeCallbackUrl } from "@/lib/session-expiry";
import { RedirectLoadingIndicator } from "@/components/ui/redirect-loading-indicator";

function postLoginDestination(resUrl: string | null | undefined, fallback: string): string {
  if (resUrl) {
    try {
      const parsed = new URL(resUrl, window.location.origin);
      if (parsed.origin === window.location.origin) {
        return sanitizeCallbackUrl(`${parsed.pathname}${parsed.search}${parsed.hash}`);
      }
    } catch {
      /* ignore */
    }
  }
  return sanitizeCallbackUrl(fallback);
}

function LaunchPadDivider() {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-zinc-300 dark:bg-white/10" />
      <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
        or
      </span>
      <span className="h-px flex-1 bg-zinc-300 dark:bg-white/10" />
    </div>
  );
}

function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "use_password":
      return "Staff accounts must sign in with username and password. Google sign-in is for customers only.";
    case "OAuthSignin":
    case "OAuthCallback":
      return "Google sign-in could not complete. Check that NEXTAUTH_URL matches the site URL and the Google OAuth redirect URI is configured.";
    case "OAuthAccountNotLinked":
      return "This Google account is not linked to your portal login. Use the same email as your customer account, or sign in with username and password.";
    case "AccessDenied":
      return "Sign-in was denied. If the Google app is in Testing mode, add this user as a test user in Google Cloud Console.";
    case "Configuration":
      return "Sign-in is misconfigured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET or NEXTAUTH_URL). Contact your administrator.";
    default:
      return "Sign-in failed. Try again or use username and password.";
  }
}

function SignInForm() {
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const registered = searchParams.get("registered") === "1";
  const sessionExpiredReason = searchParams.get("reason");
  const sessionExpiredMidnight = sessionExpiredReason === "session-expired-midnight";
  const sessionExpiredIdle = sessionExpiredReason === "session-expired";
  const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl"));
  const oauthError = oauthErrorMessage(searchParams.get("error"));
  const wantsGoogle = searchParams.get("google") === "1";
  const googleRedirectStarted = useRef(false);
  const banner = registered
    ? "Account created. Sign in with your username and password."
    : sessionExpiredMidnight
      ? "Your session ended at midnight. Please sign in again."
      : sessionExpiredIdle
        ? "Your session ended after 30 minutes. Please sign in again."
        : oauthError;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [formReady, setFormReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    setFormReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProviders() {
      const res = await fetch("/api/auth/providers", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const providers = (await res.json()) as Record<string, unknown>;
      if (!cancelled) setGoogleEnabled(!!providers.google);
    }
    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session) return;
    if (isSessionExpired(session)) {
      logoutExpiredSession(
        sessionExpiredReason === "session-expired-midnight" ? "midnight" : "idle",
      );
      return;
    }
    setRedirecting(true);
    window.location.replace(callbackUrl);
  }, [status, session, callbackUrl, sessionExpiredReason]);

  useEffect(() => {
    if (!googleEnabled || !wantsGoogle || googleRedirectStarted.current) return;
    googleRedirectStarted.current = true;
    void signIn("google", { callbackUrl });
  }, [googleEnabled, wantsGoogle, callbackUrl]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!formReady || submitting || redirecting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await signIn("credentials", {
        username: username.trim(),
        password,
        callbackUrl,
        redirect: false,
      });
      if (res?.error) {
        setError("Invalid username or password.");
        setSubmitting(false);
        return;
      }
      setRedirecting(true);
      window.location.href = postLoginDestination(res?.url, callbackUrl);
    } catch {
      setError("Sign-in failed. Please try again.");
      setSubmitting(false);
    }
  }

  function openResetPanel() {
    setResetOpen(true);
    setResetMessage(null);
    setResetError(null);
    if (!resetIdentifier && username) setResetIdentifier(username);
  }

  async function submitResetRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResetError(null);
    setResetMessage(null);
    const identifier = resetIdentifier.trim();
    if (!identifier) {
      setResetError("Enter your username or email.");
      return;
    }
    setResetBusy(true);
    try {
      const res = await fetch("/api/auth/password-reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, reason: resetReason.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setResetError(data.error ?? "Could not submit request. Try again.");
        return;
      }
      setResetMessage(
        data.message ??
          "Request sent. A SuperAdmin will review it and notify you when the password is reset.",
      );
      setResetReason("");
    } catch {
      setResetError("Network error. Try again.");
    } finally {
      setResetBusy(false);
    }
  }

  if (redirecting) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-50 px-4 text-zinc-900 dark:bg-[#050505] dark:text-[#e0e0e0]">
        <RedirectLoadingIndicator />
        <p className="text-sm font-medium">Redirecting…</p>
      </div>
    );
  }

  return (
    <SignInLaunchPadShell>
      <div className="mb-4 text-center">
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">Sign in</h2>
      </div>

      {banner ? (
        <p className="mb-4 rounded-xl border border-[#ff6b00]/30 bg-[#ff6b00]/10 px-3 py-2 text-xs leading-snug text-orange-900 dark:border-[#ff6b00]/25 dark:text-orange-100">
          {banner}
        </p>
      ) : null}

      <form method="post" action="/signin" onSubmit={onSubmit} className="space-y-3.5">
        <div>
          <label htmlFor="signin-username" className={launchPadLabelClass}>
            Username
          </label>
          <input
            id="signin-username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            placeholder="you or name@company.com"
            className={`${launchPadInputClass} mt-2`}
            disabled={submitting || redirecting}
          />
        </div>

        <div>
          <label htmlFor="signin-password" className={launchPadLabelClass}>
            Password
          </label>
          <div className="relative mt-2">
            <input
              id="signin-password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className={`${launchPadInputClass} pr-12`}
              disabled={submitting || redirecting}
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              title={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-400 transition hover:text-zinc-800 dark:hover:text-white"
            >
              {showPassword ? (
                <EyeOff className="size-5" aria-hidden />
              ) : (
                <Eye className="size-5" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col items-stretch gap-3 pt-1">
          <button
            type="submit"
            disabled={!formReady || submitting || redirecting}
            className={launchPadPrimaryButtonClass}
            data-no-particles="true"
          >
            {!formReady ? "Preparing…" : submitting ? "Signing in…" : "Sign in"}
          </button>
          <div className="relative z-10 flex items-center justify-between gap-3 text-xs leading-normal">
            <button
              type="button"
              onClick={openResetPanel}
              className="text-[#ff6b00] transition-colors hover:text-orange-400"
            >
              Forgot password?
            </button>
            <Link href="/signup" className="font-medium text-[#ff6b00] transition-colors hover:text-orange-400">
              Create account
            </Link>
          </div>
        </div>
      </form>

      {resetOpen ? (
        <section className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-white/10 dark:bg-black/40">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:text-gray-300">
              Request password reset
            </h3>
            <button
              type="button"
              onClick={() => setResetOpen(false)}
              className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
            >
              Close
            </button>
          </div>
          {resetMessage ? (
            <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[12px] text-emerald-800 dark:text-emerald-100">
              {resetMessage}
            </p>
          ) : null}
          {resetError ? (
            <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[12px] text-red-700 dark:text-red-200">
              {resetError}
            </p>
          ) : null}
          <form onSubmit={submitResetRequest} className="mt-3 space-y-3">
            <label className="flex flex-col gap-1.5">
              <span className={launchPadLabelClass}>Username or email</span>
              <input
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                required
                autoComplete="username"
                placeholder="you or name@company.com"
                className={launchPadInputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={launchPadLabelClass}>Reason (optional)</span>
              <textarea
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                rows={2}
                placeholder="Brief context to help the SuperAdmin verify the request."
                className={`${launchPadInputClass} resize-none`}
              />
            </label>
            <button
              type="submit"
              disabled={resetBusy}
              className={launchPadPrimaryButtonClass}
            >
              {resetBusy ? "Sending request…" : "Send request to SuperAdmin"}
            </button>
          </form>
        </section>
      ) : null}

      {googleEnabled ? (
        <>
          <LaunchPadDivider />
          <button
            type="button"
            aria-label="Continue with Google"
            className={launchPadOutlineButtonClass}
            onClick={() => void signIn("google", { callbackUrl })}
            data-no-particles="true"
          >
            <span className="inline-flex items-center justify-center gap-2">
              <GoogleMark />
              Continue with Google
            </span>
          </button>
        </>
      ) : null}
    </SignInLaunchPadShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <SignInLaunchPadShell>
          <p className="text-center text-sm text-zinc-500 dark:text-gray-400">Loading…</p>
        </SignInLaunchPadShell>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
