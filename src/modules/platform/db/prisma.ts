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
const PRIMARY_CLIENT_SCHEMA_REV = 7;

const logLevels: ("error" | "warn")[] =
  process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

/** Cap Prisma pools so the clients cannot exhaust their databases. */
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

/**
 * Defer creating a client (and requiring its URL) until first use, so the app
 * boots with only the main database configured.
 */
function lazyClient<T extends object>(create: () => T): T {
  let client: T | null = null;
  const resolve = () => (client ??= create());
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = resolve();
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

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

/**
 * Secondary (MySQL mergedatabase): attendance, task activities, and user
 * efficiencies — not identity. HRIS users reach the app only through the
 * merged-dump import (`hris_users` + `portal_accounts`). Created on first use.
 */
export const prismaSecondary =
  globalForPrisma.prismaSecondary ??
  lazyClient(
    () =>
      new PrismaClientSecondary({
        log: logLevels,
        datasources: {
          db: { url: withPoolLimit(requireDbUrl("DATABASE_URL_SECONDARY"), 10) },
        },
      }),
  );

/**
 * @deprecated Legacy Auth DB. The app no longer reads or writes it at runtime;
 * only old migration scripts use it. Created on first use.
 */
export const prismaAuth =
  globalForPrisma.prismaAuth ??
  lazyClient(
    () =>
      new PrismaClientAuth({
        log: logLevels,
        datasources: {
          db: { url: withPoolLimit(requireDbUrl("DATABASE_URL_AUTH"), 5) },
        },
      }),
  );

// Always reuse clients across HMR / workers to avoid "too many clients already".
globalForPrisma.prismaPrimary = prismaPrimary;
globalForPrisma.prismaPrimarySchemaRev = PRIMARY_CLIENT_SCHEMA_REV;
globalForPrisma.prismaSecondary = prismaSecondary;
globalForPrisma.prismaAuth = prismaAuth;

/** Backward-compatible alias so existing imports of `prisma` still work. */
export const prisma = prismaPrimary;
