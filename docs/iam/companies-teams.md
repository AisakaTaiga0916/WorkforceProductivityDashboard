# Companies, multi-company access, Teams, Workforce

Companies are the **access boundary**. Teams are **org structure inside a company**.
User Management (Settings) is IAM; Workforce is operations.

```text
Company (teams table, Prisma `Company`)
  └── Teams (org_chart_sections, Prisma `OrgChartSection`) — nest via parentId
        └── People (org_chart_node_section_memberships; reports-to on org_chart_nodes)
User (portal_accounts) ── user_companies (many, one default) + one role
```

## Data model

| Concept | Table (Prisma model) | Notes |
|---|---|---|
| Company | `teams` (`Company`) | `name`, `code` (unique), `is_active`, `sort_order`, `aliases` (HRIS / CSV labels), logo columns. Physical table name kept for history. |
| Company access | `user_companies` (`UserCompany`) | PK `(portal_account_id, company_id)`, `is_default`. `portal_accounts.staff_designated_company_id` mirrors the default row for legacy readers — write it only through `src/modules/platform/companies/company-membership.ts`. |
| Team | `org_chart_sections` (`OrgChartSection`) | Exactly one owning company (`company_team_id`, required by the API), `parent_id`, `sort_order`, `is_active`. A team's parent may belong to another company (the chart is group-wide). |
| Team membership | `org_chart_node_section_memberships` | **Single source of truth** for who is in a team. `org_chart_nodes.section_id` is a primary-team mirror kept in sync by the org-chart APIs. |
| Department (legacy) | `departments` (`Department`) | Deprecated HRIS snapshot (logo sync only). Not read by the app; not a product concept. |

Migrations (`prisma/db-primary/migrations`):

1. `20261018120000_companies_as_data` — columns, seeds the former hardcoded roster (order, codes, aliases), archives non-roster rows, adds `companies.*` permissions.
2. `20261018130000_user_company_memberships` — `user_companies`; backfill per staff user: default = HRIS company (by name/alias) → designated company → agent roster company; the designated company is kept as an extra membership when it differs.
3. `20261018140000_teams_under_company` — `is_active`; assigns each team its members' majority default company (ties → parent's company), else inherits the parent's.

## Access rules

- `canAccessCompany(user, companyId) = isSuperAdmin || membership` — `src/modules/platform/scope/company-access-core.ts`.
- Super Admin (elevated roles) is global: every active company plus **All companies**.
- **Current company**: the shell switcher (sidebar → Company) stores the choice in the `wpd_company` cookie, bound to the account and validated against memberships on every request. Sign-in clears it, so login opens the **default** company.
- Server helpers (`src/modules/platform/scope/company-access.ts`): `getCompanyAccess(session)`, `resolveViewerCompanyId(session)`, `resolveViewerCompanyFilter(session, requested)`, `viewerCanAccessCompany(session, id)`.
- A *person's* company (assignee, requestor) is their default membership: `resolveStaffCompanyTeamId(email)`; all of them: `resolveStaffCompanyIds(email)` / `resolveAgentCompanyIds(agentId)`.
- Teams never grant company access. Team routing (a request sent to your team) is a workflow seat, like an approval step.

## Surfaces

| Surface | Scope |
|---|---|
| Group Board, Task Board, Insights, sidebar counts, global search, manual assignment | Current company (Super Admin: URL filter, else current company, else all). |
| Request Board | Your team tree (routing) + company-only queue of the current company + personal/procedural. |
| Ticket / task detail access | Any company you belong to. |
| Assignee pickers | People who share the company (any membership). |
| Approver checks (RFP / IRS / FTR) | Approver shares a company with the request. |
| Work plans | Created in the current company. |
| Reports | Company = the person's default membership. |
| Team filters | Only teams of the selected company. |

Settings → **Companies**: create, rename, code, aliases, reorder, archive / restore (`companies.read|create|update|archive`; Super Admin by default). There is no delete; archive keeps history.

Settings → **User Management**: role, company access (multi-select) + default, active. Only a Super Admin can change company access. Admins see users who share one of their companies.

**Workforce** (Activity, Org. Chart): live on-duty roster and org chart for the current company, teams (create / nest / head / members / archive), assignment colors. It does **not** change roles or company access — the legacy routes `admin/personnel/role`, `admin/personnel/company`, `admin/org-chart/portal-role`, `admin/roles`, `admin/accounts/:id` were removed, and team-head changes no longer promote/demote portal roles (run `scripts/reconcile-org-chart-staff-roles.ts` manually if you still want that sync).

## Validation matrix

| Case | Expected | Where enforced / tested |
|---|---|---|
| User in companies A, B | Switcher shows A & B | `getCompanyAccess`; `company-access-core.test.ts` |
| Default B | Login opens B | Sign-in clears `wpd_company`; `pickCurrentCompanyId` tests |
| Employee only A | No B data | `canAccessCompany`, board/API filters; `company-access-core.test.ts`, `ticket-staff-access.test.ts` |
| Team under A | Visible only in company A context | `scopeOrgChartToCompany`, `filterOrgChartSectionsByCompanyTeam`; `org-chart-company-scope.test.ts` |
| User Management | Sets role + companies only | `PATCH /api/admin/iam/users/:id` |
| Workforce | Edits teams / chart / roster; cannot change roles | IAM routes removed; org-chart APIs no longer reconcile roles |
| Archive company | Out of switcher; history retained | `is_active=false`; directory filters active; rows never deleted |
| Super Admin | All companies; manages Companies + Users + Roles | `global` access; `companies.*` granted only to Super Admin (`rbac-seed.test.ts`) |
