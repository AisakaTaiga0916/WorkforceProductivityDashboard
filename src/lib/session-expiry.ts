/** Shared session expiry + route guards (safe for middleware and client). */

const PUBLIC_AUTH_PATHS = new Set([
  "/signin",
  "/signup",
  "/customer/signin",
  "/customer/signup",
]);

function isAuthPagePath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.has(pathname);
}

/** Same-site relative post-login destination; never returns an auth page URL. */
export function sanitizeCallbackUrl(raw: string | null | undefined): string {
  if (!raw?.trim()) return "/";

  let candidate = raw.trim();

  try {
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      const url = new URL(candidate);
      candidate = `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return "/";
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";

  for (let depth = 0; depth < 10; depth++) {
    const queryIndex = candidate.indexOf("?");
    const pathOnly = queryIndex >= 0 ? candidate.slice(0, queryIndex) : candidate;

    if (!isAuthPagePath(pathOnly)) {
      return candidate;
    }

    if (pathOnly === "/signin" || pathOnly === "/customer/signin") {
      const params = new URLSearchParams(queryIndex >= 0 ? candidate.slice(queryIndex + 1) : "");
      const inner = params.get("callbackUrl");
      if (inner) {
        candidate = inner;
        continue;
      }
    }

    return "/";
  }

  return "/";
}

export function isAuthRequiredPath(pathname: string): boolean {
  if (PUBLIC_AUTH_PATHS.has(pathname)) return false;
  if (pathname.startsWith("/agent")) return true;
  if (pathname.startsWith("/admin")) return true;
  if (pathname.startsWith("/reports")) return true;
  if (pathname.startsWith("/my-requests")) return true;
  if (pathname.startsWith("/my-tickets")) return true;
  if (pathname.startsWith("/tickets/")) return true;
  if (pathname === "/tickets/new") return true;
  if (pathname.startsWith("/customer/")) return true;
  return false;
}

type ExpiryTokenLike = {
  error?: string;
  sessionExpiresAt?: number;
  exp?: number;
} | null;

export function isJwtSessionExpired(token: ExpiryTokenLike): boolean {
  if (!token) return true;
  if (token.error === "SessionExpired") return true;
  const now = Math.floor(Date.now() / 1000);
  if (typeof token.sessionExpiresAt === "number" && now >= token.sessionExpiresAt) return true;
  if (typeof token.exp === "number" && now >= token.exp) return true;
  return false;
}

export function signInUrlWithCallback(pathname: string, search = "", hash = "", base = ""): string {
  const callback = encodeURIComponent(sanitizeCallbackUrl(`${pathname}${search}${hash}`));
  const origin = base || "";
  if (callback === "%2F") return `${origin}/signin`;
  return `${origin}/signin?callbackUrl=${callback}`;
}
