/** Short URL stored in JWT/session for uploaded profile photos (served by GET /api/me/profile-image). */
export const SESSION_PROFILE_IMAGE_ROUTE = "/api/me/profile-image";

/** Keep session/JWT cookies small — never embed base64 data URLs in auth tokens. */
export function compactSessionPicture(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("data:")) return SESSION_PROFILE_IMAGE_ROUTE;
  if (trimmed === SESSION_PROFILE_IMAGE_ROUTE) return trimmed;
  if (trimmed.length > 2048) return undefined;
  return trimmed;
}

/**
 * Lightweight assignee avatar URL (bytes served on demand by GET /api/agents/[id]/profile-image).
 * Pass `versionMs` (e.g. profileSyncedAt) so browsers pick up photo updates after upload.
 */
export function agentProfileImageSrc(
  agentId: string | null | undefined,
  versionMs?: number | null,
): string | null {
  const id = (agentId ?? "").trim();
  if (!id) return null;
  const base = `/api/agents/${encodeURIComponent(id)}/profile-image`;
  if (versionMs != null && Number.isFinite(versionMs) && versionMs > 0) {
    return `${base}?v=${Math.trunc(versionMs)}`;
  }
  return base;
}

export function parseProfileImageDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  try {
    return { mime: match[1].toLowerCase(), bytes: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

/** Decode a stored portal profile_image value into a binary response body. */
export function profileImageToBinaryResponse(profileImage: string | null | undefined): {
  bytes: Buffer;
  mime: string;
} | null {
  const value = (profileImage ?? "").trim();
  if (!value) return null;
  if (value.startsWith("data:")) {
    const parsed = parseProfileImageDataUrl(value);
    if (!parsed) return null;
    return { bytes: parsed.bytes, mime: parsed.mime };
  }
  return null;
}
