import type { UserRole } from "../src/modules/platform/auth";
import { loadPersonnelAccountsPayload } from "../src/lib/personnel-accounts-data";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const payload = await loadPersonnelAccountsPayload({
    role: "SuperAdmin" as UserRole,
    email: "super_admin@helpdesk.com",
  });

  const pgOnlyStaff = await prismaPrimary.portalAccount.count({
    where: {
      mergedSourceUserId: null,
      accountStatus: "ACTIVE",
      role: { in: ["Admin", "Personnel", "SuperAdmin"] },
    },
  });

  const byCompany = payload.personnel.reduce<Record<string, number>>((acc, row) => {
    acc[row.teamName] = (acc[row.teamName] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        personnelOnRoster: payload.personnel.length,
        pgOnlyStaffStillActive: pgOnlyStaff,
        sample: payload.personnel.slice(0, 8).map((p) => ({
          name: p.name,
          username: p.username,
          email: p.email,
          team: p.teamName,
          role: p.staffRole,
        })),
        byCompany,
      },
      null,
      2,
    ),
  );
}

main().finally(() => prismaPrimary.$disconnect());
