-- Work Plan for Management Approval payload (replaces Travel Order create form).
ALTER TABLE "travel_orders" ADD COLUMN IF NOT EXISTS "work_plan_meta" JSONB;
