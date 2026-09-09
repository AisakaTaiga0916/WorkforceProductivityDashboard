const fs = require("fs");
const path = require("path");

// Minimal .env loader (no dotenv dependency)
const envPath = path.join(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const key = m[1].trim();
  let val = m[2].trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const { PrismaClient } = require("@prisma/client/primary");
const prisma = new PrismaClient();

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: {
      OR: [{ ticketNumber: "REQ-2026-00048" }, { ticketNumber: "REQ-2026-0048" }],
    },
    select: {
      id: true,
      ticketNumber: true,
      requestType: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
    },
  });
  console.log("ticket", JSON.stringify(ticket, null, 2));

  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: "Tanutan", mode: "insensitive" } },
        { name: { contains: "Wyneth", mode: "insensitive" } },
        { name: { contains: "Queenie", mode: "insensitive" } },
        { name: { contains: "Palabrica", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  console.log("agents", JSON.stringify(agents, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
