import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";
import { agentProfileImageSrc } from "@/lib/session-profile-image";

export type PortalAvatarMeta = {
  hasImage: boolean;
  profileImageZoom: number;
  profileImagePosX: number;
  profileImagePosY: number;
  /** Milliseconds since epoch for cache-busting avatar URLs. */
  versionMs: number | null;
};

/**
 * Load avatar crop + “has photo” flags without selecting multi‑MB profile_image blobs.
 * Safe for full agent rosters on the task board.
 */
export async function loadPortalAvatarMetaByEmails(
  emails: string[],
): Promise<Map<string, PortalAvatarMeta>> {
  const unique = [
    ...new Set(
      emails
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const out = new Map<string, PortalAvatarMeta>();
  if (unique.length === 0) return out;

  const rows = await prisma.$queryRaw<
    Array<{
      email: string;
      has_image: boolean;
      zoom: number;
      pos_x: number;
      pos_y: number;
      version_ms: bigint | number | null;
    }>
  >`
    SELECT LOWER(TRIM(email)) AS email,
           (profile_image IS NOT NULL AND BTRIM(profile_image) <> '') AS has_image,
           COALESCE(profile_image_zoom, 1)::float8 AS zoom,
           COALESCE(profile_image_pos_x, 50)::int AS pos_x,
           COALESCE(profile_image_pos_y, 50)::int AS pos_y,
           (EXTRACT(EPOCH FROM COALESCE(profile_synced_at, created_at)) * 1000)::bigint AS version_ms
    FROM portal_accounts
    WHERE LOWER(TRIM(email)) IN (${Prisma.join(unique)})
  `;

  for (const row of rows) {
    const versionRaw = row.version_ms;
    const versionMs =
      versionRaw == null
        ? null
        : typeof versionRaw === "bigint"
          ? Number(versionRaw)
          : Number(versionRaw);
    out.set(row.email, {
      hasImage: Boolean(row.has_image),
      profileImageZoom: Number.isFinite(row.zoom) ? row.zoom : 1,
      profileImagePosX: Number.isFinite(row.pos_x) ? row.pos_x : 50,
      profileImagePosY: Number.isFinite(row.pos_y) ? row.pos_y : 50,
      versionMs: Number.isFinite(versionMs) ? versionMs : null,
    });
  }
  return out;
}

/** Resolve Avatar `<img src>` for an agent id + optional portal meta. */
export function resolveAgentProfileImageSrc(
  agentId: string,
  meta: PortalAvatarMeta | null | undefined,
): string | null {
  if (!meta?.hasImage) return null;
  return agentProfileImageSrc(agentId, meta.versionMs);
}
