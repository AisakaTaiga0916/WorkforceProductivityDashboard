#!/usr/bin/env npx tsx
/**
 * Update merged_users.email from Google Workspace CSV exports.
 * Matches by person name (first + last). Ignores Password column.
 *
 * Usage:
 *   npx tsx scripts/update-merged-emails-from-workspace-csv.ts
 *   npx tsx scripts/update-merged-emails-from-workspace-csv.ts --apply
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizePersonName } from "../src/lib/person-name";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

const DEFAULT_CSVS = [
  "c:/Users/tkdemo/Documents/htdocs/USERS WORKSPACE - MCHISI.csv",
  "c:/Users/tkdemo/Documents/htdocs/USERS WORKSPACE - ALI.csv",
  "c:/Users/tkdemo/Documents/htdocs/USERS WORKSPACE - ACI.csv",
];

type CsvUser = {
  firstName: string;
  lastName: string;
  email: string;
  sourceFile: string;
  fullName: string;
};

type MergedRow = {
  source_user_id: bigint;
  name: string;
  username: string | null;
  email: string | null;
};

function personTokens(name: string): Set<string> {
  return new Set(
    normalizePersonName(name)
      .replace(/[,.]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function loadCsv(filePath: string): CsvUser[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const firstIdx = header.findIndex((h) => h.startsWith("first name"));
  const lastIdx = header.findIndex((h) => h.startsWith("last name"));
  const emailIdx = header.findIndex((h) => h.startsWith("email"));
  if (firstIdx < 0 || lastIdx < 0 || emailIdx < 0) {
    throw new Error(`Bad header in ${filePath}: ${lines[0]}`);
  }

  const rows: CsvUser[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const firstName = (cols[firstIdx] ?? "").trim();
    const lastName = (cols[lastIdx] ?? "").trim();
    const email = (cols[emailIdx] ?? "").trim().toLowerCase();
    if (!firstName || !lastName || !email || !email.includes("@")) continue;
    rows.push({
      firstName,
      lastName,
      email,
      sourceFile: path.basename(filePath),
      fullName: `${firstName} ${lastName}`,
    });
  }
  return rows;
}

function scoreNameMatch(csv: CsvUser, mergedName: string): number {
  const csvTokens = personTokens(`${csv.firstName} ${csv.lastName}`);
  const mergedTokens = personTokens(mergedName);
  const overlap = [...csvTokens].filter((t) => mergedTokens.has(t)).length;
  if (overlap < 2) return 0;

  let score = overlap * 10;
  const first = csv.firstName.trim().toLowerCase();
  const last = csv.lastName.trim().toLowerCase();
  const merged = normalizePersonName(mergedName);
  if (merged.includes(first)) score += 5;
  if (merged.includes(last)) score += 8;

  // Prefer exact last-name token match
  if (mergedTokens.has(last)) score += 6;
  return score;
}

async function registerMergedAlias(sourceUserId: bigint, username: string, dryRun: boolean) {
  const needle = username.trim().toLowerCase();
  if (!needle) return false;
  const existing = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*) AS c FROM merged_username_aliases WHERE LOWER(username) = ${needle}
  `;
  if (Number(existing[0]?.c ?? 0) > 0) return false;
  if (!dryRun) {
    await prismaSecondary.mergedUsernameAlias.create({
      data: {
        id: randomUUID(),
        sourceUserId,
        username: needle,
        source: "workspace_email",
      },
    });
  }
  return true;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const csvArgs: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--apply") continue;
    if (process.argv[i] === "--csv" && process.argv[i + 1]) {
      csvArgs.push(process.argv[++i]);
      continue;
    }
  }
  const files = csvArgs.length > 0 ? csvArgs : DEFAULT_CSVS;

  const csvUsers: CsvUser[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.warn(`Missing file: ${file}`);
      continue;
    }
    const rows = loadCsv(file);
    console.log(`Loaded ${rows.length} rows from ${path.basename(file)}`);
    csvUsers.push(...rows);
  }

  // Deduplicate by email (last wins)
  const byEmail = new Map<string, CsvUser>();
  for (const u of csvUsers) byEmail.set(u.email, u);
  const uniqueCsv = [...byEmail.values()];

  const mergedRows = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, name, username, email
    FROM merged_users
    WHERE is_active = 1
  `;

  type Match = {
    csv: CsvUser;
    merged: MergedRow;
    score: number;
  };

  const candidates: Match[] = [];
  for (const csv of uniqueCsv) {
    for (const merged of mergedRows) {
      const score = scoreNameMatch(csv, merged.name);
      if (score >= 20) candidates.push({ csv, merged, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedCsv = new Set<string>();
  const usedMerged = new Set<string>();
  const chosen: Match[] = [];
  for (const m of candidates) {
    const csvKey = m.csv.email;
    const mergedKey = m.merged.source_user_id.toString();
    if (usedCsv.has(csvKey) || usedMerged.has(mergedKey)) continue;
    usedCsv.add(csvKey);
    usedMerged.add(mergedKey);
    chosen.push(m);
  }

  let updated = 0;
  let already = 0;
  let aliases = 0;
  let portalUpdated = 0;
  const unmatchedCsv = uniqueCsv.filter((u) => !usedCsv.has(u.email));
  const conflicts: string[] = [];

  console.log(apply ? "\n=== APPLY email updates ===" : "\n=== Dry run (pass --apply to write) ===");
  console.log(`Matched pairs: ${chosen.length} / ${uniqueCsv.length} CSV users`);

  for (const match of chosen) {
    const oldEmail = match.merged.email?.trim().toLowerCase() || null;
    const newEmail = match.csv.email;
    if (oldEmail === newEmail) {
      already++;
      continue;
    }

    // Check another active user already owns this email
    const taken = await prismaSecondary.$queryRaw<Array<{ source_user_id: bigint; name: string }>>`
      SELECT source_user_id, name FROM merged_users
      WHERE is_active = 1
        AND LOWER(email) = ${newEmail}
        AND source_user_id <> ${match.merged.source_user_id}
      LIMIT 1
    `;
    if (taken[0]) {
      conflicts.push(
        `${match.merged.name} → ${newEmail} (already used by ${taken[0].name} #${taken[0].source_user_id})`,
      );
      continue;
    }

    console.log(
      `  [${match.score}] ${match.merged.name} (#${match.merged.source_user_id})`,
      `${oldEmail ?? "(none)"} → ${newEmail}`,
      `(${match.csv.sourceFile})`,
    );

    if (apply) {
      await prismaSecondary.$executeRaw`
        UPDATE merged_users
        SET email = ${newEmail}, updated_at = CURRENT_TIMESTAMP
        WHERE source_user_id = ${match.merged.source_user_id}
      `;

      // Keep old email loginable as alias
      if (oldEmail && oldEmail !== newEmail) {
        if (await registerMergedAlias(match.merged.source_user_id, oldEmail, false)) aliases++;
        const local = oldEmail.split("@")[0];
        if (local && (await registerMergedAlias(match.merged.source_user_id, local, false))) aliases++;
      }
      // New workspace email local-part as alias too
      const newLocal = newEmail.split("@")[0];
      if (newLocal && (await registerMergedAlias(match.merged.source_user_id, newLocal, false))) {
        aliases++;
      }

      // Sync linked portal profile email when free
      const portal = await prismaPrimary.portalAccount.findFirst({
        where: { mergedSourceUserId: match.merged.source_user_id },
        select: { id: true, email: true },
      });
      if (portal && portal.email.trim().toLowerCase() !== newEmail) {
        const emailTaken = await prismaPrimary.portalAccount.findFirst({
          where: {
            email: { equals: newEmail, mode: "insensitive" },
            NOT: { id: portal.id },
          },
          select: { id: true },
        });
        if (!emailTaken) {
          await prismaPrimary.portalAccount.update({
            where: { id: portal.id },
            data: { email: newEmail },
          });
          portalUpdated++;
        }
      }
    } else if (oldEmail) {
      aliases += 2;
    }

    updated++;
  }

  console.log(
    JSON.stringify(
      {
        csvUsers: uniqueCsv.length,
        matched: chosen.length,
        wouldUpdateOrUpdated: updated,
        alreadyCorrect: already,
        aliasesRegistered: aliases,
        portalEmailsUpdated: portalUpdated,
        unmatchedCsv: unmatchedCsv.length,
        conflicts: conflicts.length,
      },
      null,
      2,
    ),
  );

  if (unmatchedCsv.length) {
    console.log("\nUnmatched CSV users:");
    for (const u of unmatchedCsv.slice(0, 40)) {
      console.log(`  - ${u.fullName} <${u.email}> (${u.sourceFile})`);
    }
    if (unmatchedCsv.length > 40) console.log(`  ... +${unmatchedCsv.length - 40} more`);
  }
  if (conflicts.length) {
    console.log("\nEmail conflicts (skipped):");
    for (const c of conflicts) console.log(`  - ${c}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
    await prismaSecondary.$disconnect();
  });
