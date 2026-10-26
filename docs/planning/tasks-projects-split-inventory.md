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

## 10. Step 4 — Work area + projects board (done 2026-10-19)

Routes / shell:

- `/work` layout (`src/app/work/layout.tsx`) — staff gate + brand header + `WorkTabs` (Tasks | Projects, hidden per module visibility).
- `/work/tasks` — task board moved from `/agent/tasks` (filter bar + `AgentKpiKanbanFlow`); `/agent/tasks?...` is now a query-preserving redirect to `/work/tasks`.
- `/work/projects` — new `ProjectStatusBoard` (client) with four status lanes, project cards (company/lead/date/progress), create modal, and detail modal (status, target date, phases + items with inline rename/add/remove/due dates).
- `/work` redirects to the first enabled tab (tasks → projects fallback).
- Module gating: new `projects` system module in `system-modules.ts` + SuperAdmin Settings toggle icon; `tasks` maps `["/work/tasks", "/agent/tasks"]`, `projects` maps `["/work/projects"]`.

API:

- `GET /api/projects` (list + create options + `canCreate`), `POST /api/projects` (create + first phase, `activePhaseId` set), `PATCH /api/projects/[id]` (single-action union: `setStatus`, `setDueDate`, `addPhase`, `renamePhase`, `removePhase`, `setPhaseDueDate`, `addItem`, `renameItem`, `setItemStatus`, `setItemDueDate`, `removeItem`).
- RBAC: `projects.read` / `projects.create` / `projects.update` with the same staff-role gate as the task board; company scope = viewer company memberships + lead/phase/item assignment (SuperAdmin/HighAdmin global). Creation defaults to the viewer's first company so Personnel-created projects stay visible to their company. Deleting the last phase is rejected.
- Service/queries: `src/modules/projects/project-service.ts` (viewer scope, DTOs, list/create/action) + `src/modules/projects/project-status.ts` (client-safe statuses/labels).

Nav & links:

- Sidebar "Work" (was "Tasks") + staff nav "Work (Tasks & Projects)"; active-state + breadcrumbs (`Home > Work > Tasks/Projects`).
- All dashboard/search/shortcut/offline deep links moved to `/work/tasks` (dashboard-home, PersonalizedStaffDashboard, SidebarOpsWidget, global search, Travel Orders quick access, service-worker shell, `?board=kpi` redirect).

Verification (2026-10-19): `tsc` clean, eslint clean on new code, 91 files / **516 tests** pass; live smoke — 24 API checks (create/mutate/validate/cleanup) + Puppeteer page checks (tabs, redirects, lanes render) all pass. Dev server restart was needed to pick up the regenerated Prisma client.

Known limits (v1): no drag-and-drop between lanes (status via detail select); assignee pickers on phases/items and project delete are not exposed yet; no audit trail on project edits. Still staged until cutover: the task board continues to show legacy project rows (`category=project`) from `kpi_maintenance` until the production migration runs.

## 11. Step 5 — JO linkage teardown (done 2026-10-19)

Removed:

- UI: `JobOrderProjectLinkPanel`, the "Link Task Board task" button in `JobOrderPostApprovalNav` (and the `task-board` scroll section), `canCreateJobOrderProject` / `canRequestJobOrderProject` / linked-project-assignee props on the ticket workspace. The admin/coordinator gate the workspace still needs is renamed `canManageJobOrderExecution`.
- Create-from-JO: `?fromJobOrder=` on `/work/tasks`, `fromJobOrderTicketId` on the board, and the JO prefill/auto-link in `KpiDefinitionConsole`. The console is now **tasks-only** (no Project type); projects are created in Work → Projects.
- Server: `job-order-project.ts`, `job-order-project-request*.ts`, `GET /api/tickets/[id]/job-order-project`, ticket PATCH actions `link_job_order_project` / `unlink_job_order_project` / `request_job_order_project` / `cancel_job_order_project_request`, and the `linkedJobOrderTicketId` path of `POST /api/kpi-maintenance`.
- Credit / visibility joins (decision #2): `kpiIdsWhereAgentIsJobOrderWorker` (board visibility, dashboard my-tasks, lane counts) and the `linked_kpi_maintenance_id` join in `user-efficiency-breakdown`. JO credit = execution assignee + co-workers (`jobOrderKpiCreditAgentIds`).

Kept (trace only):

- `tickets.linked_kpi_maintenance_id` column and the envelope `linkedJobOrderTicketId` keys — no writers remain; the projects migration classifier still reads the envelope.
- Task board shows a read-only **"Origin J.O. #…"** chip from the envelope (no ticket-table join).
- Historical "Task project requested" activity rows still render via a legacy formatter in `ticket-activity-display.ts`.
- Patch note 0.7.0 in `src/lib/patch-notes-seed.ts` (apply with `npx tsx scripts/ensure-patch-notes.ts`).

Next: drop the `linked_kpi_maintenance_id` column after the production projects cutover, and remove the remaining legacy project rendering from the task board once those rows are migrated.

## 12. Work Plans under Work (done 2026-10-19)

- `/work/work-plans` tab (`WorkPlansWorkspace` in `TravelOrdersQuickAccess.tsx`): every visible plan in full mode (approvals, check-ins), `?plan=<id>` focuses one plan.
- `/travel-orders` is now the Personnel-Guard gate-pass kiosk only; staff are redirected to `/work/work-plans`.
- Needs your action / calendar / global search deep-link work plans to `/work/work-plans?plan=<id>` (not the task board).
- Sidebar "Work" points at `/work` (redirects to the first enabled tab) and stays visible while any of Tasks / Projects / Work Plans is on. No Task Schedule Config or KPI calendar on work plans.

## 13. Reports (done 2026-10-19)

Shared chrome: `src/modules/reports/report-range.ts` (range parse, day/week buckets, median, CSV), `report-scope.ts` (`reports.read` / `reports.export`, global company picker vs shell switcher), `src/components/reports/ReportPrimitives.tsx` (GET filter bar, stat grid, CSS bars, tables).

- **Requests → Reports** `/agent/reports` (Request Board tab + sidebar): created/resolved, open/overdue now, median first response & resolution, created vs resolved trend, volume by type, open by status, aging. Scope = dashboard/Request Board scope (`resolveStaffTicketScope`). CSV: `GET /api/reports/requests/export` (ticket rows; `reports.export` + `requests.read`).
- **Work → Reports** `/work/reports?lens=tasks|projects|work-plans` (Work tab + sidebar), filters company / team / range, separate loaders in `work-reports.ts`, lenses hidden unless module on + `<module>.read`:
  - Tasks: board lanes (same `loadTaskBoardLaneRows` as the sidebar counts), completed vs due & on-time % (one-off targets), overdue aging, load by assignee, most delayed. Legacy project rows excluded.
  - Projects: by status, at risk (`project-metrics.ts`, shared with the dashboard card), delayed phases, created / completed in range (completed = Done + `updatedAt`, no `completedAt` column yet).
  - Work Plans: submitted in range + outcome, pending now by approval level, median submit → final approval (hierarchical levels only).
  - CSV: `GET /api/reports/work/export?lens=…` (`reports.export`).
- Metrics & Reports (`/insights`) is retired (2026-10-20) — see §15.

## 15. Metrics & Reports retired (2026-10-20)

Inventory of the old `/insights` page → new home:

| Old item | Went to |
|---|---|
| Request volume, active, created vs closed trend, queue mix, avg first response / resolution | Requests → Reports (already there: created/resolved/open, throughput, open by status, medians) |
| Closed in range, avg confirmation time | Requests → Reports (Closed, Median confirmation) |
| First-response / resolution SLA compliance, transfer request rate, reopen rate | Requests → Reports stat grid (same basis as the old `computeKpis`) |
| CSAT star distribution + feedback count | Requests → Reports "Customer satisfaction" |
| Top closers | Requests → Reports "Closed by assignee" |
| Personnel / department request filter | Requests → Reports Team + Assignee filters (incl. "Assigned to me") |
| Task KPI pillars (cadence month/year), Employees efficiency, Departments grid (visibility + CSV import) | Work → Reports → Tasks "KPI performance" (`TaskKpiPerformance`, admins only, company/team from the shared filter bar) |
| Projects KPI pillar (legacy `kpi_maintenance` projects) | Dropped — Work → Reports → Projects |
| Task Management tab (`showKpiTasksTab = false`) | Dropped (dead) |

Removed: the old page + `insights-metrics-panes.tsx`, `MetricsFilterBar`, `metrics-filter-url.ts`, `GET /api/kpis` + `computeKpis`, `GET /api/kpis/metric-companies`, the sidebar / staff-nav / dashboard / sidebar-widget Insights links, and the `/insights` proxy gate. Kept: `/api/kpis/task-metrics`, `/api/kpis/department-metrics`, `/api/admin/efficiency`, and the three metrics grids (now hosted by Work → Reports).

Redirects: `/insights` → `/agent/reports`; `/insights?tab=task-metrics|kpi-mgmt` → `/work/reports?lens=tasks`; `/reports` → `/agent/reports`. Permissions are the report homes' own (`reports.read` + module read).

## 16. Report filter strategy (2026-10-20)

One client bar (`src/components/reports/ReportFilterBar.tsx`) on both report homes; the URL is the only state.

- Company: the shell switcher (`wpd_company`) — shown as a "Company: …" readout, no second picker. Super Admin "All companies" = summary counts only (`ReportAllCompaniesNotice`; per-person tables, Team / Assignee, and KPI performance hidden).
- Period: `?range=7d|30d|month|quarter|custom` (default 30d); `from`/`to` only for Custom (`parseReportRange`).
- Requests → Reports: Team, Type, Status (status options grouped by board label). Work → Reports: lens chips + Team; Assignee on the Tasks lens only. Switching lenses keeps range + team.
- Team picker lists the current company's teams and hides when there are none (or on All companies).
- Mobile: Period stays visible; Team/Type/Status/Assignee sit behind one "Filters" toggle.
- `report-query-memory.ts`: each report's last query is kept for the session; Work → Reports tab and the Request Board Reports tab reopen with it.
- Tasks footnote: board lanes/delays use working days (company schedule); target dates in range are calendar days.

Not done (v1): searchable team select / "My team" shortcut; Needs-your-action chips already exist on the dashboard.

## 14. Validation (2026-10-19)

`tsc` clean, new files eslint clean, 92 files / 525 tests pass. `node scripts/verify-work-split-reports.mjs` (dev server on :3000) — 21/21 PASS: Work redirects + tabs, staff `/travel-orders` → Work Plans, both report homes and all lenses for SuperAdmin and Personnel, CSV exports 200 for SuperAdmin / 403 for Personnel, removed JO project route 404, `?fromJobOrder` ignored. Task lens board counts match the sidebar (30 / 0 / 4 locally).
