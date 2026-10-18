import { NextResponse } from "next/server";
import { getIntakeRequestTypeVisibility } from "@/modules/platform/settings/intake-request-type-visibility-db";

/** Public config for the create-request type picker (hidden types only). */
export async function GET() {
  const config = await getIntakeRequestTypeVisibility();
  return NextResponse.json(config);
}
