# Baseline Status

State of the module/architecture baseline work (branch `wpd-rbac-rework`).
Authoritative auth/RBAC status lives in `docs/iam/single-db-auth.md`.

## Verified

- `npx tsc --noEmit`: clean.
- `npm test`: 87 files / 461 tests passing.
- `npx eslint` on all touched files: 0 new errors/warnings (repo-wide pre-existing lint debt is unchanged and unrelated).

## Module layout

| Area | Location | Status |
| --- | --- | --- |
| Platform tier | `src/modules/platform/{auth,db,rbac,scope,settings}` | Moved and verified |
| Requests | `src/modules/requests/` (78 files incl. 6 extracted services) | Moved and verified |
| Tasks (+ `efficiency/`) | `src/modules/tasks/` | Moved and verified |
| Work plans | `src/modules/work-plans/` | Moved and verified |
| Hierarchy | `src/modules/hierarchy/` | Moved and verified |
| Cross-cutting utils | `src/lib/` (75 entries) | Intentionally left in place; move on touch |

## Ticket route extraction (`src/app/api/tickets/[id]/route.ts`)

Route shrank from 4,264 to 810 lines. All extracted handlers follow the same
contract: the service owns permission ∧ eligibility ∧ transition, failures
return `NextResponse`, successes return `{ ticket, meta?, extra? }` which the
route maps through `ticketJsonWithAssigneeColor`.

Extracted services under `src/modules/requests/`:

- `payment-approval-service.ts` (set assignees, request, approve step, update mode, complete step)
- `item-requisition-service.ts` (assignees, request, pricing, undo canvass, complete step)
- `fund-transfer-service.ts` (assignees, request, complete step)
- `job-order-approval-service.ts` (assignees, request, complete step)
- `transfer-service.ts` (request / approve / reject transfer)
- `job-order-execution-service.ts` (execution assignee, workers, assistance team, complete execution, link/unlink/request/cancel project)
- `ticket-lifecycle-service.ts` (status, priority, remarks, feedback, resolution verification, cancel request)

`ticket-request-type.ts` holds the shared `loadTicketRequestType` loader.
Static stubs that remain in the route by design: `assign` and
`request_more_info` (fixed deprecation responses).

ACA (Authority to Conduct Activity) request type removed 2026-10-18: modules,
UI, tests deleted; DB column dropped via migration
`20261018090000_drop_ticket_aca_approval_meta` (applies on next deploy).

## Remaining leftovers (not blockers)

- `src/lib/` (75 entries): cross-cutting helpers shared across modules — move into owning modules opportunistically ("on touch").
- On-touch extraction targets: tickets `GET` serializer, verification/confirmation email endpoints, task verify/complete handlers, work-plan submit/approve handlers, hierarchy presentation helpers.
- Optional: normalize `src/app/api/tickets/[id]/route.ts` line endings to CRLF (repo has `core.autocrlf=true`, no `.gitattributes`); content is LF today, which Git warns about but does not corrupt.

## Deferred (Phase 7, parked by design)

- Guest role / public intake.
- Work plans as primary record.
- Approval policy configuration UI.

## Manual smoke checklist (before merge)

1. Staff login → Requests board loads; open a ticket workspace.
2. Ticket status move (OPEN → IN_PROGRESS with priority set) and board lane drag.
3. One approval chain end-to-end (e.g. Fund Transfer: set assignees → request → complete steps → green-lit).
4. Transfer request → approve → reject flows from the ticket workspace.
5. Job Order: execution assignee, co-workers, assistance team, mark Job Done.
6. Customer: resolution verification + star review (feedback).
7. Settings triad visible to SuperAdmin only; module kill switches respond.
