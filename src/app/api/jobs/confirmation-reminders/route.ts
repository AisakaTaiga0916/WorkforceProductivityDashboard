import { NextResponse } from "next/server";
import { runForConfirmationReminderSweep } from "@/modules/requests/confirmation-reminders";

export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const configured = process.env.INTERNAL_JOB_KEY?.trim();
  if (!configured) return false;
  return req.headers.get("x-internal-job-key") === configured;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runForConfirmationReminderSweep();
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
