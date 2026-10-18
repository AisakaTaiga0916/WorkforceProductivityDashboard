import bcrypt from "bcryptjs";

/** True when the portal row has no local password (OAuth-only sign-in). */
export function isOAuthOnlyPortal(passwordHash: string | null | undefined): boolean {
  return passwordHash == null || passwordHash === "";
}

export type PortalPasswordCheck =
  | { ok: true; oauthOnly: true }
  | { ok: true; oauthOnly: false }
  | { ok: false; reason: "INVALID" | "PASSWORD_REQUIRED" };

/** OAuth-only accounts skip password verification (session is sufficient). */
export async function verifyPortalPassword(
  passwordHash: string | null | undefined,
  password: string,
): Promise<PortalPasswordCheck> {
  if (isOAuthOnlyPortal(passwordHash)) {
    return { ok: true, oauthOnly: true };
  }
  if (!password) {
    return { ok: false, reason: "PASSWORD_REQUIRED" };
  }
  let match = false;
  try {
    match = await bcrypt.compare(password, normalizeBcryptPrefix(passwordHash!));
  } catch {
    match = false;
  }
  return match ? { ok: true, oauthOnly: false } : { ok: false, reason: "INVALID" };
}

/** HRIS (Laravel) hashes use `$2y$`; bcryptjs expects `$2a$`/`$2b$`. Same algorithm. */
export function normalizeBcryptPrefix(hash: string): string {
  if (hash.startsWith("$2y$")) return `$2a$${hash.slice(4)}`;
  return hash;
}
