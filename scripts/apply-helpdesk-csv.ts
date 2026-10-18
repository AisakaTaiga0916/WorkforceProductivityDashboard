/**
 * Import IT SALF helpdesk Google Form export into HelpdeskCsvTicket.
 * Sheet STATUS "Completed" is stored as FOR_CONFIRMATION (For confirmation in Insights).
 *
 * Usage:
 *   npx tsx scripts/apply-helpdesk-csv.ts "C:\Users\...\IT SALF - HELPDESK.csv"
 */
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  HELPDESK_CSV_CLOSED,
  HELPDESK_CSV_FOR_CONFIRMATION,
  parseHelpdeskExportCsv,
  syncHelpdeskCsvToDatabase,
} from "../src/modules/requests/helpdesk-csv";
import { normalizeTimeZone } from "../src/modules/tasks/kpi-recurrence";

async function main() {
  const filePath = resolve(process.argv[2] ?? "");
  if (!filePath || filePath === resolve(".")) {
    console.error("Usage: npx tsx scripts/apply-helpdesk-csv.ts <path-to-IT SALF - HELPDESK.csv>");
    process.exit(1);
  }

  const timeZone = normalizeTimeZone(process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");
  const content = readFileSync(filePath, "utf8");
  const parsed = parseHelpdeskExportCsv(content, timeZone);
  const completed = parsed.filter((r) => r.normalizedBucket === HELPDESK_CSV_FOR_CONFIRMATION).length;
  const closed = parsed.filter((r) => r.normalizedBucket === HELPDESK_CSV_CLOSED).length;
  const pipeline = parsed.length - completed - closed;

  const { upserted } = await syncHelpdeskCsvToDatabase(content, timeZone);
  console.log(`Parsed ${parsed.length} row(s) from ${filePath}`);
  console.log(`  Completed → For confirmation: ${completed}`);
  console.log(`  Closed: ${closed}`);
  console.log(`  Other (pipeline): ${pipeline}`);
  console.log(`Upserted ${upserted} row(s) into HelpdeskCsvTicket.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
