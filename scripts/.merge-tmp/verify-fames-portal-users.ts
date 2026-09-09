import { prisma } from "@/lib/prisma";

async function main() {
  const emails = [
    "solisjeslie9@gmail.com",
    "ronaldzaspa@gmail.com",
    "gabrielbetulanjr@gmail.com",
    "dlagang@mconpincohomeimprovement.com",
    "lmangolayon@mconpincohomeimprovement.com",
    "https.kimoy@gmail.com",
    "ricadevalque@gmail.com",
    "dpontillo7@gmail.com",
  ];
  const portals = await prisma.portalAccount.findMany({
    where: { email: { in: emails, mode: "insensitive" } },
    select: {
      email: true,
      name: true,
      staffDesignatedCompanyId: true,
      staffDesignatedCompany: { select: { name: true } },
    },
  });
  console.log(JSON.stringify({ portals }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
