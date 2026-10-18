# Legacy Role Inventory — Workforce Productivity Dashboard

> **Superseded in part.** RBAC now lives on the main database, not the Auth DB, and v1
> ships only Super Admin / Admin / Employee (HighAdmin → Admin, Personnel → Employee).
> See [`single-db-auth.md`](./single-db-auth.md). The audit of existing checks below is still accurate.

Phase 0 deliverable for the IAM / RBAC migration.
Read-only audit. **No authorization behavior was changed while producing this document.**

Scope of this document:

- What authorization exists today (files, routes, helpers).
- Global vs company-scoped vs workflow/seat authorization.
- Proposed permission keys and migration risk per check.

The migration target separates three independent layers:

1. **Role permissions** — *what* a user may do (`requests.approve`, `tasks.verify`, …).
2. **Company scope** — *where* they may do it (company / org-chart section).
3. **Workflow / seat eligibility** — *whether* they are the authorized person for a specific approval.

These must remain separate checks. This document records the current state; the Phase 1 target is defined by the permission catalog in `src/modules/platform/rbac/permission-catalog.ts`.

---

## 1. Identity, session, and database layout

| Concern | Implementation | File |
|---|---|---|
| Auth provider | NextAuth v4, JWT strategy | `src/modules/platform/auth/index.ts` (`authOptions`) |
| Session read | `safeGetServerSession()` wrapper | `src/lib/server-session.ts` |
| Session types | `role`, `companyId`, `customerOrgRole`, `staffRoleLabel`, `username` | `src/types/next-auth.d.ts` |
| Canonical identity DB | **Auth DB** (Postgres) — `auth_users.portal_role`, `company_id`, `head_privileges` | `prisma/db-auth/schema.prisma` |
| Operational DB | **Primary DB** (Postgres) — `portal_accounts` is a synced profile cache keyed by `auth_user_id` | `prisma/db-primary/schema.prisma` |
| HRIS read model | **Secondary DB** (MySQL) — `merged_users` | `prisma/db-secondary/schema.prisma` |
| Prisma clients | `prismaPrimary` / `prismaSecondary` / `prismaAuth` | `src/modules/platform/db/prisma.ts` |

The Auth DB is the source of truth for identity and role (`User.portalRole`, `User.companyId`, `User.headPrivileges`). **RBAC tables (Phase 1) belong in the Auth DB** so that a user's single primary role sits next to the canonical identity, and no cross-DB foreign key is required.

---

## 2. Legacy role vocabulary

Defined in `src/lib/staff-role.ts` and `src/modules/platform/auth/index.ts`:

`SuperAdmin · HighAdmin · Admin · Personnel · Personnel-Guard · Customer`

Normalization (`normalizePortalRole` / `normalizeRole`) maps legacy DB strings (`head`, `it support`, `agent`, `super_admin`, …) onto these six values.

| Legacy role | Intended meaning today | Scope |
|---|---|---|
| `SuperAdmin` | Full platform access; **not** selectable as an approver/assignee | Global |
| `HighAdmin` | Same platform access as SuperAdmin **except** SuperAdmin Settings; **is** selectable as approver | Global |
| `Admin` | Company-scoped coordinator (assignment board, within-company KPI/task mgmt) | Company |
| `Personnel` | Standard employee; assignee; can be an approval seat holder | Company / dept |
| `Personnel-Guard` | Gate-pass kiosk: travel-orders Start/End capture only | Company |
| `Customer` | Requestor portal (own tickets); separate security path | Own records |

> `Admin` and `HighAdmin` are **not** interchangeable: `Admin` is company-scoped, `HighAdmin` is global. Do not map them to the same role.

### Elevated-role helpers (centralized)

| Helper | Semantics | File |
|---|---|---|
| `isElevatedPlatformRole` | `SuperAdmin | HighAdmin` (global) | `src/lib/staff-role.ts:103` |
| `isPlatformSuperAdminPortalRole` | Strict `SuperAdmin` only | `src/lib/staff-role.ts:85` |
| `isHighAdminPortalRole` | Strict `HighAdmin` | `src/lib/staff-role.ts:90` |
| `isAdminPortalRole` | Strict `Admin` (company coordinator) | `src/lib/staff-role.ts:109` |
| `isStaffPortalRole` | `HighAdmin | Admin | Personnel` | `src/lib/staff-role.ts:79` |
| `isPersonnelGuardPortalRole` | `Personnel-Guard` | `src/lib/staff-role.ts:95` |
| `isElevatedUserRole` | `SuperAdmin | HighAdmin` (session variant) | `src/modules/platform/auth/index.ts:35` |
| `hasRole` | Allow-list match; **HighAdmin/SuperAdmin satisfy `Admin` gates** | `src/lib/access.ts:9` |
| `requireRole` | Session + allow-list guard; 401/403 | `src/lib/access.ts:27` |
| `requireSession` | Session-only guard | `src/lib/access.ts:5` |
| `resolveOpsPermissions` | `{ operator, isAdminRole, isCompanyAdminRole, canAssignWork }` | `src/lib/ops-permissions.ts:5` |
| `portalCompanyAdminPrivilegesForEmail` | Async company-admin privilege lookup | `src/lib/portal-staff.ts` |
| `canManageAllCompanies` / `canCoordinateCompany` | Platform vs company-coordinator | `src/modules/platform/auth/portal-permissions.ts:22,27` |

Env-based elevation: `ADMIN_EMAILS` → `SuperAdmin`, `AGENT_EMAILS` → `Personnel` (`src/modules/platform/auth/index.ts:73-91`).

`headPrivileges` (Boolean on `PortalAccount`/`User`) is a legacy company-coordinator flag that mirrors `Admin` and is honored in `canCoordinateCompany`, `resolveOpsPermissions`, and `adminOutsideCompanyScope`.

---

## 3. Role checks by location

### 3.1 Centralized helpers
Listed in §2. These are the only modules that should compare role **names**; UI and routes should migrate to permission checks.

### 3.2 Page / middleware gates
`src/proxy.ts` gates by JWT role:

| Path prefix | Rule |
|---|---|
| `/agent`, `/insights`, `/admin`, `/reports`, `/travel-orders`, `/my-requests` | Exclude `Customer` |
| `/customer/*` | Require `Customer` |
| `/admin/account` | Allow `Customer` (self-service) |
| `/tickets/*`, `/my-tickets` | Session-expiry only (pages gate internally) |

### 3.3 API route guards (patterns)

- **`requireRole([...])` allow-list** (most routes): ticket/task/KPI/admin endpoints. See §3.4.
- **`requireSession()` + inline role switch**: `src/app/api/tickets/route.ts`, `.../tickets/[id]/route.ts` (the ticket action hub), `request-board/columns`, `ticket-chat-access`, `patch-notes`, `customer/notifications`, `me/*`.
- **`safeGetServerSession()` self-service**: `me/account-details`, `me/profile-image`, `me/security/*` (session email must match target).
- **Internal job key**: `/api/jobs/*` (`x-internal-job-key` == `INTERNAL_JOB_KEY`).
- **Signed email token**: `GET /api/tickets/email-verification` (no session).

Notable route → role matrix:

| Route | Methods | Allowed roles | Scope |
|---|---|---|---|
| `admin/roles` | GET | SuperAdmin | Global (registry) |
| `admin/roles` | PATCH | SuperAdmin, HighAdmin, Admin | Assigning SuperAdmin/HighAdmin requires SuperAdmin; Admin limited to own-company color |
| `admin/roles` | POST, `admin/portal-accounts/[id]` DELETE | SuperAdmin | Global |
| `admin/access-controls` | GET/PUT/POST | SuperAdmin | Global (config **stored, not enforced**) |
| `admin/org-chart`, `admin/org-chart-sections`, `admin/org-chart-either-or`, `admin/org-chart/portal-role` | all | SuperAdmin | Global |
| `admin/faq`, `admin/triggers`, `admin/intake-request-types` | write | SuperAdmin | Global |
| `admin/task-verification-settings` | GET staff / PUT SuperAdmin | — | Global |
| `admin/positions` | GET Admin / write SuperAdmin | — | Global |
| `admin/department-metrics-visibility`, `workforce-view-visibility` | GET Admin / PUT SuperAdmin | — | Global |
| `admin/manual-assignment` | POST | Elevated or Admin | Company/dept |
| `admin/personnel/role`, `admin/personnel/company` | PATCH | SuperAdmin | Global |
| `task-management` | GET/POST/PATCH | Admin, Personnel (create/lifecycle gated by `canAssignWork`) | Company/dept |
| `kpi-maintenance` | GET/POST/PATCH | Admin, Personnel (create by `canAssignWork`) | Company |
| `kpi-maintenance/[id]/subtasks` | POST/PUT/DELETE | Admin (`perms.isAdminRole`) | Task |
| `travel-orders` | GET | SuperAdmin, HighAdmin, Admin, Personnel, Personnel-Guard | Company/agent |
| `travel-orders/pending-approvals|confirmations` | GET | Admin, Personnel | Agent |
| `tickets` | GET/POST | Any session; scoped per role | Scoped |
| `tickets/[id]` | GET/PATCH | Any session; ownership/company/seat gates | Scoped |
| `agents`, `teams`, `search`, `notifications`, `dashboard/*` | GET/POST | staff | Company |
| `sla/sweep` | POST | Admin | Global |
| `public/*`, `faq` (GET), `brand/logo`, `time/philippines`, `dev/boot-id` | GET | **Public** | — |
| `auth/signup`, `auth/password-reset-request` | POST | **Public** (rate-limited) | — |

### 3.4 Company-scope helpers (separate from role)

| Helper | Purpose | File |
|---|---|---|
| `adminOutsideCompanyScope` | Block Admin outside their company/dept | `src/modules/requests/ticket-staff-access.ts:232` |
| `personnelForbiddenForTicket` | Block Personnel outside their section scope | `src/modules/requests/ticket-staff-access.ts:311` |
| `isCurrentProceduralStepAssignee` | Prior procedural-seat access | `src/modules/requests/ticket-staff-access.ts:121` |
| `resolveStaffCompanyTeamId` / `resolveAgentDesignatedCompanyId` | Company resolution | `src/modules/platform/scope/staff-company-scope.ts:215,175` |
| `isViewerOrgChartHeadForSection`, `ticketInViewerSectionScope` | Org-chart section scope | `src/modules/platform/scope/org-chart-section-scope.ts:476,573` |
| `assertAgentCompany` (RFP/FTR/IRS/JO intake) | Approver ∈ company | `src/app/api/tickets/route.ts:1556` |

> The capability matrix in `src/lib/access-controls.ts` (roles × navigation/ticket/task/travel capabilities) is **persisted but not enforced**. It is a useful design reference for the permission catalog but is not currently a security boundary.

---

## 4. Approval / verification entry points

### 4.1 Request (ticket) procedural approvals — RFP / IRS / FTR / JO

- **State hub:** `PATCH /api/tickets/[id]` action switch (`src/app/api/tickets/[id]/route.ts:344`).
- **Seat storage:** per-ticket JSON (`payment_approval_meta`, `item_requisition_approval_meta`, `fund_transfer_approval_meta`, `job_order_approval_meta`).
- **Seat resolution:** position catalog + `resolveAgentIdForPositionCode` (`src/modules/hierarchy/approval-position-resolver.ts:54`), plus intake recommendations (`src/modules/requests/intake-approval-recommendations.ts:830`).
- **Decisive allow/deny (seat equality, not role):**

| Workflow | Function | File:line |
|---|---|---|
| RFP complete step | `canCompletePaymentApprovalStep` | `src/modules/requests/request-for-payment-approval.ts:366` |
| RFP Approved ack | `canMarkPaymentStepApproved` | `src/modules/requests/request-for-payment-approval.ts:416` |
| IRS complete step | `canCompleteItemRequisitionApprovalStep` | `src/modules/requests/item-requisition-approval.ts:123` |
| FTR complete step | `canCompleteFundTransferApprovalStep` | `src/modules/requests/fund-transfer-approval.ts:131` |
| JO complete step | `canCompleteJobOrderApprovalStep` | `src/modules/requests/job-order-approval.ts:307` |

- **Role used today:** only the coarse route pre-gate (`isAdminOrAgent` = `SuperAdmin|HighAdmin|Admin|Personnel`). The actual decision is **seat/assignee equality**.
- **Proposed permission:** `requests.approve` (workflow eligibility remains the second gate). Submitting to the next seat → `requests.submit`.

### 4.2 Task assignment & completion verification

- **Decisive function:** `canVerifyTaskCompletion` (`src/modules/tasks/task-completion-verification-access.ts:86`).
  - Break-glass: `SuperAdmin | HighAdmin` (`:111`).
  - Explicit `verifierAgentId` match (`:117`).
  - Otherwise **org-chart department head** of the assignee (`isOrgChartHeadForAssignee`, `:50`).
- **State change:** `PATCH /api/kpi-maintenance` (`src/app/api/kpi-maintenance/route.ts:1642`, decision at `:1750`) and `PATCH /api/task-management` (`src/app/api/task-management/route.ts:156`, decision at `:161`).
- **Assignment:** requires `canAssignWork` (`src/lib/ops-permissions.ts`) at create.
- **Proposed permissions:** `tasks.verify` (plus workflow/head eligibility), `tasks.assign`, `tasks.submit` (complete).

### 4.3 Work Plans / Travel Orders (TO)

- **Seat resolution:** org-chart paths — `resolveTravelOrderOrgChartApprovalPath` (`src/modules/work-plans/travel-order-org-chart-path.ts:249`), `resolveWorkPlanOrgChartApprovalPath` (`src/modules/work-plans/work-plan-org-chart-path.ts:345`).
- **Decisive allow/deny:** `canApproveTravelOrderNow` (`src/modules/work-plans/travel-order.ts:1169`), `canConfirmTravelOrderNow` (`:1204`), `canRejectTravelOrderNow` (`:1190`), `canCancelTravelOrderNow` (`:1219`); server enforcement `approveTravelOrderSequential` (`src/modules/work-plans/travel-order-db.ts:1463`).
- **Route:** `PATCH /api/kpi-maintenance/[id]/travel-orders/[travelOrderId]` (`approve`:243, `reject`:274, `cancel`:326, `confirm`:363).
- **Proposed permissions:** `work_plans.create/read/update/assign/approve/submit`. Confirmation and gate-pass are **not** modeled in the v1 catalog (see §6 unresolved).

### 4.4 Hierarchy / reports-to resolution

- The authoritative reporting line is the **org chart**: `OrgChartNode.parentId` + `OrgChartSection.reportsToNodeId`, joined to people via `mergedSourceUserId` (`src/app/admin/superadmin-settings/org-chart-layers.ts:135`).
- `PortalAccount.reportsToPortalAccountId` / `directReports` exists but is **inert** — nothing in approval/verification resolution reads it.
- Org chart is used **as approval policy** for travel orders, work plans, and task verification; for ticket procedural approvals it only drives intake recommendations and position fallback.
- **Proposed permissions:** `hierarchy.read` (view), `hierarchy.update` (edit nodes/sections — currently SuperAdmin-only).

---

## 5. Proposed legacy → permission mapping

| Resource | Permissions (proposed keys) | Legacy equivalent |
|---|---|---|
| requests | `create, read, update, delete, assign, approve, submit` | ticket create/list/detail/assign/status/procedural meta |
| tasks | `create, read, update, delete, assign, verify, submit` | task/KPI CRUD, assignment, completion verification |
| work_plans | `create, read, update, delete, assign, approve, submit` | travel orders / work plan / TO |
| hierarchy | `read, update` | org chart nodes/sections, reports-to |
| users | `create, read, update, delete, assign` | portal-account registry & role assignment |
| settings | `read, update` | platform settings, access controls, triggers, FAQ |
| reports | `read, export` | metrics & insights |
| rbac | `read, create, update, archive, manage_permissions` | role/permission management (new) |

| Existing role | Migration strategy |
|---|---|
| `Personnel` | Map to **Employee** system role (standard grants) |
| `Admin` | Map to **Company Admin** system role (company-scoped grants; no RBAC) |
| `HighAdmin` | Map to distinct **High Admin** system role (global grants, **no** RBAC/settings management) |
| `SuperAdmin` | Map to **Super Admin** system role (all grants; protected) |
| `Personnel-Guard` | Map to restricted **Personnel Guard** system role (read-only travel orders) |
| `Customer` | **No staff role** — legacy path preserved until Phase 4 |

Unmapped users are flagged, not silently elevated (`scripts/seed-rbac.ts`).

---

## 6. Migration risks / unresolved items

1. **Enforcement is not yet permission-based.** Phase 1 adds the catalog/model/helpers; Phase 2 migrates routes. Until then, `access-controls.ts` remains stored-only.
2. **`PortalAccount.reportsToPortalAccountId` is inert.** Approval resolution uses the org chart. No change in Phase 1.
3. **Confirmation & gate-pass** (`Personnel-Guard`) are real operations not representable by the locked action vocabulary (`CRUD + assign/approve/verify/submit`). Left out of the v1 catalog; `Personnel-Guard` maps to `work_plans.read` pending a decision.
4. **`GET /api/admin/roles` returns `passwordHash`.** Sensitive; flag for the later hardening phase (do not replicate in new APIs).
5. **`hasRole` elevates HighAdmin to `Admin`/`SuperAdmin` gates.** New permission checks must use explicit grants, not this helper.
6. **Customer removal is out of scope** (Phase 4). Customer accounts receive `roleId = null`.
7. **Auth DB has no migration history** (managed by `db:push:auth`). The Phase 1 migration is additive; see the migration `README`/report for deploy notes.
