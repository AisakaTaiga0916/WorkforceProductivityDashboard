import { prisma } from "../../src/lib/prisma";

async function main() {
  const users = await prisma.portalAccount.findMany({
    where: {
      email: {
        in: [
          "lmangolayon@mconpincohomeimprovement.com",
          "edmunmagbanua@gmail.com",
          "mira26luna@gmail.com",
        ],
      },
    },
    select: { email: true, name: true, role: true, accountStatus: true },
  });
  console.table(users);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
