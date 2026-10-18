/**
 * Backfill Auth DB users from existing Primary PortalAccount rows,
 * then link merged_users where email/username matches.
 *
 * Usage: npm run db:migrate:portal-to-auth
 */
import {
  canonicalProfileFromMerged,
  canonicalProfileFromOAuth,
  syncPortalProfile,
} from "../src/modules/platform/auth/sync-portal-profile";
import { findMergedUserByEmail } from "../src/modules/platform/auth/merged-credentials";
import { prismaAuth, prismaPrimary } from "../src/modules/platform/db/prisma";
import { normalizePortalRole } from "../src/lib/staff-role";

async function main() {
  const portals = await prismaPrimary.portalAccount.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      profileImage: true,
      role: true,
      oauthProvider: true,
      oauthSubject: true,
      emailVerifiedAt: true,
      mergedSourceUserId: true,
    },
  });

  let synced = 0;
  let skipped = 0;

  for (const portal of portals) {
    const email = portal.email.trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }

    const merged = await findMergedUserByEmail(email);

    if (merged) {
      await syncPortalProfile(
        canonicalProfileFromMerged({
          sourceUserId: merged.sourceUserId,
          username: merged.username,
          name: merged.name,
          email: merged.email,
          role: merged.role,
          companyName: merged.companyName,
        }),
        "migration",
      );
    } else if (portal.oauthProvider && portal.oauthSubject) {
      await syncPortalProfile(
        canonicalProfileFromOAuth({
          email,
          name: portal.name,
          image: portal.profileImage,
          provider: portal.oauthProvider,
          providerAccountId: portal.oauthSubject,
          roleHint: portal.role,
        }),
        "migration",
      );
    } else {
      await syncPortalProfile(
        {
          email,
          name: portal.name,
          image: portal.profileImage ?? null,
          portalRole: normalizePortalRole(portal.role) ?? "Customer",
          headPrivileges: false,
          emailVerified: Boolean(portal.emailVerifiedAt),
        },
        "migration",
      );
    }
    synced++;
  }

  console.log(`[migrate-portal-to-auth] portals=${portals.length} synced=${synced} skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaAuth.$disconnect();
    await prismaPrimary.$disconnect();
  });
