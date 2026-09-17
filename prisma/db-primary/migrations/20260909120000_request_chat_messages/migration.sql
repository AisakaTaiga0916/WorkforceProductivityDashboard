-- Request chat: one thread per ticket (Socket.IO + Prisma)

CREATE TABLE IF NOT EXISTS "chat_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "sender_role" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_message_reads" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "reader_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_reads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chat_messages_ticket_id_created_at_idx" ON "chat_messages"("ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "chat_messages_sender_id_created_at_idx" ON "chat_messages"("sender_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_reads_message_id_reader_id_key" ON "chat_message_reads"("message_id", "reader_id");
CREATE INDEX IF NOT EXISTS "chat_message_reads_reader_id_read_at_idx" ON "chat_message_reads"("reader_id", "read_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_ticket_id_fkey'
  ) THEN
    ALTER TABLE "chat_messages"
      ADD CONSTRAINT "chat_messages_ticket_id_fkey"
      FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_message_reads_message_id_fkey'
  ) THEN
    ALTER TABLE "chat_message_reads"
      ADD CONSTRAINT "chat_message_reads_message_id_fkey"
      FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
