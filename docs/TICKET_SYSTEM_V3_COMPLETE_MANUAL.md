# Ticket System v3  

## Complete manual — project rundown & user guide  

**Document version:** 1.2 · **Product:** Ticket System v3 / AGCTek Help Desk · **Audience:** operators, staff, customers, and administrators · **May 2026**

---

## Table of contents  

1. [Project rundown (technical)](#1-project-rundown-technical)  
2. [Architecture & data](#2-architecture--data)  
3. [Authentication & roles](#3-authentication--roles)  
4. [Deployment & operations](#4-deployment--operations)  
5. [Customer user guide](#5-customer-user-guide)  
6. [Staff & personnel guide](#6-staff--personnel-guide)  
7. [Admin & SuperAdmin guide](#7-admin--superadmin-guide)  
8. [Account security (My Account)](#8-account-security-my-account)  
9. [Troubleshooting](#9-troubleshooting)  
10. [Quick reference — URLs](#10-quick-reference--urls)  

---

## 1) Project rundown (technical)  

### 1.1 Purpose  

Ticket System v3 is a full-stack **service desk / ticketing** application for submitting requests, assigning work to teams and personnel, tracking **SLA** targets, managing transfer approvals for items that need higher-level handling, managing **KPI** maintenance tasks, and collecting **customer verification and feedback** after resolution.  

### 1.2 Technology stack  

| Layer | Technology |
|--------|------------|
| Application | **Next.js 16** (App Router), **React 19**, **Tailwind CSS 4** |
| API | **Next.js Route Handlers** (`src/app/api/**`) |
| Database | **PostgreSQL** with **Prisma ORM** |
| Authentication | **NextAuth.js** — local credentials and optional **Google OAuth** |
| Email | **SMTP** (e.g. Brevo) for resolution and verification flows |
| Realtime / UX | Socket.IO dependencies, role-based shells, responsive sidebars, notification polling |

### 1.3 Repository layout (high level)  

- **`src/app/`** — Pages and API routes (App Router).  
- **`src/components/`** — Shared UI (navigation, portal shell, dashboards).  
- **`src/lib/`** — Business logic: auth, SLA, email, ticket actions, portal accounts.  
- **`prisma/`** — Schema, migrations, seed.  
- **`ecosystem.config.cjs`** — **PM2** process definition for production on Node hosts.  
- **`docs/`** — User manuals, staff SOP, and Mermaid flowcharts.

### 1.4 Current implementation status

- Live UI branding is centralized as **AGCTek Help Desk**.
- Customer portal navigation now includes **Dashboard**, **Active Tickets**, **Knowledge Base**, and **Settings**; ticket creation remains available through dashboard actions or direct URL **`/tickets/new`**.
- Ticket intake supports screenshot upload/paste/drag-and-drop with stored request screenshots visible from ticket detail/workspace.
- Operational escalation is now a **Request for transfer** approval workflow. The stored `ESCALATED` status is displayed as **Transfer pending**.
- KPI/task recurrence supports **Daily**, **Weekly**, **Monthly**, and **Quarterly** cycles; quarterly periods are implemented as 4-month cycles.
- Account features include profile images, security changes, account action requests, and Admin/SuperAdmin review of pending requests.
- Admin reporting at **`/reports`** is implemented for transfer posture, queue mix, recent closures, and SLA summary.

### 1.5 Core concepts  

- **Ticket** — Single customer issue with status (Open → In progress → For confirmation → Closed, plus Pending info and Transfer pending as needed).  
- **Priority** — Includes a **“Set Priority Level” (UNSET)** default until staff sets **Low / Medium / High / Urgent**; work typically cannot move to **In progress** until priority is set (policy enforced in API/board).  
- **SLA** — First-response and resolution due times derive from **SlaPolicy** per priority; Admin-triggered sweep scans unresolved tickets and refreshes reports. Transfer/escalation movement is handled through the approval workflow rather than automatic sweep escalation.  
- **Teams & agents** — Tickets route to teams; **Personnel** work assigned queues from **`/agent`**.  
- **Transfer pending** — User-facing label for tickets awaiting approval of a personnel-submitted transfer request.

---

## 2) Architecture & data  

### 2.1 Request flow (simplified)  

1. User authenticates → session carries **role** and **email**.  
2. Customer submits ticket → **`POST /api/tickets`** creates row, SLA timestamps, activity log.  
3. Staff manage lifecycle → **`PATCH /api/tickets/[id]`** (status, priority, more-information requests, transfer requests, resolution).  
4. On **Resolved**, system may email the **requestor inbox** (SMTP); customer **verifies** and submits **rating** where configured.  
5. If assigned personnel cannot continue a ticket, they submit **Request for transfer** from **`/agent/tickets/[id]`** to an Admin/SuperAdmin reviewer; approval moves it into the transfer-pending/assignment flow.

### 2.2 Notification email routing  

- **Google sign-in:** notification and verification emails target the **Google account email** (`authProvider: google`).  
- **Portal / credentials:** **`requestorEmail`** on the ticket aligns with the **portal account work email** stored in the database (with safeguards); synthetic portal identities may require an explicit notification email on intake.  

### 2.3 Pending resolution confirmation (customers)  

If a customer has a **resolved** ticket that still needs **verification and mandatory rating** (no feedback record yet), **new ticket creation may be blocked** until that flow is completed. The UI surfaces a **notification** and links to the **verification** path (e.g. `/tickets/[id]/verification`).  

---

## 3) Authentication & roles  

### 3.1 Sign-in  

- **URL:** `/signin`  
- Methods: **local credentials** (username or email + password) and **Google** (if configured).  

### 3.2 Role resolution (typical)  

1. Portal account role from the database when an account exists.  
2. Env lists **`ADMIN_EMAILS`** / **`AGENT_EMAILS`** for bootstrap mapping.  
3. Default **Customer** where no other rule applies.  

### 3.3 Role summary  

| Role | Typical access |
|------|----------------|
| **Customer** | Dashboard (`/`), **Active Tickets**, **Create ticket**, knowledge base, verification/rating, **`/admin/account`**. |
| **Personnel** | **`/my-requests`**, **Ticket** and **Task** boards (`/agent`), insights, optional assignment board. |
| **Admin / SuperAdmin** | Ticket dashboard, create requests, personnel, all board tabs, priority alerts, task definitions, insights, SLA sweep. |

**Head / privileged portal flags** may grant coordination powers per implementation.  
SuperAdmin can create staff portal accounts, manage roles/designated companies, sync roster entries, and assign staff color tags. Admin users can manage within their designated company scope where enabled.

---

## 4) Deployment & operations  

### 4.1 Environment  

Copy **`.env.example`** to **`.env`**. Key groups: `DATABASE_URL`, **NextAuth** secret and URL, optional **Google** client settings, **SMTP (Brevo)** for mail, **`APP_BASE_URL` / `NEXTAUTH_URL`** for correct email links, optional admin email lists.  

### 4.2 Database  

- **Prisma:** `npx prisma migrate deploy` *or* `npx prisma db push` (depending on how the environment was baselined).  
- **Helpdesk Google Form CSV (Insights task metrics):** after deploy, upload the sheet export once per environment — `npm run db:apply-helpdesk-csv path/to/"IT SALF - HELPDESK.csv"` (spreadsheet **Completed** is counted as **For confirmation** alongside **Closed**).  
- **Seed (optional):** `npm run db:seed` for demo data.  
- **KPI snapshots/backfills:** `npm run db:backfill-kpi-snapshots`, `npm run db:apply-kpi-sheet`, and related range/daily scripts are available for metrics data repair/import.  
- One-off: `npx tsx scripts/ensure-unset-priority-data.ts` if using **UNSET** priority and SLA rows need ensuring after `db push`.  

### 4.3 Production (Node + PM2)  

- Build: `npm run build`  
- Start: `pm2 start ecosystem.config.cjs` (or `npm run pm2:start`)  
- Reload after deploy: `npm run deploy:pm2` or `pm2 restart ticket_system_v3 --update-env`  
- See repository **`DEPLOY_NGINX.md`**, **`DEPLOY_NGINX_WINDOWS.md`**, or **`DEPLOY_CPANEL.md`** for host-specific steps.  

---

## 5) Customer user guide  

### 5.1 First steps  

1. Open **`/signin`** (legacy **`/customer/signin`** redirects here; **`/signup`** when self-registration is enabled).  
2. Use the account your organization provided, or register per policy.  
3. After sign-in, the **Dashboard** (`/`) shows a kanban of your tickets.  

**Portal navigation**

| Area | Path |
|------|------|
| Dashboard | `/` |
| Active Tickets | `/my-tickets` |
| Knowledge Base | `/tickets/knowledge` |
| Settings | `/tickets/knowledge#settings` |

Use dashboard actions or **`/tickets/new`** to create requests. Use the **notification bell** for updates and verification reminders.

### 5.2 Submit a ticket  

1. Go to **`/tickets/new`**.  
2. Complete **department / business unit**, **name**, and **issue** description.  
3. Attach screenshots if helpful. The intake form supports upload, paste, and drag-and-drop; up to **15 images**, **5MB each**.  
4. If you use **Google**, emails for resolution/verification go to your **Google address**. If you use a **portal** account, notification email follows your **registered work email** (optional override only when it matches your portal email).  
5. Submit; track from **`/my-tickets`** or the dashboard.  

### 5.3 Track and participate  

- Open a ticket from **Active Tickets**, the dashboard kanban, or a shared link.  
- Read the **activity timeline** and **conversation** thread.  
- Dashboard columns group work as **Open**, **In progress**, and **For confirmation** (resolved, awaiting your verify/rate).  
- If **new requests are blocked** because a **resolved** ticket awaits your **confirmation and rating**, open the **notification** or the linked **verification** page and complete the steps.  

### 5.4 Resolution, verification, and rating  

1. When staff marks the ticket **Resolved**, you may receive email with verify / reject links.  
2. In the portal, complete **verification** and **star rating / feedback** when prompted.  
3. Ratings of **3 stars or below** require written feedback before closure.  
4. Until mandatory steps are done, **creating another ticket** may be disabled **policy**.  

### 5.5 Ticket statuses (customer view)  

| Status | Meaning (plain language) |
|--------|---------------------------|
| Open | Received; queued / triaged. |
| In progress | Actively worked. |
| Pending info | Waiting on information (implementation may vary). |
| Transfer pending | A transfer request is waiting for Admin/SuperAdmin approval. |
| Resolved | Solution delivered; you should verify and rate. |
| Closed | Closed after confirmation / feedback per policy. |

### 5.6 My account  

Open **`/admin/account`**. The **Profile** tab supports profile image upload/framing (**PNG/JPG/WEBP**, up to **10MB**) and local bio notes. The **Security** tab changes username, email, and password; successful security changes sign you out and require a fresh sign-in. Submit suspension, deletion, or password reset requests for admin review when needed.  

---

## 6) Staff & personnel guide  

### 6.1 Daily routine  

1. Sign in at **`/signin`**.  
2. **Personnel** land on **`/agent`**; personal ticket list is **`/my-requests`**.  
3. Use board tabs: **Ticket Board** (`/agent?board=ticket`) and **Task Board** (`/agent?board=kpi`).  
4. Review **`/insights`** — ticket metrics, task metrics, and (coordinators only) **My Task Management**.  

### 6.2 Working a ticket  

1. Confirm assignment and priority (**set priority** if still **UNSET** — otherwise board/API may block **In progress**).  
2. Update status honestly (drag-and-drop where enabled).  
3. Use **request more information** per policy (may log activity **without** forcing “pending info” status depending on configuration).  
4. Use **Request for transfer** from **`/agent/tickets/[id]`** when the assigned personnel needs Admin/SuperAdmin approval to transfer ownership or escalate handling.  
5. Resolve with clear **resolution notes**; customer receives email to **verify**.  
6. Staff ticket workspace: **`/agent/tickets/[id]`**.  

### 6.3 KPI / task hygiene  

- Complete checklist items where you are the KPI card assignee, or where an individual sub-KPI is assigned directly to you.  
- Admins/coordinators can assign individual sub-KPIs to other personnel from inside each Task Board card.  
- Non-IT Project sub-KPIs can store **before** and **after** screenshot sets for evidence; uploads must be **JPEG or PNG**, up to **5 screenshots per slot**, no larger than **10MB** each.  
- Respect recurrence boundaries (daily / weekly / monthly cycles); period boundaries use browser/reporting timezone in API calls.  
- **Recurring tasks:** flat or **segmented** sub-KPI checklists; **Daily**, **Weekly**, **Monthly**, and **Quarterly** schedules; checklists reset on period rollover.  
- **IT Project Implementation:** non-recurring; phases and per-sub-task due dates (**MM/DD/YYYY** in UI); record **actual date** when completing sub-tasks. **Delayed** column applies only to this pillar (late sub-task or actual after due); fully complete but late work stays in **Delayed**, not **Done**.  
- Other recurring KPIs: late completion may show **Done** with a delayed indicator.  
Quarterly task metrics currently use 4-month cycles and daily task metrics exclude Sundays from working-day averages.

### 6.4 Metrics & Reports (`/insights`)  

| Tab | Audience | Content |
|-----|----------|---------|
| Ticket metrics | Admin, Personnel | SLA, volume, CSAT, charts (date range) |
| Task metrics | Admin, Personnel | Helpdesk / checklist pillar metrics by daily, weekly, monthly, or quarterly cadence |
| Task Management | Personnel coordinators | KPI definitions (when `canAccessAssignmentBoard`) |

Admins define tasks on **Task Board** (`/agent?board=kpi`), not the Insights Task Management tab.

---

## 7) Admin & SuperAdmin guide  

### 7.1 Oversight  

- **`/`** — Ticket dashboard (on-duty, activity, priority stack).  
- **`/admin/ticket-requests`** — Create requests on behalf of users.  
- **`/admin/workforce`** — Workforce: live personnel activity cards (Activity) and the company Org. Chart (teams + people, structure only).  
- **`/admin/manual-assignment`** — Assignment board (drag to personnel lanes).  
- **`/agent?board=company`** — Company board.  
- **`/agent?board=ticket`** — Ticket board.  
- **`/agent?board=kpi`** — Task board + **Task Definition** console.  
- **`/admin/escalation-triggers`** — **Priority alerts** (escalation configuration).  
- **`/insights`** — Metrics & reports.  
- **`/process`** — Process / lifecycle reference.  
- **`/reports`** — Reporting views as implemented.  
- **`/api/brand/logo`** — Serves the configured brand logo from `BRAND_LOGO_PATH` or bundled fallback.

### 7.2 SLA sweep  

- **`POST /api/sla/sweep`** (secured; Admin context) — scans unresolved tickets and refreshes reporting paths. Current transfer/escalation movement is not automatic; personnel submit transfer requests for reviewer approval.  

### 7.3 Accounts  

- **`/admin/account-management`** — Redirects to **Settings → User Management**. Portal account administration (account creation, role/company updates, roster sync, assignment colors, request review) lives there and in Workforce → Org. Chart.

---

## 8) Account security (My Account)  

All roles with portal access use **`/admin/account`** (Security tab).  

The account area includes **Profile**, **Security**, and **Billing** tabs. Billing is present as a UI area only; ticket operations are managed through the ticket and reporting pages.

### Profile image

Upload a profile image from **`/admin/account`** → **Profile**. Supported formats are **PNG**, **JPG**, and **WEBP**, up to **10MB**. After upload, drag/zoom the framing and save it.

### Change username  

1. Security tab → new username, current password → **Update username**.  
2. You are signed out; sign in with the new username.  
3. Rules: length and character constraints shown in UI.  

### Change email / password  

Similar pattern: confirm current password; after success, **sign in again** with new credentials.  

### Account requests  

Suspension, deletion, or password reset requests may be submitted for admin review. Approved password reset requests reset the portal password to the configured default reset value.  

---

## 9) Troubleshooting  

| Symptom | What to try |
|---------|-------------|
| Cannot sign in | Verify credentials, caps lock, Google sign-in status if used, and account active state. |
| “Forbidden” or missing menu | Your **role** may not include that feature — contact Admin. |
| Cannot create new ticket | Complete **pending resolved** verification/rating on existing ticket. |
| Email link expired / invalid | Request staff to re-send resolution flow or open ticket in portal. |
| Cannot move ticket to In progress | Set **priority** above **Set Priority Level (UNSET)**. |
| Ticket shows Transfer pending | A selected Admin/SuperAdmin reviewer must approve the transfer request. |
| Task stuck in Delayed (IT Project) | Complete overdue sub-tasks or correct actual/due dates. |
| Cannot edit KPI checklist | Confirm you are the assignee; IT Project requires per-sub-task actual dates. |
| Database / deploy errors | Check **`DATABASE_URL`**, run Prisma migrate or push, rebuild, restart PM2. |

---

## 10) Quick reference — URLs  

| Path | Description |
|------|-------------|
| `/signin` | Sign in |
| `/signup` | Self-registration (if enabled) |
| `/` | Customer dashboard or admin ticket dashboard |
| `/my-tickets` | Customer active tickets |
| `/my-requests` | Personnel ticket dashboard |
| `/tickets/new` | New ticket |
| `/tickets/knowledge` | Knowledge base |
| `/tickets/[id]` | Ticket detail |
| `/tickets/[id]/verification` | Resolution verification |
| `/tickets/[id]/rate` | Rating / feedback |
| `/agent` | Staff boards (default ticket view) |
| `/agent?board=ticket` | Ticket board |
| `/agent?board=kpi` | Task board |
| `/agent?board=company` | Company board (admin) |
| `/agent/tickets/[id]` | Staff ticket workspace |
| `/admin/manual-assignment` | Assignment board |
| `/admin/ticket-requests` | Admin create requests |
| `/insights` | Metrics & reports |
| `/process` | Process / lifecycle info |
| `/reports` | Admin/SuperAdmin executive reporting |
| `/admin/workforce` | Workforce (personnel registry + live activity) |
| `/admin/escalation-triggers` | Priority alerts |
| `/admin/account-management` | Redirects to Workforce portal-account admin |
| `/admin/account` | My Account & security |
| `/api/brand/logo` | Current brand logo asset |

---

*End of document.*  
