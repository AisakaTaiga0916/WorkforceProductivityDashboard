/**
 * After primary travel_orders wipe: clear MySQL merged snapshots + upload dirs.
 * Usage: npx tsx scripts/.merge-tmp/wipe-travel-order-extras.ts
 */
import fs from "fs";
import path from "path";
import { prismaPrimary } from "../../src/lib/prisma";
import { withSecondaryWriteClient } from "../../src/lib/prisma-secondary-write";

async function main() {
  const left = await prismaPrimary.travelOrder.count();
  console.log(JSON.stringify({ primaryTravelOrdersLeft: left }));

  const merged = await withSecondaryWriteClient(async (db) => {
    try {
      const travelers = await db.mergedTravelOrderTraveler.deleteMany({});
      const locations = await db.mergedTravelOrderLocation.deleteMany({});
      const orders = await db.mergedTravelOrder.deleteMany({});
      return {
        deletedMergedTravelers: travelers.count,
        deletedMergedLocations: locations.count,
        deletedMergedOrders: orders.count,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  console.log(JSON.stringify(merged));

  let removedDirs = 0;
  const root = path.join(process.cwd(), "uploads", "kpi-maintenance");
  if (fs.existsSync(root)) {
    for (const kpi of fs.readdirSync(root, { withFileTypes: true })) {
      if (!kpi.isDirectory()) continue;
      const toDir = path.join(root, kpi.name, "travel-order");
      if (fs.existsSync(toDir)) {
        fs.rmSync(toDir, { recursive: true, force: true });
        removedDirs += 1;
      }
    }
  }
  const legacy = path.join(process.cwd(), "uploads", "travel-orders");
  if (fs.existsSync(legacy)) {
    fs.rmSync(legacy, { recursive: true, force: true });
    removedDirs += 1;
  }
  console.log(JSON.stringify({ removedTravelOrderUploadTrees: removedDirs }));
}

main()
  .then(() => prismaPrimary.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
