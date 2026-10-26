/** Structured changelog body stored in PatchNote.content (JSONB). */
export type PatchNoteContentItem = {
  title: string;
  description: string;
};

/**
 * Preferred shape: `{ newFeatures, bugFixes, ...otherSections }`.
 * Legacy flat arrays are still accepted by the parser.
 */
export type PatchNoteContentSections = {
  newFeatures?: PatchNoteContentItem[];
  improvements?: PatchNoteContentItem[];
  bugFixes?: PatchNoteContentItem[];
  [sectionKey: string]: PatchNoteContentItem[] | undefined;
};

/** Normalized section for UI rendering. */
export type PatchNoteSection = {
  key: string;
  label: string;
  items: PatchNoteContentItem[];
};

export type PatchNoteSeed = {
  version: string;
  title: string;
  releasedAt: string;
  content: PatchNoteContentSections;
};

export const PATCH_NOTE_SEEDS: PatchNoteSeed[] = [
  {
    version: "0.7.0",
    title: "Work area: Tasks & Projects split, Job Orders stay requests",
    releasedAt: "2026-10-19T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Work area",
          description:
            "The sidebar's Work entry opens Tasks and Projects as separate tabs (/work/tasks, /work/projects). Old /agent/tasks links redirect to Work → Tasks.",
        },
        {
          title: "Projects board",
          description:
            "Projects have their own status board (Pending, On Going, Finalizing, Done) with phases, items, and target dates. Create projects from Work → Projects.",
        },
        {
          title: "Work Plans tab",
          description:
            "Work → Work Plans lists every work plan visible to you with approvals and check-ins. Dashboard approvals open the plan directly. Travel Orders is now the guard gate-pass kiosk.",
        },
        {
          title: "Request Reports and Work Reports",
          description:
            "Requests → Reports shows volume by type, throughput, SLA compliance, aging, CSAT, and closed by assignee. Work → Reports has separate Tasks, Projects, and Work Plans lenses; Tasks includes KPI performance (pillars, employees, teams) for admins. Both use the company from the sidebar switcher, date presets (Last 7 / 30 days, This month, This quarter, Custom), an optional Team filter, and export CSV (Admin). Filters live in the URL and are remembered when you come back to Reports.",
        },
      ],
      improvements: [
        {
          title: "Metrics & Reports retired",
          description:
            "Its request metrics moved to Requests → Reports and its task KPI metrics to Work → Reports → Tasks. Old /insights and /reports links redirect to the new pages.",
        },
        {
          title: "Dashboard queue first",
          description:
            "Home leads with Needs your action plus actionable cards (pending approvals, tasks due, projects at risk). The separate Overdue list was removed — overdue shows as badges.",
        },
        {
          title: "Task create form is tasks-only",
          description:
            "Add Task no longer offers a Project type. Recurrence, schedule, KPI periods, and verification stay on tasks; phases and timelines live on projects.",
        },
      ],
      other: [
        {
          title: "Projects are not created from Job Orders",
          description:
            "Job Orders are requests only. The \"Link Task Board task\" panel, create-project-from-JO flow, and \"Request Task Project\" handoff were removed. Job Order KPI credit goes to the execution assignee and co-workers. Older tasks created from a Job Order show a read-only \"Origin J.O.\" reference.",
        },
      ],
      bugFixes: [],
    },
  },
  {
    version: "0.6.1",
    title: "Travel Order two-page UI & confirm sync",
    releasedAt: "2026-07-28T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Travel Order two-page form",
          description:
            "Create and review Field Assignment travel orders across two pages with tab and Back/Next navigation for request details and summary.",
        },
        {
          title: "Confirm-time KPI finalize",
          description:
            "When a travel order is confirmed, Field Assignment KPI completion is recorded from location progress and the linked task is marked done when ready.",
        },
        {
          title: "Travel Order merge sync",
          description:
            "Confirmed travel orders, locations, and travelers sync into the merge database so confirm timestamps and status stay available for reporting.",
        },
      ],
      improvements: [
        {
          title: "Travel Order request & summary panels",
          description:
            "Request and summary UIs are clearer for editing locations, travelers, and status while working Field Assignment tasks.",
        },
        {
          title: "Efficiency refresh after confirm",
          description:
            "Personnel efficiency KPIs recompute in the background after a travel order is confirmed so Insights stay current.",
        },
        {
          title: "Patch Notes version dropdowns",
          description:
            "Patch Notes opens as a list of version dropdowns (0.6.1, 0.6.0, 0.5.0, …) so you expand only the release you want to read. SuperAdmin-only in the header.",
        },
      ],
      bugFixes: [],
    },
  },
  {
    version: "0.6.0",
    title: "Request-type intake, RFP routing & peer transfer",
    releasedAt: "2026-07-27T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Request-type intake",
          description:
            "Choose Issue/Concern Ticket, Request for Payment (R.F.P.), Item Requisition Slip (R.S.), Fund Transfer Request (F.T.R.), or Job Order (J.O.) before filling out the create form.",
        },
        {
          title: "Request for Payment procedural routing",
          description:
            "R.F.P. requests move through Noted By, Approved By, Prepared by Bookkeeper, and Approved By Accounting. Approvers are chosen on the form; the request is not green-lit until all four mark Done.",
        },
        {
          title: "Item Requisition & Fund Transfer approvals",
          description:
            "R.S. and F.T.R. requests follow their own approval steps so supply and fund-transfer work is tracked separately from tickets.",
        },
        {
          title: "Job Order ↔ Project linking",
          description:
            "Link a Job Order to a Task Board project so project work and the related job order stay connected.",
        },
        {
          title: "Peer transfer accept / decline",
          description:
            "Transfer a request to a colleague with accept or decline, instead of only using admin-style reassignment.",
        },
        {
          title: "Optional subtask remarks",
          description:
            "Add remarks when creating or editing sub-tasks, and see them on the task board.",
        },
      ],
      improvements: [
        {
          title: "Send Request To company routing",
          description:
            "New requests route by the selected company so the correct team queue and board see the work.",
        },
        {
          title: "Request Board scoping for R.F.P.",
          description:
            "Personnel see RFPs awaiting their current approval role even when the board assignee has not been synced yet.",
        },
        {
          title: "Subtask-assignee task boards",
          description:
            "Operators who are only a subtask helper now see those tasks on their board, not only main-task assignees.",
        },
        {
          title: "Issue/Concern intake lock timing",
          description:
            "Issue/Concern intake stays editable until the request is assigned, in progress, or for confirmation.",
        },
        {
          title: "Cancel request control",
          description:
            "Requestors can cancel eligible requests from the ticket/request surfaces when the workflow allows it.",
        },
      ],
      bugFixes: [
        {
          title: "Merged login and On Duty clock sync",
          description:
            "HRIS credentials and On Duty clock display heal correctly, including Taipei-time handling for duty status.",
        },
        {
          title: "Staff assignment colors and merge DB writes",
          description:
            "Assignment colors and secondary merge-database writes stay consistent when updating personnel and ticket assignees.",
        },
        {
          title: "R.F.P. peso formatting",
          description:
            "Payment amounts format as pesos so R.F.P. values are easier to read during intake and approval.",
        },
      ],
    },
  },
  {
    version: "0.5.0",
    title: "Field Assignment travel orders & task board ops",
    releasedAt: "2026-07-24T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Field Assignment travel orders",
          description:
            "Create travel orders on Field Assignment tasks with locations, vehicle, co-travelers, attachments, and submit-done flow for field work.",
        },
        {
          title: "Hierarchical travel-order approvals",
          description:
            "Configure multi-level approvers, including optional seats that skip the required chain and never finish the order alone — every required approver must still approve.",
        },
        {
          title: "Location Start / End GPS",
          description:
            "Capture start and end GPS on travel-order locations with map picking so field visits are tracked on site.",
        },
        {
          title: "Dedicated Tasks board",
          description:
            "Open Operations → Tasks for assignment-board task details, travel-order summaries, and segmented subtask kanban updates.",
        },
      ],
      improvements: [
        {
          title: "Operations / Tickets / Tasks navigation",
          description:
            "Staff chrome clarifies Operations, Tickets, and Tasks so field assignment work is easier to find from the header and sidebar.",
        },
        {
          title: "Travel-order notifications",
          description:
            "Pending approvals and travel-order status updates surface in notifications so approvers and travelers stay in sync.",
        },
        {
          title: "Copy subtask across segments",
          description:
            "Copy a subtask into another segment from the manager popup instead of recreating it by hand.",
        },
      ],
      bugFixes: [
        {
          title: "Segmented subtask board updates",
          description:
            "Segmented checklists keep clearer kanban columns and manager fields when editing Field Assignment and related tasks.",
        },
      ],
    },
  },
  {
    version: "0.4.1",
    title: "Seek Assistance, roster search & branding",
    releasedAt: "2026-07-18T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Seek Assistance on the main task",
          description:
            "Request help from the main-task or segment modal with a dedicated Seek Assistance dialog, instead of hunting for it only on individual sub-tasks.",
        },
        {
          title: "Personnel and Activities roster search",
          description:
            "Filter staff lists by name or email on Personnel and Activities so you can find people faster in large rosters.",
        },
      ],
      improvements: [
        {
          title: "Workforce Productivity Dashboard branding",
          description:
            "Staff surfaces use Workforce Productivity Dashboard branding with a simpler admin header and sidebar chrome.",
        },
        {
          title: "On Duty panel clarity",
          description:
            "The On Duty panel is easier to scan when assigning work from today's clocked-in roster.",
        },
      ],
      bugFixes: [
        {
          title: "Seek Assistance hard to reach on complex tasks",
          description:
            "Assistance can be requested from the elevated main-task / segment controls so helpers unlock without digging through every sub-task row.",
        },
      ],
    },
  },
  {
    version: "0.3.0",
    title: "Sub-task managers & recurrence rollover",
    releasedAt: "2026-07-17T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Sub-task manager popups",
          description:
            "Add and edit sub-tasks from dedicated popups on create and on the Task Board, instead of managing long inline lists.",
        },
        {
          title: "Unified Project create flow",
          description:
            "Projects use the same task-group and sub-task path as normal tasks. You no longer have to force the IT PROJECT IMPLEMENTATION pillar when creating a project.",
        },
        {
          title: "Sub-task REST endpoints",
          description:
            "Create and update individual sub-tasks through dedicated KPI maintenance routes used by the new manager popups.",
        },
      ],
      improvements: [
        {
          title: "Cleaner task create UI",
          description:
            "Draft sub-tasks open in a focused popup with clearer fields for title, description, priority, and due date.",
        },
      ],
      bugFixes: [
        {
          title: "Weekly tasks stayed DONE until the next calendar day",
          description:
            "Weekly recurring checklists now roll back to CURRENT as soon as every sub-task is complete, so the next cycle starts immediately.",
        },
        {
          title: "Monthly tasks stayed DONE until the next calendar day",
          description:
            "Monthly recurring checklists now recur immediately on full completion instead of waiting overnight before resetting.",
        },
        {
          title: "Quarterly tasks stayed DONE until the next calendar day",
          description:
            "Quarterly recurring checklists now roll over to the next period right when they hit DONE.",
        },
        {
          title: "Project create forced IT PROJECT IMPLEMENTATION",
          description:
            "Creating a Project no longer locks the task group to IT PROJECT IMPLEMENTATION. Pick any task group and attach sub-tasks like a normal one-off task.",
        },
      ],
    },
  },
  {
    version: "0.2.0",
    title: "Task Management & Personnel Updates",
    releasedAt: "2026-07-16T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Subtask helper assignees",
          description:
            "When creating a task or project you can turn off subtask assignees. The main assignee can later press Seek Assistance to unlock a helper for a specific subtask.",
        },
        {
          title: "IT project start, end, and delay penalties",
          description:
            "IT project subtasks now support Start/End and daily delay penalties when work runs past the due date, with clearer progress on company metrics.",
        },
        {
          title: "Patch Notes history",
          description:
            "Open Patch Notes from the header to see every release, grouped by new features and bug fixes.",
        },
      ],
      improvements: [
        {
          title: "Personnel roster from merge database",
          description:
            "The Personnel page loads HRIS employees from your secondary merge database (including mergeddatabase-dev) and shows the real database name in the UI.",
        },
        {
          title: "On Duty from clock-ins",
          description:
            "Activities and assignment lists use today's merged clock-ins so only On Duty people appear as available assignees.",
        },
      ],
      bugFixes: [
        {
          title: "Empty Personnel roster on mergeddatabase-dev",
          description:
            "HRIS rows tagged hris-dev are included again so the Personnel page is not blank against the dev merge database.",
        },
        {
          title: "Enable Subtask Assignees toggle was ignored",
          description:
            "Unchecking Enable Subtask Assignees now hides helper assignee dropdowns until Seek Assistance unlocks a subtask.",
        },
        {
          title: "Seek Assistance still required when helpers were disabled",
          description:
            "With subtask assignees turned off at create time, helpers stay locked until the main assignee explicitly requests assistance.",
        },
      ],
    },
  },
  {
    version: "0.1.0",
    title: "Initial Command Center release",
    releasedAt: "2026-06-01T00:00:00.000Z",
    content: {
      newFeatures: [
        {
          title: "Ticket queue and assignment",
          description:
            "Staff can view, claim, and work tickets from the help desk queue with company-aware routing.",
        },
        {
          title: "Task and KPI boards",
          description:
            "Managers can define recurring tasks and projects, assign them to personnel, and track completion on the board.",
        },
        {
          title: "Personnel and roles",
          description:
            "Admins can manage staff roles and company queues so the right people see the right work.",
        },
      ],
      bugFixes: [],
    },
  },
];

/** @deprecated Prefer PATCH_NOTE_SEEDS — kept for older ensure scripts. */
export const DEFAULT_PATCH_NOTE_SEED = PATCH_NOTE_SEEDS[0]!;
