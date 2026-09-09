import { prismaPrimary } from "../../src/lib/prisma";

async function main() {
  const missing = [
    "1637",
    "1640",
    "1669",
    "1799",
    "1744",
    "1745",
    "1743",
    "1642",
    "1827",
    "1667",
    "1751",
    "1716",
    "1714",
    "1837",
    "1796",
    "9000000105",
  ];
  const nodes = await prismaPrimary.orgChartNode.findMany({
    where: {
      OR: [
        { mergedSourceUserId: { in: missing } },
        { personName: { contains: "Arbole", mode: "insensitive" } },
        { personName: { contains: "Bisnar", mode: "insensitive" } },
        { personName: { contains: "Gador", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      personName: true,
      mergedSourceUserId: true,
      sectionId: true,
      sectionMemberships: { select: { sectionId: true } },
    },
  });
  const admins = await prismaPrimary.portalAccount.findMany({
    where: {
      role: "Admin",
      accountStatus: { notIn: ["LEGACY_CONFLICT", "LEGACY_MERGED"] },
    },
    select: {
      name: true,
      email: true,
      mergedSourceUserId: true,
      headPrivileges: true,
    },
    take: 25,
  });
  const totalNodes = await prismaPrimary.orgChartNode.count();
  const withSection = await prismaPrimary.orgChartNode.count({
    where: { sectionId: { not: null } },
  });
  const membershipCount = await prismaPrimary.orgChartNodeSectionMembership.count();
  console.log(
    JSON.stringify(
      {
        totals: { totalNodes, withSection, membershipCount },
        nodesForMissingIds: nodes.map((n) => ({
          ...n,
          mergedSourceUserId: n.mergedSourceUserId?.toString?.() ?? n.mergedSourceUserId,
        })),
        admins: admins.map((a) => ({
          ...a,
          mergedSourceUserId: a.mergedSourceUserId?.toString?.() ?? a.mergedSourceUserId,
        })),
      },
      null,
      2,
    ),
  );
}

main().finally(() => prismaPrimary.$disconnect());
