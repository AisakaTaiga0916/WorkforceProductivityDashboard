# IAM — single-DB auth, RBAC, and SuperAdmin Settings

Replaces the earlier dual Auth-DB RBAC plan. Identity, roles, permissions, and
system settings live on the **main (primary) database only**. The merged / HRIS
database is a **one-way import source**, never a runtime dependency for auth.

```text
Merged / HRIS dump (MySQL)
    → npm run db:import:merged-users   (batch, then disconnect)
    → main.portal_accounts  (+ company, employee-code alias)
    → main.hris_users       (read-only HRIS snapshot for roster / org chart)
    → app authenticates, authorizes, and lists people from the main DB only
```

| Database | Runtime role |
|---|---|
| Main (`DATABASE_URL_PRIMARY`) | **Required.** Identity, RBAC, settings, all app data. |
| Merged (`DATABASE_URL_SECONDARY`) | Optional at runtime: attendance (Activity / On Duty), task activities, efficiency. Read in batch by the import. Never used for identity. |
| Auth (`DATABASE_URL_AUTH`) | **Not used by the app.** Only legacy migration scripts touch it. |

Clients for the merged and Auth DBs are created lazily, so the app boots with
only `DATABASE_URL_PRIMARY`. Verified by running the app with both other URLs
pointing at an unreachable host: login, IAM, roster, accounts, org chart,
Workforce, and role changes all work; Activity shows no on-duty data.

## Data model (main DB)

| Table | Purpose |
|---|---|
| `portal_accounts` | **The users table.** `email`, `username`, `password_hash`, `name`, `role_id` (one primary role), `staff_designated_company_id` (company), `account_status` (`ACTIVE` / `INACTIVE` / `LEGACY_CONFLICT`). |
| `roles` | `key`, `name`, `description`, `is_system`, `archived_at`. System roles: `super_admin`, `admin`, `employee`. Custom roles use `custom_*` keys. |
| `permissions` | Catalog seeded from `src/modules/platform/rbac/permission-catalog.ts` (`<resource>.<action>`). |
| `role_permissions` | Grant rows. **Presence = allow, absence = deny.** |
| `platform_settings` | Key/value system settings (module visibility key `system_module_visibility`, task verification, Workforce toggles). |
| `teams` | Companies. |
| `hris_users` | Snapshot of every merged-dump row (name, email, username, HRIS role, company, department, position, active). Replaced on each import; read by the roster, Workforce, and org chart. |

`portal_accounts.role` (legacy label `SuperAdmin` / `Admin` / `Personnel` / …) is
kept in sync with `role_id` so existing role-name checks keep working until
those checks fully move to permissions. Custom roles store `Personnel` (least
privilege); Personnel-Guard kiosk accounts keep their label on Employee.

Migrations: `prisma/db-primary/migrations/20261017120000_rbac_roles_permissions`,
`20261017180000_hris_users_snapshot`.

In the UI the stored `Personnel` role reads **Employee** (`portalRoleDisplayLabel`
in `src/lib/staff-role.ts`); stored values and role checks are unchanged.

## Roles (v1)

| Role | Grants |
|---|---|
| Super Admin | Every permission. Locked in the matrix and short-circuited in `getEffectivePermissions`, so a bad grant row can never lock out administration. |
| Admin | Replaces legacy HighAdmin + Admin. Employee grants + assign requests/tasks, create/assign work plans, `users.read/update`, `settings.read`, `reports.export`. No `rbac.*`, `settings.update`, `hierarchy.update`, `users.assign`. |
| Employee | Replaces legacy Personnel. Create/read/update/submit requests; read/update/submit/verify tasks; read/update/submit/approve work plans; `hierarchy.read`, `reports.read`. |

`approve` / `verify` grant the *capability* only — workflow seat and org-chart
eligibility are still separate checks. Always enforce
**permission ∧ company scope ∧ workflow seat** as three independent checks.

## Authorization helpers — `src/modules/platform/rbac/permissions.ts`

- `getEffectivePermissions(subject)` / `getEffectiveAccess(subject)` — subject is `{ userId }` (session `user.id`), `{ email }`, or `{ roleId }`.
- `hasPermission(subject, key)`.
- `requirePermission(...keys)` — API guard; 401 without session, 403 unless **every** key is held.
- Fail closed: unknown/inactive user, no role, archived role, unknown key → deny.

Lockout rules (`src/modules/platform/rbac/rbac-policy.ts`): only a Super Admin can grant or
revoke Super Admin; the last active Super Admin cannot be demoted or
deactivated; nobody can deactivate themselves; system roles cannot be archived;
custom roles must have no users before archiving.

## Login

Credentials are verified against `portal_accounts.password_hash` only (HRIS
`$2y$` hashes are accepted). Password changes write only that column. The
runtime `merged_users` login mode and `PORTAL_CREDENTIALS_SOURCE` were removed in
Phase D. Google sign-in matches the main-DB account by email.

## Merged-dump import — `npm run db:import:merged-users`

Restore the dump into MySQL and point `MERGED_IMPORT_DATABASE_URL` at it
(falls back to `DATABASE_URL_SECONDARY_SYNC`, then `DATABASE_URL_SECONDARY`).

Flags: `--dry-run`, `--source-url=…`, `--include-non-hris`,
`--overwrite-passwords`, `--overwrite-company`.

Rules:

- Only HRIS-tagged rows by default; one row per person (shared email or username), preferring HRIS → active → has password → lowest id.
- Match existing users by merged source id → email → username. Legacy-conflict duplicates are never matched or revived.
- Name and merged link refresh; email / username move only when free.
- Password and company fill gaps only (unless the overwrite flags are set), so in-app password changes and Super Admin company assignments survive.
- HRIS-inactive → `INACTIVE`. The import never re-activates anyone.
- Users without a role get one from their legacy role, else the HRIS role (`super_admin` → Super Admin, `high_admin` → Admin, everything else → Employee). Existing roles are never changed by the import.
- HRIS employee codes become login aliases (`portal_username_aliases`, source `employee_code`).
- Every dump row (all sources, active or not) replaces the `hris_users` snapshot.

Also runs on the `sync-hris-portal` job (after the HRIS → merged ETL), and is available as **User Management → Import from merged dump** (`POST /api/admin/iam/import`, `users.create`).

## IAM seed (wipe) — `npm run db:seed:iam`

Dev / staging only. Refuses `NODE_ENV=production` unless `--confirm-wipe`.
Never run against production without a separate manual runbook.

1. Wipe `role_permissions` → `permissions` → `roles` (users keep their rows; `role_id` → null).
2. Re-seed catalog + the three system roles and their grants.
3. `--wipe-users` (optional): delete imported (HRIS-linked) users.
4. Re-import from the merged dump (`--skip-import` to skip; a missing dump only warns).
5. Assign roles: promotions (`IAM_SEED_SUPER_ADMINS`, `ADMIN_EMAILS`, `IAM_SEED_ADMINS`) → legacy role → Employee. Customers and legacy-conflict rows get no role.
6. Ensure the break-glass Super Admin (`IAM_BREAK_GLASS_EMAIL`, default `breakglass@iam.local`; `IAM_BREAK_GLASS_PASSWORD`, otherwise a generated password is printed once).

`--dry-run` prints the plan without writing.

## SuperAdmin Settings

`/admin/superadmin-settings` — new tabs:

| Tab | API | Permissions |
|---|---|---|
| Roles | `GET/POST /api/admin/iam/roles`, `PATCH/DELETE /api/admin/iam/roles/:id`, `PUT /api/admin/iam/roles/:id/permissions` | `rbac.read`, `rbac.create`, `rbac.update`, `rbac.archive`, `rbac.manage_permissions` |
| User Management | `GET /api/admin/iam/users`, `PATCH /api/admin/iam/users/:id`, `POST /api/admin/iam/import` | `users.read`; role → `users.assign`; company / active → `users.update`; import → `users.create`. Non–Super Admins are limited to their own company. |
| System Settings | `GET/PUT /api/system-settings/modules` | GET: any session; PUT: `settings.update` |

System Settings also hosts Priority alerts (escalation triggers) and the task-verification
toggle (`?tab=alerts` and `?tab=tasks` open System Settings). These are the only three tabs:
the Access Controls (stored, never enforced) tab and its API were deleted, and the Create
Request, Workforce, and FAQ tabs were removed — their saved values in `platform_settings`
/ the FAQ table still apply but are no longer editable in the UI.
Module visibility hides Requests (`/agent`), Tasks (`/agent/tasks`), and Work Plans
(`/travel-orders`) from the sidebar, shows a notice on those pages, and blocks
their mutation APIs (see Phase C).

## Phase C — API enforcement

Every check below is **added** to the existing gates, never a replacement:
legacy role gate ∧ **permission** ∧ company scope ∧ workflow seat. Denials return
`403 { code: "PERMISSION_DENIED", missing: [...] }`. Route handlers that already
hold a session use `permissionDenied(session, ...keys)`.

| Permission | Where | Notes |
|---|---|---|
| `tasks.verify` | `PATCH /api/task-management` (`lifecycle: verify/reject`), `PATCH /api/kpi-maintenance` (`completionVerification` approve/reject) | Checked before `canVerifyTaskCompletion` (verifier / org-chart head). Re-submit is not gated. |
| `requests.approve` | `PATCH /api/tickets/:id` — every procedural step completion: `approve_payment_step`, `complete_payment_approval_step`, `complete_item_requisition_approval_step` (+ canvass via pricing), `complete_fund_transfer_approval_step`, `complete_job_order_approval_step`, and IRS/FTR/JO steps completed by a For Confirmation move | Checked right before each seat gate (`canComplete…ApprovalStep`). Customers never reach these branches. |
| `work_plans.approve` | `PATCH /api/kpi-maintenance/:id/travel-orders/:toId` — `approve-level` / `APPROVED`, and `reject` when declining as an approver | Declining as the confirmer is a confirmation seat (not modeled) and is not gated. Seat check stays in `approveTravelOrderSequential`. |
| `users.assign` | `PATCH /api/admin/personnel/role`, `PATCH /api/admin/org-chart/portal-role`, `PATCH /api/admin/roles` with `role` | These also set `role_id`. |
| `users.update` | `PATCH /api/admin/roles` (other fields / Admin color), `PATCH /api/admin/personnel/company`, `PATCH /api/admin/personnel/color`, `PATCH/DELETE /api/admin/accounts/:id`, `PATCH /api/admin/account-requests`, `POST /api/admin/accounts/reconcile` | |
| `users.create` / `users.delete` | `POST /api/admin/roles`, `DELETE /api/admin/portal-accounts/:id` | |
| `requests.assign` | `POST /api/admin/manual-assignment` | After the elevated-role gate. |
| `tasks.create` | `POST /api/kpis/department-task-csv/import` | After the role + `canAssignWork` gates. |
| `hierarchy.update` | `POST/PATCH/DELETE /api/admin/org-chart`, `POST/PATCH/DELETE /api/admin/org-chart-sections`, `POST/DELETE /api/admin/org-chart-either-or` | Writes only; GETs keep the legacy SuperAdmin-only gate. Checked via `guardSuperAdmin("hierarchy.update")`. |
| `settings.update` | `PATCH /api/admin/triggers`, `PUT /api/admin/task-verification-settings`, `PUT /api/admin/department-metrics-visibility`, `PUT /api/admin/workforce-view-visibility`, `POST /api/admin/faq` + `PUT/DELETE /api/admin/faq/:id`, `PUT/POST /api/admin/intake-request-types` | Extends Phase B `settings.update` to the older SuperAdmin-only settings APIs. |
| `rbac.*`, `settings.update`, `users.*` | New IAM + System Settings APIs | Since Phase B. |

**Module visibility on APIs** (`moduleDisabledResponse`, `403 { code: "MODULE_DISABLED" }`, 5 s cache):

| Module | Mutations blocked when off |
|---|---|
| Tasks | `POST/PATCH /api/task-management`, `POST/PATCH /api/kpi-maintenance`, sub-task `POST`/copy/`PUT`/`DELETE` |
| Work Plans | `POST /api/kpi-maintenance/field-assignment`, travel-order create / `PATCH` / attachments / linked RFP / locations / submit-done |
| Requests | `POST /api/tickets`, `PATCH /api/tickets/:id`, `POST` messages / screenshots — **staff only**; the customer requestor portal is unaffected |

Reads stay available so dashboards and history keep working.

**UI honesty.** `GET /api/me/permissions` also returns the caller's effective RBAC `role` + `permissions`; `usePermissions` (`src/modules/platform/rbac/permissions-client.ts`) hides actions whose permission is known to be missing — task Verify controls (Task Board), ticket approval step buttons (RFP / IRS / FTR / JO), and travel-order Approve. Before the first load resolves the UI stays permissive (fail-open); APIs remain the enforcement point, and a revoke takes effect in the UI on the next load.

**Role provisioning.** Fail-closed checks mean an account with no role is denied.
Every path that creates an account or changes the legacy label now sets `role_id`
via `src/modules/platform/rbac/rbac-role-sync.ts`: signup, SuperAdmin staff create, OAuth/HRIS
`syncPortalProfile`, `set-username`, Workforce / Org Chart role routes, and the
org-chart head reconcile. Automatic changes never overwrite an active **custom**
role; explicit Super Admin role routes do.

**Disabled accounts.** `INACTIVE`, `SUSPENDED`, and `DELETED` accounts cannot sign
in (main-DB credentials or Google) and their sessions expire on the next refresh.

## Phase D — one database for identity

- **Auth DB removed from runtime.** `syncPortalProfile` / Google sign-in no longer write `auth_users` / `auth_companies` / `auth_accounts`; `auth_role_mappings` overrides were all defaults and now come from code (`DEFAULT_HRIS_ROLE_MAPPINGS`). `prismaAuth` is lazy and deprecated (legacy scripts only).
- **Merged DB removed from identity.** Roster (`hris-staff-roster`), Workforce list (`personnel-accounts-data`), org chart, and the Workforce role / company / color and Org Chart role routes read `hris_users` and write only the main DB — nothing is written back to `merged_users`.
- **Company precedence.** The roster and Workforce list prefer the app-assigned company (`portal_accounts.staff_designated_company_id`) and fall back to the HRIS company, so User Management / Workforce company changes take effect everywhere (157 of 158 linked users already matched).
- **Runtime merged login removed** (`credentials-source.ts`, `ensure-portal-from-merged.ts`, `scripts/test-*login*.ts`, `scripts/adopt-merged-credentials.ts` / `db:adopt:merged-credentials`).
- **`sync-hris-portal` job** keeps the HRIS → merged ETL, attendance, and password refresh into the dump, then runs the batch import instead of per-user profile sync.
- **`sync-portal-merged` job** no longer touches the Auth DB, never overwrites HRIS rows, and never copies password hashes. It only registers portal-only accounts (`portal_ticketing`, ids ≥ 9e9 — skipped by the import) so task / efficiency data can be attributed.
- **Degrades without the merged DB.** `/api/agents` lists staff as offline and Workforce renders without Activity data when attendance is unreachable.
- **UI:** Personnel → Employee in role labels, selects, the Workforce registry, the Assignment board grouping, and the Insights tab.

## Not done yet (by design)

- Guest / Customer redesign — the Customer staff paths stay until Guest is defined.
- Attendance, task activities, and efficiency still live in the merged DB (non-identity data).
- Collapsing legacy role-name gates (`requireRole`) into permissions. They remain the coarse first gate.
- HighAdmin users (now Admin) lose `users.assign` on `PATCH /api/admin/roles`; role assignment is Super Admin only unless a custom role grants it.
- `prisma/db-auth` schema and legacy Auth-DB scripts (`db:migrate:portal-to-auth`, `db:seed:auth-role-mappings`, `merge-legacy-conflict-portals`) remain for historical data; they can be deleted once the Auth DB is decommissioned.
