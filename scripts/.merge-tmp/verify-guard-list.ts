import { findTravelOrdersVisibleToAgent } from "../../src/lib/travel-order-db";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const agentId = "cmsif3zz700011h0ykiu42kzx";
  const rows = await findTravelOrdersVisibleToAgent({
    companyTeamId: null,
    agentId,
    gatePassOnly: true,
  });
  console.log(
    JSON.stringify(
      {
        count: rows.length,
        orders: rows.map((o) => ({
          title: o.orderRequest,
          status: o.status,
          gpi: o.gatePassIncluded,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
