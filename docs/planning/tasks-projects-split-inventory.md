# Tasks vs Projects Split — Step 1 Inventory

Date: 2026-10-19
Status: Research complete (read-only recon; no code changes)
Scope: Prepare the operational-tasks vs projects split: separate `projects` tables + `projects.*` RBAC, Work area with Tasks/Projects tabs, JO linkage removal, strangler migration.

## 1. Headline findings

1. **There is no `projects` table and no DB discriminator.** Project-ness lives in four overlapping runtime signals inside the single `kpi_maintenance` table: the pillar title `"IT PROJECT IMPLEMENTATION"`, `subKpis.isProject === true`, `subKpis.kind === "it_project"` (phased timeline envelope), and two sparse columns `itProjectName` / `itProjectPhase`.
2. **Phases already exist — as JSON.** `src/modules/tasks/it-project-subkpis.ts` models `phases: [{ id, name, dueDate, assignedAgentId, items[] }]` inside `subKpis`, with phase delay detection, phase-delay alerts/notifications, `ProjectTimelineKanban` rendering, and delay penalties reading phase dates. The future `projects` / `project_phases` tables should absorb this model.
3. **Local DB has zero projects of any definition** (34 `kpi_maintenance` rows; 0 envelope-`isProject`, 0 `it_project` envelopes, 0 pillar-title rows, 0 JO-linked rows, 0 `itProjectName` values). `TaskItem` / `task_items` + `/api/task-management` is dead legacy (0 rows, no UI importers).
4. **No auto-create JO→project flow exists.** JO coupling is entirely operator-driven: ticket panel → `/agent/tasks?fromJobOrder=` → creation console forced to Project mode → `POST /api/kpi-maintenance` with `linkedJobOrderTicketId` → auto-link back through the ticket column and envelope.
5. **JO coupling also drives visibility + KPI credit.** JO execution members see the linked project on the Task Board (`kpiIdsWhereAgentIsJobOrderWorker`), and dashboard "my tasks", lane counts, and efficiency breakdown join `tickets.linked_kpi_maintenance_id`. Removing the linkage requires a credit policy decision (see §7).
6. **The board is one route.** `/agent/tasks` renders 3 lanes (CURRENT/DONE/DELAYED) with sections including PROJECTS; `?category=project` already filters. Project detail is the shared task modal (`?task=<id>`); there is no dedicated project route. `timeline-calendar-view.tsx` / `kpi-timeline-calendar.tsx` exist but are orphaned (no importers).

## 2. Current project detection signals

| Signal | Definition | Location |
|---|---|---|
| IT pillar title | `title === "IT PROJECT IMPLEMENTATION"` | `src/modules/tasks/it-task-pillar-titles.ts:12,20` |
| Project envelope flag | `subKpis.isProject === true` (`markProjectTask` / `isProjectTask`) | `src/modules/tasks/kpi-subkpis.ts:802-818` |
| Timeline envelope | `subKpis.kind === "it_project"` (`isItProjectEnvelope`, `usesProjectTimelineTracker`, `isTimelineProjectKpi`) | `src/modules/tasks/it-project-subkpis.ts:162-164,485-496` |
| Sparse columns | `itProjectName`, `itProjectPhase` (active phase only) | `prisma/db-primary/schema.prisma:610-659` |
| JO-request pillar | `title === "JOB ORDER REQUEST"` (JO-created projects) | `src/modules/tasks/it-task-pillar-titles.ts:14-26` |

Aggregate "project-like" checks appear at ~150 call sites across `kpi-kanban-flow.tsx`, `kpi-maintenance/route.ts`, `kpi-cycle-state.ts`, `kpi-period-snapshots.ts`, `task-metrics-task-type.ts`, `task-board-lane-counts.ts`, `task-delay-penalty.ts`, `dashboard-home.ts`, `global-search-server.ts`, `user-efficiency-breakdown.ts`, and more (full lists in the recon reports; key anchors below).

## 3. DB evidence (local, read-only)

- Primary `ticketing_system`: `kpi_maintenance` total **34** rows — 22 DAILY recurring, 10 MONTHLY recurring, 2 MONTHLY non-recurring (both Field Assignment "CAMERA INSTALLATION…", `isFieldAssignment: true`, no phases). Project-like union = **0**. `it_project` envelopes = **0**. `linkedJobOrderTicketId` present = **0**. `_JobOrderProject` relation table does not exist in this DB (never exercised).
- Secondary `mergeddatabase-dev`: `MergedKpiMaintenance` 32 rows, project-like = **0**.
- No production DB access from this environment: production classification + migration must run with an exceptions queue rather than assuming sample data.

## 4. JO → task/project coupling inventory

### 4a. Removal candidates

| Area | Files / lines |
|---|---|
| Ticket panel + pending-request UI | `src/components/tickets/JobOrderProjectLinkPanel.tsx` (whole file); `JobOrderPostApprovalNav.tsx:23-27,78-93` task-board button; `workspace.tsx:2502-2513,3375-3385`; copy in `JobOrderWorkersPanel.tsx:236`; `src/modules/requests/job-order-section-ids.ts:2,6,9,31` |
| Create-from-JO flow | `src/app/agent/tasks/page.tsx:33,48,173`; `src/app/agent/kpi-kanban-flow.tsx:517,534,599-600,988-996,5893-5901`; `src/components/KpiDefinitionConsole.tsx:69-91,133-189,219-232,352-398,462-475,643-656,1103-1105` |
| Server link services | `src/modules/requests/job-order-project.ts`, `job-order-project-request.ts`, `job-order-project-request-server.ts`; `src/app/api/tickets/[id]/job-order-project/route.ts`; PATCH actions `src/app/api/tickets/[id]/route.ts:708-769`; `job-order-execution-service.ts:609-890` |
| Create API path | `src/app/api/kpi-maintenance/route.ts:760-804` (GET `linkedJobOrders` enrichment), `1151-1219` (JO link on POST), `1357-1374` (`attachCreatedProjectToJobOrder`), `1376-1395` audit copy |
| Persisted link | `prisma/db-primary/schema.prisma:491-493,504` (`Ticket.linkedKpiMaintenanceId`, index), `:650` (`KpiMaintenance.linkedJobOrderTickets`); envelope keys in `src/modules/tasks/kpi-subkpis.ts:611-614,656-663,692-701,709-715,916-940` |
| Credit / visibility joins | `src/modules/requests/job-order-workers-server.ts:10-27`; `job-order-workers.ts:9-43`; `src/lib/dashboard-home.ts:218-256`; `src/modules/tasks/task-board-lane-counts.ts:131-138`; `src/modules/tasks/efficiency/user-efficiency-breakdown.ts:600-681` |
| Board display of link | `src/app/agent/kpi-kanban-flow.tsx:4874-4890,5628-5633` ("Linked J.O." / "J.O. #…") |
| Reserved pillar handling | `src/modules/tasks/it-task-pillar-titles.ts:14-26`; `kpi-period-snapshots.ts:718-726,798-817`; `TaskPillarMetricsGrid.tsx:55,71,805-810` |
| Tests to adjust/remove | `tests/lib/job-order-project-link.test.ts`, `tests/lib/job-order-project-request.test.ts`, JO parts of `tests/lib/project-timeline-tracker.test.ts:69-92`, `tests/lib/phase-target-preserve.test.ts:36-46` |

Note: `seedJoLinkedProjectTimeline` (`it-project-subkpis.ts:503+`) also serves the non-JO project create path (`kpi-maintenance/route.ts:1214-1219`) — keep the generic timeline seeding, remove only the JO argument wiring.

### 4b. Keep (must not break)

- JO as a request type: intake, parse/validate (`job-order.ts`), manual-assignment JO handling, global search "Create Job Order".
- JO approval workflow (`job-order-approval*.ts`, stepper, skip-approval flags, pending approvals queue).
- JO execution team / assistance / Job Done / attachments (`job-order-execution-service.ts:68-607`, workers panels, `job-order-attachments.ts`).
- Request-board visibility of JO execution/assistance members.
- **Travel Orders / Work Plans** (`Ticket.linkedTravelOrderId`, `TravelOrder.kpiMaintenanceId`, `travel-order-rfp.ts`): separate task→work-plan→RFP lifecycle; out of scope for JO decoupling.
- Generic task/project creation (`KpiDefinitionConsole` non-JO mode, `/agent/tasks`).
- `isJobOrderExecutionWorkspaceOpen` stays for JO execution/attachments; only its task-board gating use is removed.

## 5. Board / routes / nav / RBAC / dashboard surface

- **Routes:** `/agent/tasks` (`src/app/agent/tasks/page.tsx`) is the only task surface; `?board=kpi` redirects to it (`src/app/agent/page.tsx:182`). URL params: `task`, `fromJobOrder`, `q`, `category`, `frequency`, `company`, `department`.
- **Board internals:** `src/app/agent/kpi-kanban-flow.tsx` (6309 lines) — 3 lanes (`task-completion-verification.ts:15`), `PENDING_VERIFICATION` folded into CURRENT, drag → `PATCH /api/kpi-maintenance { id, markAllDone }`; ~26 PATCH branches drive sub-tasks/schedule/verification/phase edits. Grouped by `boardLayoutSectionKey` incl. PROJECTS (`kpi-kanban-flow.tsx:313-375`).
- **Nav (two sources of truth):** `src/components/GlobalSidebar.tsx:54,79,98` and `src/lib/staff-navigation.ts:51`; active-link special-casing `src/lib/nav-link-active.ts:28-33`; breadcrumbs `src/lib/breadcrumbs.ts:42,83-84`.
- **Module gating:** `src/modules/platform/settings/system-modules.ts` — `SYSTEM_MODULE_IDS = ["requests","tasks","work_plans"]`, `MODULE_PATHS.tasks = ["/agent/tasks"]` exact match; a new `/work/projects` route needs module wiring.
- **RBAC:** `permission-catalog.ts` resources `requests, tasks, work_plans, hierarchy, users, companies, settings, reports, rbac`; `tasks.*` = create/read/update/delete(reserved)/assign/verify/submit; grants in `rbac-seed.ts` (employee: read/update/submit/verify; admin adds create/assign). RolesPanel groups by resource automatically. Note: board capability flags mostly come from `resolveOpsPermissions` (`src/lib/ops-permissions.ts`), not `tasks.*` keys.
- **Dashboard links:** `dashboard-home.ts:295,565-578` → `/agent/tasks?task=<id>`; `sidebar-summary` route feeds `SidebarOpsWidget.tsx` / `PersonalizedStaffDashboard.tsx`; global search deep-links `/agent/tasks`.
- **Tabs precedent:** `OrchestrationQueueNav.tsx` (tabs on `/agent`), `BoardTableToggle`. No shared staff tab shell exists.
- **Settings host:** `SystemSettingsPanel.tsx` with `TaskVerificationPanel` + `TaskSchedulePanel`; `superadmin-settings-tabs.ts` has no per-module tab (settings live under `system`).

## 6. Migration candidates (production cutover)

Classify `kpi_maintenance` rows by explicit rules:

1. `itProjectName` not null → project.
2. `subKpis.kind === "it_project"` → project (with phases).
3. `subKpis.isProject === true` → project (phases synthesized from flat checklist if needed).
4. `isItProjectImplementationPillar(title)` → project (legacy).
5. `isJobOrderRequestPillar(title)` or envelope `linkedJobOrderTicketId` → project (legacy JO-created).
6. Everything else → operational task.

Ambiguous/conflicting rows (e.g., `isProject` envelope with no phases, mixed pillar + recurring fields) go to an **exceptions queue** (format per §7 decision). Hybrid anomalies (project + `isRecurring`) must be forced non-recurring or exceptioned.

## 7. Decisions (settled 2026-10-19)

| # | Decision | Choice |
|---|---|---|
| 1 | Projects board status columns | **Pending / On Going / Finalizing / Done** |
| 2 | JO KPI credit / visibility policy after decoupling | **Execution-team credit only** — remove project-link joins (visibility, dashboard my-tasks, lane counts, efficiency) |
| 3 | Phase model v1 | **Phases → subtasks, single level** (no milestones yet) |
| 4 | Exceptions queue format | **Dry-run CSV report only** — no admin UI |
| 5 | Verification policy for projects | **Tasks only** — projects close without verification |

Derived requirements:

- `ProjectStatus` enum: `PENDING | ON_GOING | FINALIZING | DONE`.
- No verification/permission seats on projects; `projects.*` skips `verify`/`submit` semantics beyond plain read/update.
- Migration exceptions (hybrid/ambiguous rows) exported as CSV for manual review; no UI.
- JO origin kept at most as a trace-only reference field; no lifecycle sync, no credit joins.

## 8. Step 2 — done & applied (2026-10-19)

Delivered:

1. **Schema** — `prisma/db-primary/schema.prisma`:
   - Enums `ProjectStatus` (`PENDING | ON_GOING | FINALIZING | DONE`) and `ProjectPriority` (`HIGH | MEDIUM | LOW`).
   - Models `Project`, `ProjectPhase`, `ProjectItem` (phases → items, single level), company scope via `scopedCompanyTeamId`, lead/phase/item assignees, date-only due dates, `activePhaseId` pointer, trace-only `originJobOrderTicketId`, cutover trace `legacyKpiMaintenanceId` (unique), `migratedMeta` carry-over on items.
   - Agent back-relations `ProjectLead`, `ProjectPhaseAssignee`, `ProjectItemAssignee`.
2. **Migration applied** — `prisma/db-primary/migrations/20261019130000_projects_module/migration.sql` ran via `prisma migrate deploy`; tables created (0 rows).
3. **RBAC seeded** — `projects` resource + `projects.create|read|update|delete|assign`; verified grants: Employee `read`/`update`, Admin `read`/`update`/`create`/`assign`, Super Admin all. No `verify`/`submit` keys (projects have no verification).
4. **Checks** — `prisma validate` clean, client regenerated, `tsc --noEmit` clean, eslint clean, `npm test` 91 files / 515 tests pass.

## 9. Step 3 — classification dry run (built 2026-10-19)

- Pure rules: `src/modules/projects/project-migration-classify.ts` (signals: `it_project_envelope`, `is_project_flag`, `linked_job_order`, `it_project_name`, `it_pillar_title`, `jo_request_pillar`, `field_assignment`).
  - Project signals + recurring → **EXCEPTION** (hybrid).
  - `isProject` flag without timeline envelope → **EXCEPTION** (phases must be synthesized).
  - Field assignment mixed with project signals → **EXCEPTION**.
  - Field assignments and signal-free rows → **TASK**; remaining signal rows → **PROJECT**.
- Dry-run report script (read-only): `scripts/projects-migration-classify.ts` → CSV (`scripts/projects-migration-dry-run.csv`, `--out=` overridable).
- Local result: 34 rows → 34 TASK / 0 PROJECT / 0 EXCEPTION (matches DB evidence: no projects in this environment).
- Tests: `tests/lib/project-migration-classify.test.ts` (10 cases) covering every signal and exception rule.
- Production runbook (later): run the dry run against prod, review the CSV exceptions, then build/run the apply script (inserts into `projects`/`project_phases`/`project_items` keyed by `legacyKpiMaintenanceId`, then retires the source rows per the cutover plan).

## 10. Next — step 4

`/work/tasks` & `/work/projects` routes with tabs, dashboard/search links to the specific tab, module gating for the new path, and the separate `ProjectStatusBoard` (shared primitives only).
