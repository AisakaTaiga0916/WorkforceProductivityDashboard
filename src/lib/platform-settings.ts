import { prisma } from "@/modules/platform/db/prisma";

let ensured: Promise<unknown> | null = null;

export async function ensurePlatformSettingsTable() {
  ensured ??= createPlatformSettingsTable().catch((e) => {
    ensured = null;
    throw e;
  });
  await ensured;
}

async function createPlatformSettingsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function getPlatformSettingJson(key: string): Promise<unknown | null> {
  await ensurePlatformSettingsTable();
  const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
    SELECT value FROM platform_settings WHERE key = ${key} LIMIT 1
  `;
  return rows[0]?.value ?? null;
}

export async function setPlatformSettingJson(key: string, value: unknown): Promise<void> {
  await ensurePlatformSettingsTable();
  const json = JSON.stringify(value);
  await prisma.$executeRaw`
    INSERT INTO platform_settings (key, value, updated_at, created_at)
    VALUES (
      ${key},
      ${json}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = NOW()
  `;
}
