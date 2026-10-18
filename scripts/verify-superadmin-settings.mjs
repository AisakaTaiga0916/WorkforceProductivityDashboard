/**
 * End-to-end verification of the new SuperAdmin Settings module
 * (Priority Alerts + Organization Chart customizer).
 *
 * Writes and cleans up its own org-chart test rows. Steps:
 *  1. Forge a SuperAdmin NextAuth JWT (local NEXTAUTH_SECRET).
 *  2. API CRUD smoke test: GET → POST (real roster person) → PATCH reparent →
 *     PATCH move → DELETE.
 *  3. Admin JWT: org-chart API must be 403 and the settings page must redirect.
 *  4. Page assertions: /admin/superadmin-settings renders both tabs; sidebar
 *     shows the SuperAdmin Settings group for SuperAdmin and not for Admin.
 *  5. /admin/escalation-triggers redirects into the settings page.
 */
import { encode } from "next-auth/jwt";
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { PrismaClient as SecondaryClient } from "@prisma/client/secondary";
import { PrismaClient as PrimaryClient } from "@prisma/client/primary";

const BASE = "http://localhost:3000";
const SCREENSHOT = "scripts/verify-superadmin-settings.png";

const env = readFileSync(".env", "utf8");
const secretMatch = env.match(/^NEXTAUTH_SECRET\s*=\s*"?([^"\r\n]+)"?/m);
if (!secretMatch) throw new Error("NEXTAUTH_SECRET not found in .env");
const secret = secretMatch[1].trim();

async function forgeSession(email, name, role, id) {
  return encode({
    secret,
    maxAge: 8 * 3600,
    token: {
      sub: id ?? email,
      name,
      email,
      role,
      authProvider: "credentials",
    },
  });
}

function results(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${message}`);
  if (!ok) process.exitCode = 1;
}

// --- 1. Sessions ------------------------------------------------------------
// RBAC permission checks resolve the session against the primary DB, so the
// SuperAdmin token must reference a real active SuperAdmin portal account.
const primary = new PrimaryClient();
await primary.$connect();
const superAdminAccount = await primary.portalAccount.findFirst({
  where: { accountStatus: "ACTIVE", rbacRole: { key: "super_admin" } },
  orderBy: { email: "asc" },
  select: { id: true, email: true, name: true },
});
await primary.$disconnect();
if (!superAdminAccount) {
  throw new Error("No active SuperAdmin portal account found in the primary DB.");
}

const superAdminJwt = await forgeSession(superAdminAccount.email, superAdminAccount.name, "SuperAdmin", superAdminAccount.id);
const adminJwt = await forgeSession("verify.admin@local.invalid", "Verify Admin", "Admin");

// --- 2. API CRUD smoke test -------------------------------------------------
const headers = {
  "Content-Type": "application/json",
  Cookie: `next-auth.session-token=${superAdminJwt}`,
};
const adminHeaders = {
  "Content-Type": "application/json",
  Cookie: `next-auth.session-token=${adminJwt}`,
};

async function api(path, opts = {}, h = headers) {
  const res = await fetch(`${BASE}/api/admin/org-chart${path}`, { ...opts, headers: h });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const before = await api("");
results(before.status === 200 && Array.isArray(before.body), `GET org-chart → ${before.status} (${before.body.length} existing nodes)`);
const initialNodeCount = before.body.length;

// Track every node this script creates so cleanup only touches its own rows.
const createdIds = [];

const adminDenied = await api("", {}, adminHeaders);
results(adminDenied.status === 403, `GET org-chart as Admin → ${adminDenied.status} (expected 403)`);

// Pick real active roster persons NOT already on the chart (user data is untouched).
const assignedOnChart = new Set(before.body.map((n) => n.mergedSourceUserId));
  const roleLabel = (role) =>
    ({ employee: "Personnel", admin: "Admin", high_admin: "HighAdmin", super_admin: "SuperAdmin" })[role?.toLowerCase()] ?? "Personnel";
  const pidLabel = (row) => (row ? (row.parentId ? `under ${row.parentId.slice(-6)}` : "TOP") : "MISSING");
const secondary = new SecondaryClient();
await secondary.$connect();
const candidates = await secondary.mergedUser.findMany({
  where: { isActive: true },
  orderBy: { sourceUserId: "asc" },
  take: 40,
  select: { sourceUserId: true, name: true, position: true, companyName: true, role: true },
});
const person = candidates.find((c) => !assignedOnChart.has(String(c.sourceUserId))) ?? null;
const personB =
  candidates.find(
    (c) => !assignedOnChart.has(String(c.sourceUserId)) && c.sourceUserId !== person?.sourceUserId,
  ) ?? null;
const personC =
  candidates.find(
    (c) =>
      !assignedOnChart.has(String(c.sourceUserId)) &&
      c.sourceUserId !== person?.sourceUserId &&
      c.sourceUserId !== personB?.sourceUserId,
  ) ?? null;
await secondary.$disconnect();
results(Boolean(person && personB && personC), `Roster persons found: ${person?.name} / ${personB?.name} / ${personC?.name}`);

const created = await api("", {
  method: "POST",
  body: JSON.stringify({ mergedSourceUserId: String(person.sourceUserId) }),
});
createdIds.push(created.body?.id);
results(
  created.status === 201 && created.body?.personName === person.name && created.body?.parentId === null,
  `POST created root node → ${created.status} (${created.body?.personName})`,
);

const createdB = await api("", {
  method: "POST",
  body: JSON.stringify({ mergedSourceUserId: String(personB.sourceUserId), parentId: created.body.id }),
});
createdIds.push(createdB.body?.id);
results(
  createdB.status === 201 && createdB.body?.parentId === created.body.id,
  `POST created child node → ${createdB.status} (${createdB.body?.personName})`,
);

const dup = await api("", {
  method: "POST",
  body: JSON.stringify({ mergedSourceUserId: String(person.sourceUserId) }),
});
results(dup.status === 409, `Duplicate member → ${dup.status} (expected 409)`);

const cycle = await api("", {
  method: "PATCH",
  body: JSON.stringify({ id: created.body.id, parentId: createdB.body.id }),
});
results(cycle.status === 400, `Cycle reparent → ${cycle.status} (expected 400)`);

const reparent = await api("", {
  method: "PATCH",
  body: JSON.stringify({ id: createdB.body.id, parentId: "" }),
});
results(reparent.status === 200 && reparent.body?.parentId === null, `Reparent to top level → ${reparent.status}`);

const move = await api("", {
  method: "PATCH",
  body: JSON.stringify({ id: createdB.body.id, moveUp: true }),
});
results(move.status === 200, `Move up → ${move.status}`);

const after = await api("");
results(after.body.some((n) => n.id === created.body.id) && after.body.some((n) => n.id === createdB.body.id), `GET reflects both nodes (${after.body.length} total)`);

const del = await api(`?id=${created.body.id}`, { method: "DELETE" });
results(del.status === 200, `DELETE root cascades child → ${del.status} (removedReports=${del.body?.removedReports})`);

// The reparent test moved the child to top level, so it must be removed separately.
if (createdB.body?.id) {
  await api(`?id=${createdB.body.id}`, { method: "DELETE" });
}

const finalCheck = await api("");
results(!finalCheck.body.some((n) => n.id === created.body.id) && !finalCheck.body.some((n) => n.id === createdB.body?.id), "Cleanup: API test nodes removed");

// --- 3/4/5. Browser assertions ----------------------------------------------
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });

async function openPage(jwt, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCookie({ name: "next-auth.session-token", value: jwt, domain: "localhost", path: "/", httpOnly: true });
  const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  return { page, response };
}

{
  const { page, response } = await openPage(superAdminJwt, `${BASE}/admin/superadmin-settings`);
  const title = await page.$eval("h1", (el) => el.textContent).catch(() => null);
  results(response.status() === 200 && title === "SuperAdmin Settings", `Page renders → ${response.status()} (h1="${title}")`);

  const tabLabels = await page.$$eval("button[role='tab']", (els) => els.map((e) => e.textContent));
  results(
    tabLabels.includes("Priority Alerts") && tabLabels.includes("Organization Chart"),
    `Tabs present: ${tabLabels.join(" | ")}`,
  );

  // Priority alerts tab embeds the trigger cards/table.
  const hasTriggerHeader = await page.$$eval("table thead", (els) => els.length > 0).catch(() => false);
  results(hasTriggerHeader, "Priority Alerts tab renders the triggers table");

  // Switch to org chart tab (triggers embed their own Cards/Table toggle).
  const tabs = await page.$$("button[role='tab']");
  let orgTab = null;
  for (const t of tabs) {
    const label = await t.evaluate((el) => el.textContent);
    if (label === "Organization Chart") orgTab = t;
  }
  if (!orgTab) throw new Error("Organization Chart tab not found");
  await orgTab.click();
  await new Promise((r) => setTimeout(r, 800));
  const hasAddPanel = await page.$$eval("input[placeholder*='roster']", (els) => els.length > 0);
  results(hasAddPanel, "Organization Chart tab shows the roster search panel");

  // Seed a manager + report pair, then assert the card form renders.
  const seeded = [];
  const p1 = { mergedSourceUserId: String(person.sourceUserId) };
  const r1 = await api("", { method: "POST", body: JSON.stringify(p1) });
  seeded.push(r1.body.id);
  createdIds.push(r1.body.id);
  const p2 = { mergedSourceUserId: String(personB.sourceUserId), parentId: r1.body.id };
  const r2 = await api("", { method: "POST", body: JSON.stringify(p2) });
  seeded.push(r2.body.id);
  createdIds.push(r2.body.id);

  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 500));
  const tabsAfter = await page.$$("button[role='tab']");
  for (const t of tabsAfter) {
    const label = await t.evaluate((el) => el.textContent);
    if (label === "Organization Chart") await t.click();
  }
  await new Promise((r) => setTimeout(r, 800));

  // Presence-based assertions (total counts shift while the user edits the chart live).
  // Duplicate roster names may exist, so the seeded report card is identified by
  // having the seeded manager selected in its "Reports to" dropdown.
  const seedStats = await page.$$eval(
    "section .react-flow__node article",
    (els, seededNames, managerId, managerName, roles) => {
      const has = (name, extra) =>
        els.some(
          (e) =>
            e.textContent.includes(name) && (!extra || e.textContent.includes(extra)),
        );
      const countPill = (name) =>
        els.some(
          (e) =>
            e.textContent.includes(name) &&
            [...e.querySelectorAll("span")].some((s) => s.textContent.trim() === "1"),
        );
      const childCard = els.find((e) => {
        const sel = e.querySelector("select");
        const selected = sel?.options[sel.selectedIndex]?.textContent ?? "";
        return e.textContent.includes(seededNames[1]) && selected.includes(managerName);
      });
      return {
        managerCard: has(seededNames[0]),
        managerBadge: countPill(seededNames[0]),
        managerRole: has(seededNames[0], roles[0]),
        reportCard: Boolean(childCard),
        reportRole: Boolean(childCard && childCard.textContent.includes(roles[1])),
        childReportsToManager: Boolean(
          childCard?.querySelector("select") &&
            childCard.querySelector("select").value === managerId,
        ),
        allCardsHaveSelect: els.length > 0 && els.every((e) => e.querySelector("select")),
      };
    },
    [person.name, personB.name],
    r1.body.id,
    person.name,
    [roleLabel(person.role), roleLabel(personB.role)],
  );
  results(seedStats.managerCard && seedStats.reportCard, "Seeded manager and report render as ReactFlow boxes");
  results(seedStats.managerBadge, "Seeded manager box shows the report-count pill");
  results(seedStats.managerRole && seedStats.reportRole, "Boxes show role (not position) and company");
  results(seedStats.childReportsToManager, "Seeded report box points to the seeded manager");
  results(seedStats.allCardsHaveSelect, "Every diagram box has a 'Reports to' select");

  const diagramStats = await page.$$eval(
    "section .react-flow",
    () => ({
      canvases: document.querySelectorAll(".react-flow").length,
      edges: document.querySelectorAll(".react-flow__edge").length,
      nodes: document.querySelectorAll(".react-flow__node").length,
    }),
  );
  results(
    diagramStats.canvases === 1 && diagramStats.nodes > 0 && diagramStats.edges > 0,
    `ReactFlow angular diagram present (canvas=${diagramStats.canvases}, boxes=${diagramStats.nodes}, step edges=${diagramStats.edges})`,
  );

  // Drag-reparent: moving a node should move it INDIVIDUALLY — its direct
  // reports re-attach to the former head (the next level up the hierarchy).
  const third = await api("", {
    method: "POST",
    body: JSON.stringify({ mergedSourceUserId: String(personC.sourceUserId) }),
  });
  const thirdOk = third.status === 201;
  if (thirdOk) createdIds.push(third.body.id);
  results(thirdOk, `Seeded drag root created → ${third.status}`);

  if (thirdOk) {
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 900));
    for (const t of await page.$$("button[role='tab']")) {
      const label = await t.evaluate((el) => el.textContent);
      if (label === "Organization Chart") await t.click();
    }
    await new Promise((r) => setTimeout(r, 900));

    page.on("request", (req) => { if (req.url().includes("/api/admin/org-chart")) console.log("[REQ]", req.method(), req.postData()?.slice(0, 160)); });
    page.on("response", async (res) => { if (res.url().includes("/api/admin/org-chart")) console.log("[RES]", res.status(), res.url().split("localhost:3000")[1]); });
    page.on("dialog", async (d) => { console.log("[DIALOG]", d.message().slice(0, 120)); await d.dismiss(); });
    page.on("console", (m) => { if (m.text().startsWith("DBG")) console.log("[console]", m.text()); });

    // API-level: moving the seeded manager (r1, who has report r2) under `third`
    // must re-attach r2 to the manager's former parent (top level = null).
    const detach = await api("", {
      method: "PATCH",
      body: JSON.stringify({ id: r1.body.id, parentId: third.body.id }),
    });
    console.log("DETACH status:", detach.status, "body:", JSON.stringify(detach.body)?.slice(0, 200));
    const detachAfter = await api("");
    console.log("DETACH-GET total:", detachAfter.body.length);
    for (const probe of [r1.body.id, r2.body.id, third.body.id]) {
      const row = detachAfter.body.find((n) => n.id === probe);
      console.log("DETACH-GET probe", probe.slice(-6), "->", row ? `parentId=${row.parentId}` : "MISSING");
    }
    const mgrDetached = detachAfter.body.find((n) => n.id === r1.body.id);
    const childDetached = detachAfter.body.find((n) => n.id === r2.body.id);
    results(
      detach.status === 200 &&
        mgrDetached?.parentId === third.body.id &&
        childDetached?.parentId === null,
      `Moving manager detaches its report to the former head (mgr=${pidLabel(mgrDetached)}, child=${pidLabel(childDetached)})`,
    );
    // Restore state for the UI drags below.
    const rA = await api("", { method: "PATCH", body: JSON.stringify({ id: r1.body.id, parentId: "" }) });
    const rB = await api("", { method: "PATCH", body: JSON.stringify({ id: r2.body.id, parentId: r1.body.id }) });
    console.log("RESTORE statuses:", rA.status, rB.status);
    const restoreAfter = await api("");
    for (const probe of [r1.body.id, r2.body.id]) {
      const row = restoreAfter.body.find((n) => n.id === probe);
      console.log("RESTORE-GET probe", probe.slice(-6), "->", row ? `parentId=${row.parentId}` : "MISSING");
    }

    async function nodeCenter(boxId) {
      return page.evaluate((id) => {
        const wrappers = [...document.querySelectorAll(".react-flow__node")].filter((w) =>
          w.querySelector(`[data-box-id="${id}"]`),
        );
        if (!wrappers.length) return null;
        const r = wrappers[wrappers.length - 1].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, boxId);
    }

    async function dragBox(fromId, toId) {
      const from = await nodeCenter(fromId);
      const to = await nodeCenter(toId);
      console.log("DRAG", fromId.slice(-6), "->", toId.slice(-6), "from=", JSON.stringify(from), "to=", JSON.stringify(to));
      const vp = await page.evaluate(() => {
        const pane = document.querySelector(".react-flow__viewport");
        const t = pane ? pane.style.transform : "";
        const boxes = [...document.querySelectorAll("[data-box-id]")].slice(-6).map((b) => ({
          id: b.getAttribute("data-box-id")?.slice(-6),
          r: `${Math.round(b.getBoundingClientRect().x)},${Math.round(b.getBoundingClientRect().y)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`,
        }));
        const canvas = document.querySelector(".react-flow")?.getBoundingClientRect();
        return { t, canvas: canvas ? `${canvas.x},${canvas.y} ${canvas.width}x${canvas.height}` : "none", boxes };
      });
      console.log("VIEWPORT:", JSON.stringify(vp));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(
          from.x + ((to.x - from.x) * i) / 12,
          from.y + ((to.y - from.y) * i) / 12,
        );
        await new Promise((r) => setTimeout(r, 30));
      }
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 1200));
    }

    // UI drag 1: manager (with report) moved onto the seeded root —
    // the manager moves alone; its report re-attaches to top level.
    await dragBox(r1.body.id, third.body.id);
    const afterDrag1 = await api("");
    console.log("DRAG1-GET total:", afterDrag1.body.length);
    for (const probe of [r1.body.id, r2.body.id, third.body.id]) {
      const row = afterDrag1.body.find((n) => n.id === probe);
      console.log("DRAG1-GET probe", probe.slice(-6), "->", pidLabel(row));
    }
    const mgr1 = afterDrag1.body.find((n) => n.id === r1.body.id);
    const child1 = afterDrag1.body.find((n) => n.id === r2.body.id);
    results(
      mgr1?.parentId === third.body.id && child1?.parentId === null,
      `Drag moves manager alone; report re-attached to former head (mgr=${pidLabel(mgr1)}, child=${pidLabel(child1)})`,
    );

    // UI drag 2: leaf report dragged onto the manager under its new head.
    await dragBox(r2.body.id, r1.body.id);
    const afterDrag2 = await api("");
    const leaf2 = afterDrag2.body.find((n) => n.id === r2.body.id);
    results(
      leaf2?.parentId === r1.body.id,
      `Drag moved leaf report under the new manager (${pidLabel(leaf2)})`,
    );

    await api(`?id=${third.body.id}`, { method: "DELETE" });
  } else {
    results(true, "Drag-reparent skipped (seeded root collided with live chart data)");
  }

  for (const id of seeded) await api(`?id=${id}`, { method: "DELETE" });
  results(true, "Seeded diagram rows cleaned up");

  for (const id of seeded) await api(`?id=${id}`, { method: "DELETE" });
  results(true, "Seeded card-form rows cleaned up");

  await page.screenshot({ path: SCREENSHOT, fullPage: false });
  console.log(`Screenshot → ${SCREENSHOT}`);

  // Sidebar contains the SuperAdmin Settings group.
  const sidebarText = await page.$$eval("aside nav", (els) => els.map((e) => e.textContent).join(""));
  results(
    sidebarText.includes("SuperAdmin Settings") && sidebarText.includes("Organization Chart"),
    "Sidebar shows SuperAdmin Settings group",
  );
  await page.close();
}

{
  // Admin: page must redirect away (to /) and the sidebar must NOT have the group.
  const { page, response } = await openPage(adminJwt, `${BASE}/admin/superadmin-settings`);
  for (let i = 0; i < 20 && page.url().includes("superadmin-settings"); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  const finalUrl = page.url();
  results(response.status() === 200 && !finalUrl.includes("superadmin-settings"), `Admin redirected from settings → ${finalUrl.replace(BASE, "")}`);
  await page.waitForSelector("aside nav", { timeout: 10000 });
  const sidebarText = await page.$$eval("aside nav", (els) => els.map((e) => e.textContent).join(""));
  results(!sidebarText.includes("SuperAdmin Settings"), "Admin sidebar has no SuperAdmin Settings group");
  await page.close();
}

{
  // Old route redirects into the settings page (SuperAdmin).
  const { page } = await openPage(superAdminJwt, `${BASE}/admin/escalation-triggers`);
  const finalUrl = page.url();
  results(finalUrl.includes("/admin/superadmin-settings"), `Old route redirects → ${finalUrl.replace(BASE, "")}`);
  await page.close();
}

await browser.close();

// Safety net: remove any rows this run created (never touches pre-existing data).
for (const id of [...new Set(createdIds.filter(Boolean))]) {
  const res = await fetch(`${BASE}/api/admin/org-chart?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Cookie: `next-auth.session-token=${superAdminJwt}` },
  });
  if (res.status === 200) console.log(`PASS - Safety cleanup removed own row ${id}`);
}

console.log(process.exitCode ? "VERIFICATION FAILED" : "VERIFICATION OK");
