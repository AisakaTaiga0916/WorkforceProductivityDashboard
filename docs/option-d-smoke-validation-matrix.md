# Option D — Approval Stepper Smoke Validation Matrix

Phase 5 handoff. The shared `ApprovalStepper` chrome (`src/components/ui/approval-stepper.tsx`)
now fronts every approvable document. This is the manual smoke matrix to run before merge/deploy.

## Pre-flight (automated — already green)

| Check | Command | Status |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | clean |
| Unit tests | `npm test` | 465/465 |
| Lint (Option D files) | `npx eslint <files>` | no new findings vs HEAD (workspace 8E/6W, kanban 9E/3W, JO panels 3E pre-existing) |

Not run here: `npm run build` (dev server holds the Prisma engine DLL; runs on deploy) and
`npm run db:migrate:deploy:primary` (applies `20261018090000_drop_ticket_aca_approval_meta`).

## Accounts needed

- Agent A: `requests.approve` + assigned/first-step approver on a seeded chain.
- Agent B: `requests.approve` but not the current step.
- Head: `tasks.verify`, org-chart head of an assignee's department.
- Approver: `work_plans.approve`, on a hierarchical travel order.
- Customer: requestor account for `/tickets/[id]` (viewerMode requestor).
- Admin: for executor/worker paths.

## Matrix

### 1. Agent ticket workspace — RFP (`REQUEST_FOR_PAYMENT`)

- [ ] Rail renders above the RFP grid; steps mirror Prepared By / Noted By / Approved By / Accounting (skip flags honored).
- [ ] Agent A (current-step approver): Approve enabled; completes the step; rail advances.
- [ ] Agent B (not current step): no action buttons; "Waiting on <name>" hint.
- [ ] After last step: rail all-done; sky "Approved" ack button still present; legacy dark Done button absent while the rail renders.

### 2. IRS (`ITEM_REQUISITION_SLIP`)

- [ ] Rail renders; at CANVASSED_BY the rail shows the step current but **no Approve action** (pricing save completes it).
- [ ] Saving pricing advances the rail; at APPROVED_BY the Approve action appears for the approver.
- [ ] Non-approver sees read-only rail.

### 3. FTR (`FUND_TRANSFER_REQUEST`)

- [ ] Rail omits the intake-only Prepared By step.
- [ ] Approve completes Recommending/Approved By; non-approver read-only.

### 4. JO (`JOB_ORDER`)

- [ ] `skipNotedBy` / `skipApprovedBy` intake flags are reflected in the rail.
- [ ] Approve label reads **Done** on the final step.
- [ ] Blocked cases (e.g. job output missing where required) show the amber blocked hint instead of action buttons.
- [ ] Legacy amber warnings + Done button are hidden while the rail renders; they return only if the rail is absent.

### 5. Transfer decision moment

- [ ] Pending transfer: rose box shows rail (Transfer requested → Reassigned).
- [ ] Approver: "Assign to preferred recipient" / "Return to requester" both work and clear the box.
- [ ] Non-approver: guidance text, no buttons.

### 6. JO execution (Ticket Controls → workers / assistance panels)

- [ ] Rail shows Execution → Confirmation; **Job Done** button completes execution.
- [ ] After Job Done: "Job Done recorded. Waiting on the final Approved By…" text (rail replaced by status text).
- [ ] Status FOR_CONFIRMATION: "Sent for customer confirmation."

### 7. Task completion verification (kanban)

- [ ] Detail modal: violet block shows rail (Submitted → Verified) + Verify / Reject; Verify marks the task Done.
- [ ] Reject requires a comment (button disabled until filled); after reject: "Returned" chip, reason shown, returned-state rail + Re-submit present.
- [ ] For My Approval dialog: each pending sub-task row has its own rail; Verify acts on that sub-item; card-level rail when no sub-items pending.
- [ ] Without `tasks.verify` or when not the department head: controls absent.

### 8. Work plans — travel orders

- [ ] VII. Management Approval seats show Approved / Awaiting action / **Declined** / Pending.
- [ ] Current level approver sees Appendix rail with Approve / Return; Return requires a reason and declines the order at that level.
- [ ] Declined order: banner shows reason + who declined + level + time; Declined chip on the right seat.
- [ ] Confirmer: "Confirm travel order" / "Do not confirm" still behave as before (legacy).

### 9. Requestor view (`/tickets/[id]` as Customer)

- [ ] Rails for RFP / IRS / FTR / JO render read-only ("Waiting on <name>" when current step is known).
- [ ] No action buttons anywhere; legacy agent-name grids remain visible.
- [ ] Transfer box: waiting text only.

### 10. Regression

- [ ] No surface shows both the rail and its legacy action button.
- [ ] Rail wraps cleanly on mobile widths (compact mode); no hydration warnings in console (time elements are suppressed).
- [ ] Non-family tickets (plain TICKET) render unchanged.

## Known gaps (accepted, not regressions)

- RFP / IRS / FTR / JO have no per-step return backend — rails there are approve-only.
- Confirmer actions and the legacy non-Work-Plan travel-order rail remain legacy UI.
- `admin/ticket-requests` surface was not audited for Option D duplication.
- ACA removal: legacy ACA ticket rows display as plain tickets; seeded RA/AP positions remain in the DB; the column-drop migration and Prisma regen happen on deploy.
