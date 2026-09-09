import { prismaSecondary } from "../../src/lib/prisma.ts";

void (async () => {
  const freqs = await prismaSecondary.$queryRawUnsafe<
    Array<{ frequency: string; period_key: string; c: bigint }>
  >(
    `SELECT frequency, period_key, COUNT(*) AS c
     FROM merged_user_efficiency_breakdowns
     GROUP BY frequency, period_key
     ORDER BY frequency ASC, period_key DESC
     LIMIT 50`,
  );
  console.log(JSON.stringify(freqs.map((r) => ({ ...r, c: Number(r.c) })), null, 2));
  process.exit(0);
})();
