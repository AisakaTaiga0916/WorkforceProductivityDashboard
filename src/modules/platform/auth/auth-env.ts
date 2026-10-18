/**
 * NextAuth (v4, self-hosted) uses `process.env.NEXTAUTH_URL` for OAuth `redirect_uri`.
 * It must match an entry in Google Cloud Console → OAuth client → Authorized redirect URIs
 * (character-for-character: scheme, host, path; no trailing slash on the origin).
 *
 * Local dev: if `.env` points at production (e.g. https://helpdesk.example) but you open
 * http://localhost:3000, Google will redirect to production and the session cookie will not
 * match — sign-in appears broken. We rewrite to http://localhost:{PORT} in development
 * unless `NEXTAUTH_URL_DEV_STICKY=1` (use that for ngrok or when you intentionally test
 * a non-local URL in dev).
 */
function trimEnv(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v && v.length > 0 ? v : undefined;
}

function alignNextAuthUrlForDevEnvironment(url: string): string {
  if (process.env.NODE_ENV !== "development") return url;
  if (trimEnv(process.env.NEXTAUTH_URL_DEV_STICKY) === "1") return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return url;
  } catch {
    return url;
  }
  const port = trimEnv(process.env.PORT) ?? "3000";
  return `http://localhost:${port}`;
}

let applied = false;

export function ensureNextAuthUrlFromEnv(): void {
  if (applied) return;
  applied = true;

  let base = trimEnv(process.env.NEXTAUTH_URL) ?? trimEnv(process.env.APP_BASE_URL);
  if (!base) return;

  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }

  base = alignNextAuthUrlForDevEnvironment(base);
  process.env.NEXTAUTH_URL = base;
}

ensureNextAuthUrlFromEnv();
