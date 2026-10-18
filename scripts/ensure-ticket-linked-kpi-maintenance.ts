import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  await prismaPrimary.$executeRawUnsafe(
    `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS linked_kpi_maintenance_id TEXT`,
  );
  await prismaPrimary.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS tickets_linked_kpi_maintenance_id_idx ON tickets(linked_kpi_maintenance_id)`,
  );
  await prismaPrimary.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tickets_linked_kpi_maintenance_id_fkey'
      ) THEN
        ALTER TABLE tickets
          ADD CONSTRAINT tickets_linked_kpi_maintenance_id_fkey
          FOREIGN KEY (linked_kpi_maintenance_id)
          REFERENCES kpi_maintenance(id)
          ON DELETE SET NULL
          ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
  console.log("tickets.linked_kpi_maintenance_id column ensured");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prismaPrimary.$disconnect());
