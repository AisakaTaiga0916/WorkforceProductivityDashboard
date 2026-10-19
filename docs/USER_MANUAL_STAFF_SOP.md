# Ticket System v3 — Staff SOP Manual

## Purpose

Standard operating procedures for **Personnel**, **Admin**, and **SuperAdmin** users operating tickets, boards, and KPI/task work.

Current project status: the live UI is branded **AGCTek Help Desk**. Ticket escalation now operates as a **Request for transfer** approval workflow, KPI recurrence includes **Quarterly** cycles, and Admin/SuperAdmin reporting is available at **`/reports`**.

## 1) Daily startup checklist

1. Sign in at **`/signin`**.
2. Open the appropriate board:
   - **Personnel:** `/agent` → **Ticket Board** and **Task Board**
   - **Admin:** `/agent` → review **Assignment**, **Company**, **Ticket**, and **Task** boards as needed
3. Open **`/insights`** — ticket metrics, task metrics, and (if coordinator) Task Management.
4. Check notifications (bell) for new **Open** tickets and (admins) pending **account requests**.
5. Prioritize overdue items, **UNSET** priority tickets, and **Delayed** IT project sub-tasks.
6. Admin/SuperAdmin: review **`/reports`** when you need an executive snapshot of transfer posture, queue mix, and recent closures.

## 2) Ticket handling SOP

### Intake

1. Review new/unassigned tickets on **Ticket Board** or dashboard.
2. Validate completeness: title, impact, reproduction steps, attachments, and intake screenshots.
3. Set **priority** (not **Set Priority Level**) before **In progress**.
4. Request missing details in the thread; log major decisions in the timeline.

### Assignment

1. Use **Assignment Board** (`/admin/manual-assignment`) or ticket assignment controls.
2. Confirm assignee and team are visible on the card.
3. For admin-created tickets, use **Create requests** (`/admin/ticket-requests`) when submitting on behalf of a user.

### Work-in-progress

1. Move status to match reality (kanban drag or ticket workspace).
2. Document significant actions in activity/comments.
3. Use **request more information** per policy when waiting on the requestor.
4. If assigned personnel cannot continue or needs higher-level handling, use **Request for transfer** from **`/agent/tickets/[id]`** and select the Admin/SuperAdmin reviewer.

### Resolution and closure

1. Confirm acceptance criteria before **Resolved**.
2. Add a concise resolution note; customer receives verification email when configured.
3. Move to **Closed** after customer verification/rating per policy.
4. If the customer rates **3 stars or below**, written feedback is required and should be reviewed for follow-up.
5. Do not leave tickets in **Resolved** without driving verification when it is mandatory.

## 3) Board operations (`/agent`)

### Board tabs (Admin)

| Tab | Route | Use |
|-----|-------|-----|
| Assignment Board | `/admin/manual-assignment` | Assign tickets to personnel lanes |
| Company Board | `/agent?board=company` | Company-line operational view |
| Ticket Board | `/agent?board=ticket` | Primary ticket kanban |
| Task Board | `/agent?board=kpi` | KPI/task kanban and definitions |

### Board tabs (Personnel)

- **Ticket Board** — `/agent?board=ticket`
- **Task Board** — `/agent?board=kpi`
- **Assignment Board** — only if `canAccessAssignmentBoard` permission is granted

### Standard practice

- Update statuses the same business day; avoid stale cards.
- Use header search to jump to a ticket by number or keyword.
- Personnel home redirects to **`/agent`**; personal ticket list is **`/my-requests`**.

## 4) Task / KPI SOP

### Task Board kanban

Columns: **Current**, **Done**, **Delayed**.

- Drag tasks between columns where enabled (mouse or touch).
- **Assignment lanes** (admins/coordinators): drag tasks onto personnel lanes to assign the full KPI card.
- **Sub-task assignee** controls (admins/coordinators): assign individual sub-KPIs to other personnel from inside each task card.
- **Before / After screenshots**: non-IT Project sub-KPIs can include screenshot sets for evidence. Files must be **JPEG or PNG only**, up to **5 screenshots per slot**, and **10MB or smaller** each.

### Recurring tasks

- **Daily / Weekly / Monthly / Quarterly** cycles; weekly/monthly/quarterly use configured weekday or start day. Quarterly cycles currently run as 4-month periods.
- **Segmented** checklists: grouped sub-tasks; **flat** checklists: single list.
- Personnel assigned to an individual sub-KPI can see the parent KPI card and update only that assigned sub-task.
- Sub-KPI assignees may upload before/after screenshots as work evidence on non-IT Project items.
- Checklist state resets when a new KPI period starts (timezone-aware API).
Daily task metrics exclude Sundays from working-day averages.

### IT Project Implementation (non-recurring)

1. Admins define on **Task Board** via **Task Definition** (project name, phases, sub-tasks with due dates).
2. Assignee completes each sub-task with an **actual date** (**MM/DD/YYYY** in UI).
3. **Delayed** column: sub-task past due, or actual date after due date.
4. Do not use **mark all complete** for this pillar — complete sub-tasks individually.
5. Late but fully complete work remains in **Delayed**, not **Done**.

### Other recurring KPIs

- Late completion may show in **Done** with a delayed indicator.
- The KPI card assignee can edit the full checklist; sub-KPI assignees can edit only their assigned items.

### Where to define tasks

| Role | Location |
|------|----------|
| Admin / SuperAdmin | **Task Board** → Task Definition console |
| Personnel (coordinator) | **`/insights`** → **My Task Management** tab |

## 5) Metrics & Reports SOP (`/insights`)

### Ticket metrics tab

- Set **reporting window** (from/to) before reviews or stand-ups.
- Monitor SLA compliance, backlog, CSAT, and throughput charts.

### Task metrics tab

- Choose cadence (daily/weekly/monthly/quarterly) and date range.
- Review helpdesk exports, user-support counts, and checklist pillar completion.

### Refresh discipline

- Tabs auto-refresh on an interval when active; reload after major board changes if numbers look stale.

## 6) Role-based controls

### Personnel

- Work assigned tickets and tasks.
- Edit own checklist/task completion only (when restricted).
- Optional: assignment board + Task Management on Insights (coordinator permission).

### Admin / SuperAdmin

- Full personnel, priority alerts, board access, task definition, and reporting.
- Review account suspension/deletion/password-reset requests (notifications → **`/admin/account`**).
- Manage portal accounts from **Settings → User Management** (the old **`/admin/account-management`** path redirects there), including staff account creation, role/company updates, roster sync, and staff assignment colors (colors also editable from **`/admin/workforce`** → **Org. Chart** team member lists).
- SLA sweep and deployment operations per runbook.

## 7) Transfer and SLA SOP

1. Review SLA risk on dashboard and **`/insights`**.
2. Configure triggers under **Priority alerts** (`/admin/escalation-triggers`).
3. Run or schedule **`POST /api/sla/sweep`** per operational policy; the current sweep scans unresolved tickets and refreshes reporting instead of automatically moving tickets.
4. Personnel submit **Request for transfer** from the staff ticket workspace when reassignment or higher-level review is needed.
5. Admin/SuperAdmin reviewers approve pending transfer requests from the ticket workspace. Pending requests appear as **Transfer pending**.
6. Transfer-pending tickets must have clear activity logs and ownership on handoff.

## 8) Account and security SOP

**`/admin/account`** → **Security**:

- Upload/edit profile image from **Profile** (PNG/JPG/WEBP, up to 10MB; drag/zoom framing).
- Change username, email, or password (current password required).
- Submit account suspension/deletion/password-reset requests (customers/personnel).

**Rule:** credential changes force sign-out — re-authenticate immediately on shared machines.

## 9) Shift-end checklist

1. All active tickets reflect current status.
2. Handoff notes on unresolved high-priority or transfer-pending work.
3. KPI/task checklists updated for your assignments.
4. IT Project sub-tasks: due dates and actual dates current.
5. Sign out on shared devices.

## 10) Incident troubleshooting quick guide

| Symptom | Action |
|---------|--------|
| Cannot update checklist | Confirm assignee; check IT Project vs recurring rules |
| Task stuck in Delayed | Complete overdue sub-tasks or correct actual/due dates |
| Missing board tab | Verify role and `canAccessAssignmentBoard` permission |
| Missing menu item | Contact Admin for role update |
| Deploy/build mismatch | Follow deployment runbook (build, Prisma migrate, PM2 restart) |
