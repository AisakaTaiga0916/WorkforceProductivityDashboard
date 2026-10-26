/**
 * Smoke test for the Work split + reports plan (dev server on :3000, read-only).
 *
 *  - Work area: /work redirects, Tasks / Projects / Work Plans / Reports tabs render.
 *  - /travel-orders redirects staff to /work/work-plans.
 *  - Requests → Reports and Work → Reports (each lens) render for SuperAdmin and Personnel.
 *  - CSV exports: SuperAdmin 200 text/csv; Personnel (no reports.export) 403.
 *  - Removed JO → project surfaces return 404 / Unknown action.
 *
 * Usage: node scripts/verify-work-split-reports.mjs
 */
import { encode } from "next-auth/jwt";
import { readFileSync } from "node:fs";
import { PrismaClient as PrimaryClient } from "@prisma/client/primary";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const env = readFileSync(".env", "utf8");
const secret = env.match(/^NEXTAUTH_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1]?.trim();
if (!secret) throw new Error("NEXTAUTH_SECRET not found in .env");

function report(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${message}`);
  if (!ok) process.exitCode = 1;
}

const primary = new PrimaryClient();
const [superAdmin, personnel] = await Promise.all([
  primary.portalAccount.findFirst({
    where: { accountStatus: "ACTIVE", rbacRole: { key: "super_admin" } },
    orderBy: { email: "asc" },
    select: { id: true, email: true, name: true },
  }),
  primary.portalAccount.findFirst({
    where: { accountStatus: "ACTIVE", rbacRole: { key: "employee" }, role: "Personnel" },
    orderBy: { email: "asc" },
    select: { id: true, email: true, name: true },
  }),
]);
await primary.$disconnect();
if (!superAdmin) throw new Error("No active SuperAdmin account in the primary DB.");

async function cookieFor(account, role) {
  const token = await encode({
    secret,
    maxAge: 3600,
    token: { sub: account.id, name: account.name, email: account.email, role, authProvider: "credentials" },
  });
  return `next-auth.session-token=${token}`;
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location") ?? "", body, type: res.headers.get("content-type") ?? "" };
}

async function expectPage(label, path, cookie, needles) {
  const r = await get(path, cookie);
  const missing = needles.filter((n) => !r.body.includes(n));
  report(r.status === 200 && missing.length === 0, `${label} ${path} → ${r.status}${missing.length ? ` missing: ${missing.join(", ")}` : ""}`);
}

/** HTTP redirect, or the meta-refresh Next streams when `redirect()` runs after the layout started. */
async function expectRedirect(label, path, cookie, target) {
  const r = await get(path, cookie);
  const metaTarget = r.body.match(/http-equiv="refresh" content="\d+;url=([^"]+)"/)?.[1] ?? "";
  const ok =
    ([302, 303, 307, 308].includes(r.status) && r.location.includes(target)) ||
    (r.status === 200 && metaTarget.startsWith(target));
  report(ok, `${label} ${path} → ${r.status} ${r.location || metaTarget}`);
}

const sa = await cookieFor(superAdmin, "SuperAdmin");
console.log(`SuperAdmin: ${superAdmin.email}`);

await expectRedirect("SA", "/work", sa, "/work/tasks");
await expectRedirect("SA", "/travel-orders", sa, "/work/work-plans");
await expectPage("SA", "/work/tasks", sa, ["Work"]);
await expectPage("SA", "/work/projects", sa, ["Work"]);
await expectPage("SA", "/work/work-plans", sa, ["Work Plans / Travel Orders visible to you"]);
await expectRedirect("SA", "/insights", sa, "/agent/reports");
await expectRedirect("SA", "/insights?tab=task-metrics", sa, "/work/reports?lens=tasks");
await expectRedirect("SA", "/reports", sa, "/agent/reports");
// No switcher cookie → Super Admin is on "All companies": summary counts only.
const saAll = await get("/agent/reports", sa);
report(
  saAll.status === 200 &&
    saAll.body.includes("All companies: summary counts only") &&
    saAll.body.includes("Resolution SLA") &&
    !saAll.body.includes("Closed by assignee"),
  "SA All companies → summary only (no per-person tables)",
);
const saWorkAll = await get("/work/reports", sa);
report(
  saWorkAll.status === 200 && !saWorkAll.body.includes("KPI performance") && !saWorkAll.body.includes("Load by assignee"),
  "SA All companies Work → summary only",
);

// Shell switcher company (cookie) drives report scope; no company picker in the bar.
const companyId = (
  await new PrimaryClient().company.findFirst({ where: { isActive: true, code: { not: "OUTSIDE" } }, orderBy: { sortOrder: "asc" }, select: { id: true } })
)?.id;
const saCo = `${sa}; wpd_company=${superAdmin.id}:${companyId}`;
await expectPage("SA+company", "/agent/reports", saCo, [
  "Request Reports",
  "Volume by type",
  "Throughput",
  "Aging",
  "Resolution SLA",
  "Customer satisfaction",
  "Closed by assignee",
  "Company:",
]);
const noPicker = await get("/agent/reports", saCo);
report(!noPicker.body.includes('name="company"'), "No company dropdown in the report bar");
await expectPage("SA+company", "/agent/reports?range=7d", saCo, ["Last 7 days"]);
await expectPage("SA+company", "/agent/reports?range=quarter&type=REQUEST_FOR_PAYMENT&status=OPEN", saCo, ["Request Reports"]);
await expectPage("SA+company", "/agent/reports?range=custom&from=2026-01-01&to=2026-10-19", saCo, ["Wk of"]);
await expectPage("SA+company", "/work/reports", saCo, ["Load by assignee", "Overdue aging", "KPI performance", "working days"]);
await expectPage("SA+company", "/work/reports?lens=projects&range=month", saCo, ["At-risk projects", "Delayed phases"]);
await expectPage("SA+company", "/work/reports?lens=work-plans&range=7d", saCo, ["Pending by approval level", "Median cycle"]);

for (const path of [
  "/api/reports/requests/export",
  "/api/reports/work/export?lens=tasks",
  "/api/reports/work/export?lens=projects",
  "/api/reports/work/export?lens=work-plans",
]) {
  const r = await get(path, sa);
  report(r.status === 200 && r.type.includes("text/csv"), `SA export ${path} → ${r.status} ${r.type}`);
}

const removed = await get("/api/tickets/does-not-matter/job-order-project", sa);
report(removed.status === 404, `Removed JO project route → ${removed.status}`);
for (const path of ["/api/kpis", "/api/kpis/metric-companies"]) {
  const gone = await get(path, sa);
  report(gone.status === 404, `Removed old Insights API ${path} → ${gone.status}`);
}
const fromJo = await get("/work/tasks?fromJobOrder=abc", sa);
report(fromJo.status === 200 && !fromJo.body.includes("Creating a Project from Job Order"), "fromJobOrder param is ignored");

if (personnel) {
  const pe = await cookieFor(personnel, "Personnel");
  console.log(`Personnel: ${personnel.email}`);
  await expectRedirect("Personnel", "/travel-orders", pe, "/work/work-plans");
  await expectPage("Personnel", "/agent/reports", pe, ["Request Reports"]);
  await expectPage("Personnel", "/work/reports", pe, ["Load by assignee"]);
  const peTasks = await get("/work/reports", pe);
  report(!peTasks.body.includes("KPI performance"), "Personnel does not see admin KPI performance");
  const exp = await get("/api/reports/requests/export", pe);
  report(exp.status === 403, `Personnel request export (no reports.export) → ${exp.status}`);
  const wexp = await get("/api/reports/work/export?lens=tasks", pe);
  report(wexp.status === 403, `Personnel work export (no reports.export) → ${wexp.status}`);
} else {
  console.log("SKIP - no active Personnel (employee) account for role checks");
}
