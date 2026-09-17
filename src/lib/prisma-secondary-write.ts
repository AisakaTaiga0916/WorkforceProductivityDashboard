import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { withPoolLimit } from "@/lib/prisma";

/**
 * Write URL for the MySQL merge DB.
 * `DATABASE_URL_SECONDARY` is often `merge_app` (SELECT-only); ETL / personnel
 * sync writes must use `DATABASE_URL_SECONDARY_SYNC` (or a non-merge_app URL).
 */
export function resolveSecondaryWriteUrl(): string {
  const explicit = process.env.DATABASE_URL_SECONDARY_SYNC?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.DATABASE_URL_SECONDARY?.trim();
  if (appUrl && !appUrl.includes("merge_app@")) return appUrl;
  return "mysql://root@localhost:3306/mergeddatabase-dev";
}

/** True when the app secondary URL is the least-privilege read user. */
export function isSecondaryAppReadOnly(): boolean {
  const appUrl = process.env.DATABASE_URL_SECONDARY?.trim() ?? "";
  return appUrl.includes("merge_app@");
}

/**
 * Run a callback against a short-lived write client (SYNC URL).
 * Disconnects afterward so we do not hold an extra pool for rare admin writes.
 */
export async function withSecondaryWriteClient<T>(
  fn: (db: PrismaClientSecondary) => Promise<T>,
): Promise<T> {
  const db = new PrismaClientSecondary({
    log: process.env.NODE_ENV === "development" ? ["warn"] : ["error"],
    datasources: { db: { url: withPoolLimit(resolveSecondaryWriteUrl(), 3) } },
  });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}
