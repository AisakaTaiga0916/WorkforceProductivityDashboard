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

const { PrismaClient: PrismaSecondary } = require("@prisma/client/secondary");
const { PrismaClient: PrismaPrimary } = require("@prisma/client/primary");

async function main() {
  const secondary = new PrismaSecondary();
  const primary = new PrismaPrimary();

  const stats = await secondary.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM hris.users WHERE email IS NOT NULL AND TRIM(email) <> '') AS hris_with_email,
      (SELECT COUNT(*) FROM \`mergedatabase-live\`.merged_users
        WHERE source_database = 'hris' AND email IS NOT NULL AND TRIM(email) <> '') AS merged_with_email,
      (SELECT COUNT(*) FROM \`mergedatabase-live\`.merged_users WHERE source_database = 'hris') AS merged_total
  `);
  console.log("counts", stats[0]);

  const hris = await secondary.$queryRawUnsafe(`
    SELECT id, username, email
    FROM hris.users
    WHERE email IS NOT NULL AND TRIM(email) <> ''
    ORDER BY updated_at DESC
    LIMIT 6
  `);

  console.log("\nCross-check (HRIS → merged → portal):");
  for (const s of hris) {
    const uname = String(s.username || "").trim().toLowerCase();
    const mRows = await secondary.$queryRawUnsafe(
      `SELECT email FROM \`mergedatabase-live\`.merged_users
       WHERE source_database = 'hris' AND LOWER(username) = ? LIMIT 1`,
      uname,
    );
    const mergedEmail = mRows[0]?.email ?? null;
    const portal = await primary.portalAccount.findFirst({
      where: { username: { equals: uname, mode: "insensitive" } },
      select: { email: true, username: true },
    });
    const hrisEmail = String(s.email || "").trim().toLowerCase();
    const mergedNorm = String(mergedEmail || "").trim().toLowerCase();
    const portalNorm = String(portal?.email || "").trim().toLowerCase();
    console.log({
      username: uname,
      hris: hrisEmail,
      merged: mergedNorm,
      portal: portalNorm || null,
      hrisEqMerged: hrisEmail === mergedNorm,
      mergedEqPortal: mergedNorm === portalNorm,
    });
  }

  await secondary.$disconnect();
  await primary.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
