# Ticket System v3 — User Manual

## 1) Overview

Ticket System v3 is a service desk platform for:

- submitting and tracking support tickets
- managing assigned work through **ticket** and **task** boards
- monitoring KPI and operational metrics in **Metrics & Reports**
- handling account security and profile settings

This manual covers daily use for **Customer**, **Personnel**, **Admin**, and **SuperAdmin** roles.

### Current project status

- Product branding is now **AGCTek Help Desk** in the live UI.
- Current app stack: **Next.js 16**, **React 19**, Prisma/PostgreSQL, NextAuth, Tailwind CSS, and SMTP email.
- Ticket escalation is handled as a **Request for transfer** workflow. The former **Escalated** status is shown to users as **Transfer pending** and requires Admin/SuperAdmin approval.
- KPI/task cycles support **Daily**, **Weekly**, **Monthly**, and **Quarterly** schedules; quarterly cycles currently use 4-month periods.
- Ticket intake screenshots, task proof screenshots, profile images, account requests, and admin reporting are implemented.

## 2) Access and sign-in

### Sign-in methods

- Go to **`/signin`**
- Sign in with:
  - local credentials (username or email + password), or
  - **Google OAuth**, when configured

### First-time access

- Self-registration: **`/signup`** when enabled
- Admin-provisioned accounts: use credentials provided by your administrator

### Sign-out

- Use **Sign out** in the header (or My Account).
- Username, email, and password changes sign you out automatically after success.

## 3) Roles and navigation

Navigation is **role-based** (sidebar on large screens; menu button on mobile).

### Customer

| Item | Path |
|------|------|
| Dashboard | `/` |
| Active Tickets | `/my-tickets` |
| Knowledge Base | `/tickets/knowledge` |
| Settings | `/tickets/knowledge#settings` |
| My Account | `/admin/account` |

Customers are redirected away from `/agent` and `/insights`.
Create tickets from dashboard actions or directly at **`/tickets/new`**.

### Personnel

| Item | Path |
|------|------|
| Ticket Dashboard | `/my-requests` |
| Board → Ticket Board | `/agent` or `/agent?board=ticket` |
| Board → Task Board | `/agent?board=kpi` |
| Metrics & Reports | `/insights` |
| My Account | `/admin/account` |

Personnel landing: **`/agent`** (home redirects here).

Optional (when granted **assignment-board** permission):

- **Assignment Board** — `/admin/manual-assignment`
- **Task Management** tab on **`/insights`** (KPI definitions for coordinators)

### Admin / SuperAdmin

| Item | Path |
|------|------|
| Ticket Dashboard | `/` |
| Create requests | `/admin/ticket-requests` |
| Workforce | `/admin/workforce` |
| Board | `/agent` (see board tabs below) |
| Metrics & Reports | `/insights` |
| Priority alerts | `/admin/escalation-triggers` |
| My Account | `/admin/account` |

On **`/agent`**, admins also use sub-tabs:

- **Assignment Board** — `/admin/manual-assignment`
- **Company Board** — `/agent?board=company`
- **Ticket Board** — `/agent?board=ticket`
- **Task Board** — `/agent?board=kpi` (KPI kanban + task definitions)

Header utilities (staff): ticket search, notifications, **Process** (`/process`).

## 4) Customer guide

### Submit a ticket

1. Open **`/tickets/new`**.
2. Complete title, description, department/business unit, and contact fields.
3. Attach screenshots if helpful. You can upload, paste, or drag image files; up to **15 screenshots**, **5MB each**.
4. Submit; save the **ticket number**.

**Intake lock:** If a resolved ticket still needs verification/rating, new tickets may be blocked until that flow is finished.

### Track and reply

1. Use **`/my-tickets`** or the dashboard kanban at **`/`**.
2. Review status, timeline, and conversation.
3. Reply when support requests more information.

### Verification and rating

- Resolved tickets: complete **`/tickets/[id]/verification`** and rating when prompted.
- Ratings of **3 stars or below** require written feedback before the ticket can close.
- Email links may also point to verification actions.

## 5) Personnel guide

### Ticket Dashboard (`/my-requests`)

- Personal view of tickets you submitted or own per policy.
- Same intake-lock rules as customers when you are the requestor.

### Ticket Board (`/agent?board=ticket`)

- Kanban/table views for operational ticket work.
- Set **priority** above **Set Priority Level (UNSET)** before moving to **In progress** (policy enforced).
- Drag-and-drop status updates where enabled.
- Assigned personnel use the ticket workspace (**`/agent/tickets/[id]`**) to request more information, resolve tickets, and submit **Request for transfer** approval requests when a ticket needs reassignment or higher-level handling.

### Task Board (`/agent?board=kpi`)

- **Task kanban** columns: **Current**, **Done**, **Delayed** (see KPI section).
- Complete **sub-KPI checklists** on KPI cards assigned to you, or individual sub-KPIs assigned directly to you.
- Add **Before** and **After** screenshots to non-IT Project sub-KPIs when evidence is needed. Uploads accept **JPEG/PNG only**, up to **5 screenshots per slot**, **10MB each**.
- Coordinators with assignment permission may use **Task Management** on **`/insights`**.

### Metrics & Reports (`/insights`)

Tabs (role-dependent):

- **Ticket metrics** — volume, SLA, CSAT, charts (date range filter).
- **Task metrics** / **My task metrics** — helpdesk and checklist pillar metrics.
- **Task Management** (Personnel coordinators only) — define recurring tasks when permitted.

## 6) Admin / SuperAdmin guide

### Ticket Dashboard (`/`)

- Queue health, on-duty roster, recent activity, priority stack.

### Create requests (`/admin/ticket-requests`)

- Admin intake for tickets on behalf of users; links to assignment and board views.

### Workforce (`/admin/workforce`)

- **Activity** — live personnel cards with On Duty / Offline status from today's HRIS clock-ins (updates every 10 seconds).
- **Org. Chart** — company-scoped teams and people (create / nest teams, set heads, place or remove members, staff assignment colors). Structure only; roles and company access live in Settings → User Management.
- Pending account-request review (suspend / delete / password reset) appears at the top of Workforce when requests are waiting.

### Boards

| Board | Purpose |
|-------|---------|
| Assignment | Drag tickets to assign owners (`/admin/manual-assignment`) |
| Company | Cross-team company-line view |
| Ticket | Main operational ticket kanban |
| Task | KPI/task kanban + **Task Definition** console (admins) |

Transfer requests are reviewed from the ticket workspace by the selected Admin/SuperAdmin reviewer. A pending request appears as **Transfer pending**.

### Priority alerts (`/admin/escalation-triggers`)

- Configure priority-linked alert behavior. SLA sweeps report scanned tickets and refresh reporting; transfer/escalation movement is handled through the approval workflow.

### Metrics & Reports (`/insights`)

- Full ticket and task metrics; reporting window and cadence controls.
- Admins define tasks on **Task Board**, not the Insights Task Management tab.

### Other admin paths

- **`/admin/account-management`** — redirects to **Settings → User Management** for portal account administration.
- **`/admin/personnel`** — redirects to **`/admin/workforce?view=sections`** (Org. Chart).
- **`/reports`** — Admin/SuperAdmin executive reporting: transfer pending, priority mix, status mix, top queues, recent closures, and SLA summary.
- **`POST /api/sla/sweep`** — secured Admin SLA scan/report refresh endpoint.

## 7) KPI and task behavior

### Recurring tasks

- Frequencies: **Daily**, **Weekly** (configurable weekday), **Monthly** (configurable day of month), **Quarterly** (4-month cycle with configurable start day).
- Sub-KPI checklists can be **flat** or **segmented** (grouped sections).
- Admins/coordinators can assign individual sub-KPIs to different personnel from the Task Board.
- A sub-KPI assignee can see the parent KPI card and update only that assigned sub-task.
- Non-IT Project sub-KPIs support **before** and **after** screenshot sets for visual proof of work.
- On period rollover, checklist completion resets for the new cycle.
- Timezone: browser/reporting zone is sent to the API for period boundaries.

### IT Project Implementation

Special non-recurring pillar:

- Organized by **project name** and **phases**; each sub-task has its own **due date**.
- Dates are entered/displayed as **MM/DD/YYYY**; stored as calendar days.
- Assignees record an **actual date** when marking a sub-task complete.
- **Delayed** column applies **only** to this pillar when a sub-task is past due or completed after due date.
- Fully complete but late work stays in **Delayed**, not **Done**.

### Other recurring tasks

- Completed after the due period may still appear in **Done** with a delayed indicator (recurring KPIs).
- Only the KPI card assignee or the specific sub-KPI assignee can edit checklist items in restricted flows.

## 8) My Account and security

Open **`/admin/account`** → **Security** tab (available to Customer, Personnel, and Admin roles).

The **Profile** tab supports a profile photo upload (**PNG/JPG/WEBP**, up to **10MB**) with drag/zoom framing. The **Billing** tab is present as an account area but billing workflows are not part of the current ticket operations.

### Change username

1. New username + current password → **Update username**.
2. Sign in again with the new username.

Rules: 3–32 characters; letters, numbers, `.`, `_`, `-`; unique.

### Change email / password

Same pattern: current password required; automatic sign-out on success.

### Account requests

Submit suspension, deletion, or password reset requests; Admin/SuperAdmin reviews them in Workforce/account workflows. Approved password reset requests set the portal password to the configured default reset password.

## 9) Troubleshooting

| Issue | What to try |
|-------|-------------|
| Cannot sign in | Verify credentials; check Google sign-in if used; confirm account active |
| Unauthorized / missing menu | Role may not include that feature — contact Admin |
| Cannot create ticket | Complete pending resolved verification/rating |
| Cannot move to In progress | Set priority above **UNSET** |
| Transfer is pending | Wait for the selected Admin/SuperAdmin reviewer to approve it |
| Cannot edit checklist | Confirm you are the assignee |
| KPI dates look wrong | Confirm timezone around weekly/monthly rollover |

## 10) Quick reference

| Path | Description |
|------|-------------|
| `/signin` | Sign in |
| `/signup` | Self-registration |
| `/` | Home (customer dashboard or admin ticket dashboard) |
| `/my-tickets` | Customer ticket list |
| `/my-requests` | Personnel ticket dashboard |
| `/tickets/new` | New ticket |
| `/tickets/[id]` | Ticket detail |
| `/tickets/[id]/verification` | Resolution verification |
| `/tickets/[id]/rate` | Rating / feedback |
| `/agent` | Staff boards (use `?board=` tabs) |
| `/agent/tickets/[id]` | Staff ticket workspace |
| `/admin/manual-assignment` | Assignment board |
| `/insights` | Metrics & reports |
| `/process` | Process / lifecycle reference |
| `/reports` | Admin/SuperAdmin reporting |
| `/admin/workforce` | Workforce (personnel registry + live activity) |
| `/admin/escalation-triggers` | Priority alerts |
| `/admin/account` | My Account |
