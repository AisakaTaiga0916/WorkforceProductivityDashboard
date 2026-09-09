import { prisma } from "@/lib/prisma";

async function main() {
  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: "Riezel", mode: "insensitive" } },
        { name: { contains: "Lelis", mode: "insensitive" } },
        { name: { contains: "Lynneth", mode: "insensitive" } },
        { name: { contains: "Mangolayon", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: 20,
  });
  console.log(JSON.stringify(agents, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
