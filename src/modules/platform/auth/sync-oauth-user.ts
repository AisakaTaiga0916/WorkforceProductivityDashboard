import type { OAuthProfileInput } from "@/modules/platform/auth/sync-oauth-user.types";
import {
  canonicalProfileFromOAuth,
  syncPortalProfile,
} from "@/modules/platform/auth/sync-portal-profile";
import { findPortalByEmailOnly } from "@/lib/portal-account";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { normalizePortalRole } from "@/lib/staff-role";

export type { OAuthProfileInput };

/**
 * On OAuth sign-in: create or refresh the main-DB portal account for the email.
 * Accounts are matched by email; no separate OAuth identity store is used.
 */
export async function syncOAuthUser(input: OAuthProfileInput) {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error("OAuth profile missing email");

  const existingPortal = await findPortalByEmailOnly(email);
  const roleHint = normalizePortalRole(input.roleHint ?? existingPortal?.role ?? "Customer");

  const profile = canonicalProfileFromOAuth({
    email,
    name: input.name,
    image: input.image,
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    roleHint,
  });

  const result = await syncPortalProfile(profile, "oauth");

  const portal = await prismaPrimary.portalAccount.findUniqueOrThrow({
    where: { id: result.portalAccountId },
    select: { id: true, email: true, name: true, role: true },
  });

  return { portal };
}
