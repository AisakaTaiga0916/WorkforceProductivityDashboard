import { NextResponse } from "next/server";
import { MAX_PROFILE_IMAGE_DATA_URL_CHARS } from "@/lib/profile-image-limits";
import { prisma } from "@/lib/prisma";
import {
  profileImageToBinaryResponse,
} from "@/lib/session-profile-image";
import { safeGetServerSession } from "@/lib/server-session";
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;

export async function GET() {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email.toLowerCase();
  const username =
    typeof session.user.username === "string" ? session.user.username.trim() : "";

  const portal =
    (await prisma.portalAccount.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { profileImage: true },
    })) ??
    (username
      ? await prisma.portalAccount.findFirst({
          where: { username: { equals: username, mode: "insensitive" } },
          select: { profileImage: true },
        })
      : null);

  const binary = profileImageToBinaryResponse(portal?.profileImage);
  if (binary) {
    return new NextResponse(new Uint8Array(binary.bytes), {
      headers: {
        "Content-Type": binary.mime,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const profileImage = portal?.profileImage?.trim();
  if (profileImage && /^https?:\/\//i.test(profileImage)) {
    return NextResponse.redirect(profileImage);
  }

  return new NextResponse(null, { status: 404 });
}

export async function PATCH(req: Request) {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    imageDataUrl?: string;
    zoom?: number;
    posX?: number;
    posY?: number;
  };
  const imageDataUrlRaw = body.imageDataUrl?.trim();
  if (imageDataUrlRaw) {
    if (!IMAGE_DATA_URL_RE.test(imageDataUrlRaw)) {
      return NextResponse.json({ error: "Unsupported image format. Use PNG, JPG, WEBP, or GIF." }, { status: 400 });
    }
    if (imageDataUrlRaw.length > MAX_PROFILE_IMAGE_DATA_URL_CHARS) {
      return NextResponse.json(
        { error: "Image is too large. Please upload up to 10MB (PNG, JPG, WEBP, or GIF)." },
        { status: 400 },
      );
    }
  }
  const zoom = typeof body.zoom === "number" ? Math.min(3, Math.max(1, body.zoom)) : undefined;
  const posX = typeof body.posX === "number" ? Math.min(100, Math.max(0, Math.round(body.posX))) : undefined;
  const posY = typeof body.posY === "number" ? Math.min(100, Math.max(0, Math.round(body.posY))) : undefined;

  if (!imageDataUrlRaw && zoom === undefined && posX === undefined && posY === undefined) {
    return NextResponse.json({ error: "No profile image changes provided." }, { status: 400 });
  }

  const email = session.user.email.toLowerCase();
  const updated = await prisma.portalAccount.update({
    where: { email },
    data: {
      ...(imageDataUrlRaw
        ? { profileImage: imageDataUrlRaw, profileSyncedAt: new Date() }
        : {}),
      ...(zoom !== undefined ? { profileImageZoom: zoom } : {}),
      ...(posX !== undefined ? { profileImagePosX: posX } : {}),
      ...(posY !== undefined ? { profileImagePosY: posY } : {}),
    },
    select: {
      profileImage: true,
      profileImageZoom: true,
      profileImagePosX: true,
      profileImagePosY: true,
      profileSyncedAt: true,
    },
  });

  return NextResponse.json({
    profileImage: updated.profileImage,
    profileImageZoom: updated.profileImageZoom,
    profileImagePosX: updated.profileImagePosX,
    profileImagePosY: updated.profileImagePosY,
    profileSyncedAt: updated.profileSyncedAt,
  });
}

export async function DELETE() {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email.toLowerCase();
  await prisma.portalAccount.update({
    where: { email },
    data: {
      profileImage: null,
      profileImageZoom: 1,
      profileImagePosX: 50,
      profileImagePosY: 50,
      profileSyncedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
