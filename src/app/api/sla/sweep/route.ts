import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/access";
import { runSlaEscalationSweep } from "@/modules/requests/sla";

export async function POST() {
  const { unauthorized } = await requireRole(["Admin"]);
  if (unauthorized) return unauthorized;

  const result = await runSlaEscalationSweep();
  // Ensure metrics/reporting pages read fresh post-sweep values.
  revalidatePath("/agent/reports");
  revalidatePath("/reports");
  return NextResponse.json(result);
}
