import { PrismaClient as PrismaClientPrimary } from "@prisma/client/primary";
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { PrismaClient as PrismaClientAuth } from "@prisma/client/auth";

const globalForPrisma = globalThis as unknown as {
  prismaPrimary: PrismaClientPrimary | undefined;
  prismaPrimarySchemaRev: number | undefined;
  prismaSecondary: PrismaClientSecondary | undefined;
  prismaAuth: PrismaClientAuth | undefined;
};

/** Bump when primary schema adds models/fields that existing HMR clients would miss. */
const PRIMARY_CLIENT_SCHEMA_REV = 5;

const logLevels: ("error" | "warn")[] =
  process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

/** Cap Prisma pools so three clients (primary/secondary/auth) cannot exhaust Postgres. */
export function withPoolLimit(url: string, limit: number): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connection_limit")) {
      u.searchParams.set("connection_limit", String(limit));
    }
    if (!u.searchParams.has("pool_timeout")) {
      u.searchParams.set("pool_timeout", "10");
    }
    return u.toString();
  } catch {
    return url;
  }
}

function requireDbUrl(envName: string, ...fallbacks: Array<string | undefined>): string {
  for (const candidate of [process.env[envName], ...fallbacks]) {
    const url = candidate?.trim();
    if (url) return url;
  }
  throw new Error(
    `Missing ${envName} (and no usable fallback). Set it in .env — see .env.example.`,
  );
}

const primaryUrl = requireDbUrl("DATABASE_URL_PRIMARY", process.env.DATABASE_URL);
const secondaryUrl = requireDbUrl("DATABASE_URL_SECONDARY");
const authUrl = requireDbUrl("DATABASE_URL_AUTH");

function createPrimaryClient() {
  return new PrismaClientPrimary({
    log: logLevels,
    datasources: {
      db: { url: withPoolLimit(primaryUrl, 10) },
    },
  });
}

export let prismaPrimary =
  globalForPrisma.prismaPrimary ?? createPrimaryClient();

// Dev HMR can keep an old PrismaClient that predates new models (e.g. RequestBoardColumn).
const primaryNeedsRefresh =
  process.env.NODE_ENV !== "production" &&
  (globalForPrisma.prismaPrimarySchemaRev !== PRIMARY_CLIENT_SCHEMA_REV ||
    typeof (prismaPrimary as { requestBoardColumn?: unknown }).requestBoardColumn === "undefined");

if (primaryNeedsRefresh) {
  void prismaPrimary.$disconnect().catch(() => undefined);
  prismaPrimary = createPrimaryClient();
}

/** Secondary (MySQL mergedatabase): HRIS + attendance + task activities + user efficiencies. */
export const prismaSecondary =
  globalForPrisma.prismaSecondary ??
  new PrismaClientSecondary({
    log: logLevels,
    datasources: {
      db: { url: withPoolLimit(secondaryUrl, 10) },
    },
  });

/** Auth DB (PostgreSQL): OAuth identities linked to portal profiles. */
export const prismaAuth =
  globalForPrisma.prismaAuth ??
  new PrismaClientAuth({
    log: logLevels,
    datasources: {
      db: { url: withPoolLimit(authUrl, 5) },
    },
  });

// Always reuse clients across HMR / workers to avoid "too many clients already".
globalForPrisma.prismaPrimary = prismaPrimary;
globalForPrisma.prismaPrimarySchemaRev = PRIMARY_CLIENT_SCHEMA_REV;
globalForPrisma.prismaSecondary = prismaSecondary;
globalForPrisma.prismaAuth = prismaAuth;

/** Backward-compatible alias so existing imports of `prisma` still work. */
export const prisma = prismaPrimary;
