import { NextResponse } from "next/server";
import { runHrisPortalSync } from "@/modules/platform/auth/hris-sync-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const configured = process.env.INTERNAL_JOB_KEY?.trim();
  if (!configured) return false;
  return req.headers.get("x-internal-job-key") === configured;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runHrisPortalSync();
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
