-- Main-DB snapshot of merged / HRIS users (filled by the merged-dump import).

-- CreateTable
CREATE TABLE IF NOT EXISTS "hris_users" (
    "source_user_id" BIGINT NOT NULL,
    "source_database" TEXT NOT NULL,
    "employee_code" TEXT,
    "username" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "company_id" BIGINT,
    "company_name" TEXT,
    "department" TEXT,
    "position" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hris_users_pkey" PRIMARY KEY ("source_user_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "hris_users_email_idx" ON "hris_users"("email");
CREATE INDEX IF NOT EXISTS "hris_users_username_idx" ON "hris_users"("username");
CREATE INDEX IF NOT EXISTS "hris_users_source_database_is_active_idx" ON "hris_users"("source_database", "is_active");
