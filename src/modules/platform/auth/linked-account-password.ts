import bcrypt from "bcryptjs";
import { isOAuthOnlyPortal, verifyPortalPassword } from "@/modules/platform/auth/portal-password";
import { prismaPrimary } from "@/modules/platform/db/prisma";

type PortalAuthRow = {
  id: string;
  email: string;
  passwordHash: string | null;
  mergedSourceUserId: bigint | null;
};

/** Verify the caller's password against `portal_accounts.password_hash` (main DB). */
export async function verifyLinkedAccountPassword(
  portal: PortalAuthRow,
  password: string,
): Promise<{ ok: true } | { ok: false; reason: "INVALID" | "PASSWORD_REQUIRED" | "OAUTH_ONLY" }> {
  const portalCheck = await verifyPortalPassword(portal.passwordHash, password);
  if (portalCheck.ok && portalCheck.oauthOnly) return { ok: false, reason: "OAUTH_ONLY" };
  if (!portalCheck.ok) {
    return { ok: false, reason: portalCheck.reason === "PASSWORD_REQUIRED" ? "PASSWORD_REQUIRED" : "INVALID" };
  }
  return { ok: true };
}

/** Persist a new password hash on the main DB. HRIS / merged credentials are never written. */
export async function setLinkedAccountPassword(
  portal: PortalAuthRow,
  plaintext: string,
): Promise<void> {
  const nextHash = await bcrypt.hash(plaintext, 12);
  await prismaPrimary.portalAccount.update({
    where: { id: portal.id },
    data: { passwordHash: nextHash },
  });
}

export { isOAuthOnlyPortal };
