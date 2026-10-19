/**
 * Dump HRIS company logos → mergeddatabase-dev, then sync into ticketing
 * `teams` + `departments` (logo-related columns).
 *
 * Sources:
 *   hris-dev.companies.logo  (company branding — primary)
 *   hris-dev.departments.logo (usually null; used when set)
 *
 * Logo files (optional): looks under HRIS_COMPANY_LOGO_DIRS / common Laravel paths.
 * When files are missing, paths are still stored so UI can resolve later.
 *
 * Usage:
 *   npx tsx scripts/sync-hris-company-logos.ts
 *   npx tsx scripts/sync-hris-company-logos.ts --apply
 *
 * Env:
 *   HRIS_MERGE_SOURCE_DB=hris-dev
 *   HRIS_MERGE_TARGET_DB=mergeddatabase-dev
 *   HRIS_MERGE_SOURCE_TAG=hris-dev
 *   HRIS_COMPANY_LOGO_DIRS=C:/path/to/storage/app/public;C:/other
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import {
  loadCompanyDirectory,
  type CompanyDirectory,
} from "../src/modules/platform/companies/company-directory";
import { MAX_PROFILE_IMAGE_DATA_URL_CHARS } from "../src/lib/profile-image-limits";
import { prismaPrimary } from "../src/modules/platform/db/prisma";
import { ensureMergedCompaniesSchema } from "./ensure-merged-companies-schema";

const DEFAULT_LOGO_DIRS = [
  "C:/Users/jlsms/OneDrive/Desktop/work/company logos",
  "C:/xampp/htdocs/HR/backend/storage/app/public",
  "C:/xampp/htdocs/HR/backend/public/storage",
  "C:/xampp/htdocs/HR_GEO/backend/storage/app/public",
  "C:/xampp/htdocs/HR_GEO/backend/public/storage",
  "C:/xampp/htdocs/HRIS/backend/storage/app/public",
  "C:/xampp/htdocs/HRIS/backend/public/storage",
];

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

type HrisCompanyRow = {
  id: bigint;
  name: string;
  logo: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: Date | null;
  updated_at: Date | null;
};

type HrisDepartmentRow = {
  id: bigint;
  name: string;
  company_id: bigint | null;
  logo: string | null;
  company_name: string | null;
  company_logo: string | null;
};

function loadEnvFromDotenv() {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch {
    /* ignore */
  }
}

function sqlId(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `\`${name}\``;
}

function logoSearchDirs(): string[] {
  const fromEnv = (process.env.HRIS_COMPANY_LOGO_DIRS ?? "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...fromEnv, ...DEFAULT_LOGO_DIRS];
}

function resolveLogoFile(relativePath: string | null | undefined): string | null {
  const rel = (relativePath ?? "").trim().replace(/^\/+/, "");
  if (!rel) return null;
  const fileName = path.basename(rel);
  const withoutPrefix = rel.replace(/^company-logos[\\/]/, "");
  for (const root of logoSearchDirs()) {
    for (const candidate of [
      path.join(root, rel),
      path.join(root, "company-logos", fileName),
      path.join(root, fileName),
      path.join(root, withoutPrefix),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function fileToDataUrl(filePath: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return null;
    const buf = fs.readFileSync(filePath);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    if (dataUrl.length > MAX_PROFILE_IMAGE_DATA_URL_CHARS) return null;
    return dataUrl;
  } catch {
    return null;
  }
}

function normalizeCompanyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** HRIS company name → company: directory name/code/alias first, then script heuristics. */
function resolveTeamName(
  directory: CompanyDirectory,
  hrisCompanyName: string | null | undefined,
): string | null {
  const hit = directory.resolveLabel(hrisCompanyName);
  if (hit) return hit.name;
  const raw = (hrisCompanyName ?? "").trim();
  if (!raw) return null;
  const key = normalizeCompanyKey(raw);
  if (key.includes("industr")) return "INDUSTRIES";
  if (key === "agc" || key.includes("amalgated capital") || key.includes("amalgamated capital")) {
    return "AGC";
  }
  return raw.toUpperCase();
}

async function main() {
  loadEnvFromDotenv();
  const apply = process.argv.includes("--apply");
  const sourceDb = process.env.HRIS_MERGE_SOURCE_DB?.trim() || "hris-dev";
  const targetDb = process.env.HRIS_MERGE_TARGET_DB?.trim() || "mergeddatabase-dev";
  const sourceTag = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || sourceDb;

  const secondaryUrl =
    process.env.DATABASE_URL_SECONDARY_SYNC?.trim() ||
    process.env.DATABASE_URL_SECONDARY?.trim();
  if (!secondaryUrl) throw new Error("DATABASE_URL_SECONDARY_SYNC is required");

  const db = new PrismaClientSecondary({ datasources: { db: { url: secondaryUrl } } });
  const source = sqlId(sourceDb);
  const target = sqlId(targetDb);

  console.log({ apply, sourceDb, targetDb, sourceTag });

  await ensureMergedCompaniesSchema(db, targetDb);

  const companies = await db.$queryRawUnsafe<HrisCompanyRow[]>(`
    SELECT id, name, logo, phone, email, address, created_at, updated_at
    FROM ${source}.companies
    ORDER BY name
  `);

  console.log(`[merge] ${companies.length} companies from ${sourceDb}`);

  let logoFilesFound = 0;
  const companyLogoById = new Map<
    string,
    { path: string | null; image: string | null; name: string }
  >();

  for (const c of companies) {
    const logoPath = (c.logo ?? "").trim() || null;
    let logoImage: string | null = null;
    if (logoPath) {
      const file = resolveLogoFile(logoPath);
      if (file) {
        logoImage = fileToDataUrl(file);
        if (logoImage) logoFilesFound += 1;
      }
    }
    companyLogoById.set(c.id.toString(), {
      path: logoPath,
      image: logoImage,
      name: c.name,
    });

    if (apply) {
      await db.$executeRawUnsafe(
        `
        INSERT INTO ${target}.merged_companies (
          source_company_id, source_database, name, logo_path, logo_image,
          phone, email, address, created_at, updated_at, merged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          source_database = VALUES(source_database),
          name = VALUES(name),
          logo_path = VALUES(logo_path),
          logo_image = COALESCE(VALUES(logo_image), logo_image),
          phone = VALUES(phone),
          email = VALUES(email),
          address = VALUES(address),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at),
          merged_at = CURRENT_TIMESTAMP
        `,
        c.id,
        sourceTag,
        c.name,
        logoPath,
        logoImage,
        c.phone,
        c.email,
        c.address,
        c.created_at,
        c.updated_at,
      );
    } else {
      console.log(
        `  [dry] company ${c.id} ${c.name} logo=${logoPath ?? "—"} file=${logoImage ? "yes" : "no"}`,
      );
    }
  }

  console.log(`[merge] logo files resolved on disk: ${logoFilesFound}/${companies.length}`);

  // ── Primary: teams (companies) + departments (raw SQL so stale clients still work) ──
  type TeamRow = { id: string; name: string };
  const teams = await prismaPrimary.$queryRawUnsafe<TeamRow[]>(
    `SELECT id, name FROM teams ORDER BY name`,
  );
  const teamByKey = new Map<string, TeamRow>();
  for (const t of teams) {
    teamByKey.set(normalizeCompanyKey(t.name), t);
  }
  const directory = await loadCompanyDirectory();

  let teamsUpdated = 0;
  for (const c of companies) {
    const rosterName = resolveTeamName(directory, c.name);
    if (!rosterName) continue;
    const team =
      teamByKey.get(normalizeCompanyKey(rosterName)) ||
      teamByKey.get(normalizeCompanyKey(c.name));
    if (!team) {
      console.log(`  [skip team] no Team row for HRIS company "${c.name}" → ${rosterName}`);
      continue;
    }
    const logos = companyLogoById.get(c.id.toString())!;
    if (apply) {
      await prismaPrimary.$executeRawUnsafe(
        `
        UPDATE teams
        SET hris_company_id = $1::bigint,
            logo_path = $2,
            logo_image = COALESCE($3, logo_image)
        WHERE id = $4
        `,
        c.id.toString(),
        logos.path,
        logos.image,
        team.id,
      );
    }
    teamsUpdated += 1;
    if (!apply) {
      console.log(
        `  [dry] team ${team.name} ← ${c.name} logo=${logos.path ?? "—"} image=${logos.image ? "yes" : "no"}`,
      );
    }
  }

  const departments = await db.$queryRawUnsafe<HrisDepartmentRow[]>(`
    SELECT
      d.id,
      d.name,
      d.company_id,
      d.logo,
      c.name AS company_name,
      c.logo AS company_logo
    FROM ${source}.departments d
    LEFT JOIN ${source}.companies c ON c.id = d.company_id
    ORDER BY c.name, d.name
  `);

  console.log(`[primary] ${departments.length} HRIS departments to upsert`);

  let deptsUpserted = 0;
  let deptsSkipped = 0;

  for (const d of departments) {
    const companyName = d.company_name ?? companyLogoById.get(d.company_id?.toString() ?? "")?.name;
    const rosterName = resolveTeamName(directory, companyName);
    const team =
      (rosterName && teamByKey.get(normalizeCompanyKey(rosterName))) ||
      (companyName && teamByKey.get(normalizeCompanyKey(companyName))) ||
      null;

    if (!team) {
      deptsSkipped += 1;
      console.log(
        `  [skip dept] "${d.name}" — no Team for company "${companyName ?? "null"}"`,
      );
      continue;
    }

    const companyLogos = d.company_id
      ? companyLogoById.get(d.company_id.toString())
      : undefined;
    const deptLogoPath = (d.logo ?? "").trim() || null;
    const companyLogoPath =
      (d.company_logo ?? "").trim() || companyLogos?.path || null;

    let logoImage: string | null = null;
    if (deptLogoPath) {
      const file = resolveLogoFile(deptLogoPath);
      if (file) logoImage = fileToDataUrl(file);
    }
    if (!logoImage && companyLogos?.image) {
      logoImage = companyLogos.image;
    } else if (!logoImage && companyLogoPath) {
      const file = resolveLogoFile(companyLogoPath);
      if (file) logoImage = fileToDataUrl(file);
    }

    if (apply) {
      const existing = await prismaPrimary.$queryRawUnsafe<{ id: string }[]>(
        `
        SELECT id FROM departments
        WHERE hris_department_id = $1::bigint
           OR (company_team_id = $2 AND name = $3)
        LIMIT 1
        `,
        d.id.toString(),
        team.id,
        d.name,
      );

      if (existing[0]) {
        await prismaPrimary.$executeRawUnsafe(
          `
          UPDATE departments SET
            name = $1,
            company_team_id = $2,
            is_active = true,
            hris_department_id = $3::bigint,
            hris_company_id = $4::bigint,
            logo_path = $5,
            company_logo_path = $6,
            logo_image = COALESCE($7, logo_image),
            updated_at = NOW()
          WHERE id = $8
          `,
          d.name,
          team.id,
          d.id.toString(),
          d.company_id?.toString() ?? null,
          deptLogoPath,
          companyLogoPath,
          logoImage,
          existing[0].id,
        );
      } else {
        await prismaPrimary.$executeRawUnsafe(
          `
          INSERT INTO departments (
            id, name, company_team_id, is_active,
            hris_department_id, hris_company_id,
            logo_path, company_logo_path, logo_image,
            created_at, updated_at
          ) VALUES (
            gen_random_uuid()::text, $1, $2, true,
            $3::bigint, $4::bigint,
            $5, $6, $7,
            NOW(), NOW()
          )
          `,
          d.name,
          team.id,
          d.id.toString(),
          d.company_id?.toString() ?? null,
          deptLogoPath,
          companyLogoPath,
          logoImage,
        );
      }
    } else {
      console.log(
        `  [dry] dept ${team.name} / ${d.name} companyLogo=${companyLogoPath ?? "—"} image=${logoImage ? "yes" : "no"}`,
      );
    }
    deptsUpserted += 1;
  }

  const mergedCount = apply
    ? (
        await db.$queryRawUnsafe<{ c: bigint }[]>(
          `SELECT COUNT(*) AS c FROM ${target}.merged_companies`,
        )
      )[0]?.c
    : BigInt(companies.length);

  console.log({
    apply,
    mergedCompanies: mergedCount?.toString(),
    teamsUpdated,
    departmentsUpserted: deptsUpserted,
    departmentsSkipped: deptsSkipped,
    logoFilesFound,
  });

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write merged + primary tables.");
  }

  await db.$disconnect();
  await prismaPrimary.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
