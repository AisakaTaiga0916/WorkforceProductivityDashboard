const fs = require("fs");
const path = require("path");

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

const TICKET_NUMBER = "REQ-2026-00048";
const NEW_FINANCE_AGENT_ID = "cmrpyre14001f12w5bs5uvrfh"; // Tanutan, Wyneth Maxine Deaño

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: TICKET_NUMBER },
    select: { id: true, ticketNumber: true, paymentApprovalMeta: true },
  });
  if (!ticket) throw new Error(`Ticket ${TICKET_NUMBER} not found`);

  const meta =
    ticket.paymentApprovalMeta && typeof ticket.paymentApprovalMeta === "object"
      ? { ...ticket.paymentApprovalMeta }
      : {};

  const previous = meta.financeAgentId;
  meta.financeAgentId = NEW_FINANCE_AGENT_ID;

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { paymentApprovalMeta: meta },
  });

  const agent = await prisma.agent.findUnique({
    where: { id: NEW_FINANCE_AGENT_ID },
    select: { id: true, name: true, email: true },
  });

  console.log(
    JSON.stringify(
      {
        ticketNumber: ticket.ticketNumber,
        previousFinanceAgentId: previous,
        newFinanceAgentId: NEW_FINANCE_AGENT_ID,
        newFinanceAgent: agent,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
