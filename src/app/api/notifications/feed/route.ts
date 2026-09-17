import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { loadStaffNotificationFeed } from "@/lib/staff-notifications";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  const { searchParams } = new URL(req.url);
  const pageRaw = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const pageSizeRaw = Number.parseInt(searchParams.get("pageSize") ?? "20", 10);
  const page = Number.isFinite(pageRaw) ? pageRaw : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? pageSizeRaw : 20;

  const feed = await loadStaffNotificationFeed({ session, page, pageSize });

  return NextResponse.json(feed, {
    headers: { "cache-control": "private, no-store" },
  });
}
