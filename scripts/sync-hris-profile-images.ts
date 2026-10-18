/**
 * Carry HRIS profile photos into mergedatabase-live, then into portal_accounts.
 *
 * Sources (priority for portal):
 *  1. HRIS profile_image file on disk (supports GIF/PNG/JPG)
 *  2. HRIS face_image raw JPEG base64
 *
 * Usage:
 *   npx tsx scripts/sync-hris-profile-images.ts
 *   npx tsx scripts/sync-hris-profile-images.ts --apply
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { ensureMergedConsolidationSchema } from "./ensure-merged-consolidation-schema";
import { prismaPrimary } from "../src/modules/platform/db/prisma";
import { MAX_PROFILE_IMAGE_DATA_URL_CHARS } from "../src/lib/profile-image-limits";

const PROFILE_DIRS = [
  "C:/xampp/htdocs/HR/backend/storage/app/public/profiles",
  "C:/xampp/htdocs/HR/backend/public/storage/profiles",
  "C:/xampp/htdocs/HR_GEO/backend/storage/app/public/profiles",
  "C:/xampp/htdocs/HR_GEO/backend/public/storage/profiles",
];

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

type MergedImageRow = {
  source_user_id: bigint;
  username: string | null;
  email: string | null;
  name: string;
  profile_image: string | null;
  face_image: string | null;
};

function resolveProfileFile(relativePath: string | null | undefined): string | null {
  const rel = (relativePath ?? "").trim().replace(/^\/+/, "");
  if (!rel) return null;
  const fileName = path.basename(rel);
  const withoutPrefix = rel.replace(/^profiles[\\/]/, "");
  for (const dir of PROFILE_DIRS) {
    for (const candidate of [
      path.join(dir, fileName),
      path.join(dir, withoutPrefix),
      path.join(dir, rel),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
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

function faceToDataUrl(faceImage: string | null | undefined): string | null {
  const raw = (faceImage ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:image/")) {
    return raw.length <= MAX_PROFILE_IMAGE_DATA_URL_CHARS ? raw : null;
  }
  // HRIS stores raw JPEG base64
  const dataUrl = `data:image/jpeg;base64,${raw.replace(/\s+/g, "")}`;
  return dataUrl.length <= MAX_PROFILE_IMAGE_DATA_URL_CHARS ? dataUrl : null;
}

function portalDataUrlForRow(row: MergedImageRow): { dataUrl: string; source: string } | null {
  // Prefer live face captures over HRIS profile files (logos/branding often live in profile_image).
  const face = faceToDataUrl(row.face_image);
  if (face) return { dataUrl: face, source: "face_image" };
  const file = resolveProfileFile(row.profile_image);
  if (file) {
    const dataUrl = fileToDataUrl(file);
    if (dataUrl) return { dataUrl, source: `file:${path.basename(file)}` };
  }
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sourceDb = process.env.HRIS_MERGE_SOURCE_DB?.trim() || "hris";
  const targetDb = process.env.HRIS_MERGE_TARGET_DB?.trim() || "mergedatabase-live";
  const sourceTag = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || "hris";

  const secondaryUrl =
    process.env.DATABASE_URL_SECONDARY_SYNC?.trim() ||
    process.env.DATABASE_URL_SECONDARY?.trim() ||
    `mysql://root@localhost:3306/${targetDb}`;

  const db = new PrismaClientSecondary({ datasources: { db: { url: secondaryUrl } } });

  console.log({ apply, sourceDb, targetDb, sourceTag });
  await ensureMergedConsolidationSchema(db, targetDb, sourceTag);

  // Copy path + face blob from HRIS → merged_users
  const copySql = `
    UPDATE \`${targetDb}\`.merged_users l
    INNER JOIN \`${sourceDb}\`.users u ON u.id = l.source_user_id
    SET
      l.profile_image = u.profile_image,
      l.face_image = u.face_image,
      l.updated_at = CURRENT_TIMESTAMP
    WHERE l.source_database = '${sourceTag}'
  `;
  if (apply) {
    const n = await db.$executeRawUnsafe(copySql);
    console.log(`Copied HRIS images into merged_users (rows touched≈${n})`);
  } else {
    const preview = await db.$queryRawUnsafe<Array<{ with_path: bigint; with_face: bigint }>>(`
      SELECT
        SUM(u.profile_image IS NOT NULL AND TRIM(u.profile_image) <> '') AS with_path,
        SUM(u.face_image IS NOT NULL AND TRIM(u.face_image) <> '') AS with_face
      FROM \`${sourceDb}\`.users u
      INNER JOIN \`${targetDb}\`.merged_users l
        ON l.source_user_id = u.id AND l.source_database = '${sourceTag}'
    `);
    console.log("Dry run — HRIS images available for matched users:", preview[0]);
  }

  const rows = await db.$queryRawUnsafe<MergedImageRow[]>(`
    SELECT source_user_id, username, email, name, profile_image, face_image
    FROM \`${targetDb}\`.merged_users
    WHERE source_database = '${sourceTag}'
      AND is_active = 1
      AND (
        (profile_image IS NOT NULL AND TRIM(profile_image) <> '')
        OR (face_image IS NOT NULL AND TRIM(face_image) <> '')
      )
  `);

  let fileHits = 0;
  let faceHits = 0;
  let portalUpdated = 0;
  let portalSkipped = 0;
  let portalMissing = 0;

  for (const row of rows) {
    const resolved = portalDataUrlForRow(row);
    if (!resolved) {
      portalSkipped++;
      continue;
    }
    if (resolved.source.startsWith("file:")) fileHits++;
    else faceHits++;

    const portal =
      (row.email
        ? await prismaPrimary.portalAccount.findFirst({
            where: { email: { equals: row.email.trim().toLowerCase(), mode: "insensitive" } },
            select: { id: true, profileImage: true },
          })
        : null) ??
      (row.username
        ? await prismaPrimary.portalAccount.findFirst({
            where: { username: { equals: row.username.trim(), mode: "insensitive" } },
            select: { id: true, profileImage: true },
          })
        : null) ??
      (await prismaPrimary.portalAccount.findFirst({
        where: { mergedSourceUserId: row.source_user_id },
        select: { id: true, profileImage: true },
      }));

    if (!portal) {
      portalMissing++;
      continue;
    }

    // Only fill empty portal photos — never overwrite a user-set/custom image.
    const existing = (portal.profileImage ?? "").trim();
    if (existing) {
      portalSkipped++;
      continue;
    }

    console.log(
      `${apply ? "UPDATE" : "WOULD"} portal ${portal.id} <- ${resolved.source} (${row.username ?? row.email})`,
    );
    if (apply) {
      await prismaPrimary.portalAccount.update({
        where: { id: portal.id },
        data: { profileImage: resolved.dataUrl },
      });
      portalUpdated++;
    } else {
      portalUpdated++;
    }
  }

  console.log({
    mergedRowsWithImages: rows.length,
    fileHits,
    faceHits,
    portalUpdated,
    portalMissing,
    portalSkippedNoBinary: portalSkipped,
  });
  if (!apply) console.log("Pass --apply to write.");

  await db.$disconnect();
  await prismaPrimary.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
