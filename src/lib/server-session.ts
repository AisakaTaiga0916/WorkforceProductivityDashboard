import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/modules/platform/auth";

export async function safeGetServerSession(): Promise<Session | null> {
  try {
    return await getServerSession(authOptions);
  } catch {
    return null;
  }
}
