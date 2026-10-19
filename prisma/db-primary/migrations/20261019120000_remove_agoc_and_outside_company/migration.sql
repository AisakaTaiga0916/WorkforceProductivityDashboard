-- Remove the AGOC company and the OUTSIDE customer triage queue from the directory.
-- Databases that already applied the original `companies_as_data` seed still contain
-- these rows. They are archived (companies are never hard-deleted) so historical
-- tickets, agents, memberships, and portal accounts keep valid references.
UPDATE "teams" SET "is_active" = false WHERE "code" IN ('AGOC', 'OUTSIDE');
