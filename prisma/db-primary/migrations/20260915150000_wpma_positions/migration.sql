-- Work Plan for Management Approval — COO / CEO seats

INSERT INTO "positions" ("id", "code", "name", "level_rank", "description", "is_active", "created_at", "updated_at") VALUES
  ('pos_wpma_coo', 'WPMA_COO', 'Work Plan — Chief Operating Officer (COO)', 2, 'Work Plan for Management Approval COO seat', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pos_wpma_ceo', 'WPMA_CEO', 'Work Plan — Chief Executive Officer (CEO)', 1, 'Work Plan for Management Approval CEO seat', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
