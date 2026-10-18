import { NextResponse } from "next/server";
import {
  parseCompanyLogoDataUrl,
  readCompanyLogoByName,
  readCompanyLogoFile,
} from "@/lib/company-logo";
import { prisma } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ teamId: string }> },
) {
  const session = await safeGetServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId } = await ctx.params;
  const id = (teamId ?? "").trim();
  if (!id) {
    return new NextResponse(null, { status: 404 });
  }

  const rows = await prisma.$queryRawUnsafe<
    { name: string; logo_image: string | null; logo_path: string | null }[]
  >(
    `SELECT name, logo_image, logo_path FROM teams WHERE id = $1 LIMIT 1`,
    id,
  );
  const row = rows[0];
  if (!row) {
    return new NextResponse(null, { status: 404 });
  }

  // Prefer local folder logos mapped by company name (Company Board source of truth).
  const fromName = readCompanyLogoByName(row.name);
  if (fromName) {
    return new NextResponse(new Uint8Array(fromName.bytes), {
      status: 200,
      headers: {
        "content-type": fromName.mime,
        "cache-control": "private, max-age=300",
      },
    });
  }

  const fromDb = row.logo_image?.trim()
    ? parseCompanyLogoDataUrl(row.logo_image)
    : null;
  if (fromDb) {
    return new NextResponse(new Uint8Array(fromDb.bytes), {
      status: 200,
      headers: {
        "content-type": fromDb.mime,
        "cache-control": "private, max-age=300",
      },
    });
  }

  const fromDisk = readCompanyLogoFile(row.logo_path);
  if (fromDisk) {
    return new NextResponse(new Uint8Array(fromDisk.bytes), {
      status: 200,
      headers: {
        "content-type": fromDisk.mime,
        "cache-control": "private, max-age=300",
      },
    });
  }

  return new NextResponse(null, { status: 404 });
}
