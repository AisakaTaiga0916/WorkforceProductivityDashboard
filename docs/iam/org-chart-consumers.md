# Org chart readers: scope vs approval

Interim inventory (locked before the chart simplification work). The chart is a
single source of truth for **structure** — teams (`org_chart_sections`), people
(`org_chart_nodes`), memberships, and reports-to. Two very different kinds of
code read it, and they must not be conflated while the chart is simplified.

## 1. Scope readers (who you can see / act on)

Company access is **not** derived from the chart anymore (memberships in
`user_companies` are the boundary). The chart is only used to scope *views* and
*team trees*:

| Reader | Used by | Purpose |
|---|---|---|
| `src/modules/hierarchy/org-chart-company-scope.ts` (`scopeOrgChartToCompany`, `loadMergedIdsWithCompanyMembership`) | `src/app/admin/workforce/page.tsx` | Workforce Org. Chart + Activity: current company's teams plus the parent chain; people in those teams or with company membership. |
| `src/modules/platform/scope/org-chart-section-scope.ts` (`resolveViewerOrgChartSectionScope`) | `src/app/admin/workforce/page.tsx` | Non-elevated Admin read-only view: restrict the chart to the viewer's own team subtree. |
| `src/modules/hierarchy/hris-staff-roster.ts` (`loadHrisAssignableStaff`) | assignee pickers, global search, `org-chart-section-roster` | Non-admin people discovery; resolved from the HRIS snapshot, not the chart. |

Rules kept in Phase 1/2 (do not regress while simplifying the chart):

- Teams never grant company access (a team is a workflow seat / structure only).
- Activity and Org. Chart stay **current-company scoped**.
- The chart does not edit portal roles or company access; both live in
  Settings → User Management.

## 2. Approval / eligibility readers (who may approve)

Approval seats are resolved from **position assignments** with an org-chart
manager-walk fallback. These readers are workflow-critical:

| Reader | Used by | Purpose |
|---|---|---|
| `src/modules/platform/approvals/approval-position-resolver.ts` | `src/app/api/tickets/route.ts`, `src/modules/requests/*` (RFP, IRS, FTR, JO), `src/modules/work-plans/*`, `src/modules/tasks/task-completion-verification-access.ts` | Active position assignment (company-scoped, else global) → agent id; falls back to the requestor's direct org-chart manager (`org_chart_nodes.parent_id`). |
| `src/modules/requests/intake-approval-recommendations.ts` | ticket intake | Recommends approvers for new intake using section/member context. |
| `src/modules/work-plans/travel-order-org-chart-path.ts`, `work-plan-org-chart-path.ts` | Travel Orders / Work Plans | Renders and validates the reporting chain used in approvals. |
| `src/modules/requests/job-order-approval.ts`, `job-order-execution-service.ts` | Job Orders | Approves with position/seat eligibility. |
| `src/modules/tasks/department-task-metrics.ts` | Task metrics | Groups task metrics by department/team (reporting only). |

Guard added in Phase 2: deleting a team (or any nested team) that still has
members is rejected (`409`) by `DELETE /api/admin/org-chart-sections` — members
must be moved to another team first. Memberships cascade on delete, so the API
counts the whole subtree before allowing it.

## 3. Interim dependencies to keep stable

Until the chart simplification lands, treat these as contracts:

1. `OrgChartSection.parentId` powers both structural nesting and the
   reports-to manager fallback — do not flatten it in the UI without porting
   the manager walk.
2. `org_chart_node_section_memberships` is the single source of truth for team
   membership; `org_chart_nodes.section_id` is a primary-team mirror.
3. Approval eligibility still falls back to `org_chart_nodes.parent_id` when no
   active position assignment exists.
4. Edit rights: only holders of `hierarchy.update` (Super Admin by default) may
   mutate sections/nodes; Admins are read-only on the chart.
