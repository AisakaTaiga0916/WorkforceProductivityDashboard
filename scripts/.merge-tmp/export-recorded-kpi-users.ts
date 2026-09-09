import { writeFileSync } from "node:fs";
import { prismaPrimary } from "../../src/lib/prisma";

type Contrib = { id?: string; name?: string; role?: string; total?: number; done?: number };

type SnapshotRow = {
  id: string;
  period_key: string;
  frequency: string;
  total: number;
  done: number;
  missing: number;
  percent: number;
  fully_complete: boolean;
  captured_at: Date;
  contributor_progress: unknown;
  kpi_title: string;
  main_task: string | null;
  assigned_agent_id: string | null;
  assigned_name: string | null;
  company_name: string | null;
};

async function main() {
  const rows = await prismaPrimary.$queryRaw<SnapshotRow[]>`
    SELECT
      s.id,
      s.period_key,
      s.frequency::text AS frequency,
      s.total,
      s.done,
      s.missing,
      s.percent,
      s.fully_complete,
      s.captured_at,
      s.contributor_progress,
      km.title AS kpi_title,
      km.main_task,
      km.assigned_agent_id,
      a.name AS assigned_name,
      COALESCE(t.name, at.name) AS company_name
    FROM kpi_maintenance_period_snapshots s
    JOIN kpi_maintenance km ON km.id = s.kpi_maintenance_id
    LEFT JOIN agents a ON a.id = km.assigned_agent_id
    LEFT JOIN teams t ON t.id = km.scoped_company_team_id
    LEFT JOIN teams at ON at.id = a.team_id
    ORDER BY s.captured_at DESC
  `;

  type OutRow = {
    userName: string;
    agentId: string | null;
    company: string | null;
    role: string;
    kpiTitle: string;
    mainTask: string | null;
    frequency: string;
    periodKey: string;
    total: number;
    done: number;
    remaining: number;
    percent: number;
    fullyComplete: boolean;
    capturedAt: string;
    source: "contributor" | "assignee-fallback";
  };

  const out: OutRow[] = [];

  for (const row of rows) {
    let contribs: Contrib[] = [];
    const raw = row.contributor_progress;
    if (Array.isArray(raw)) contribs = raw as Contrib[];
    else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) contribs = parsed;
      } catch {
        /* ignore */
      }
    }

    const usable = contribs.filter(
      (c) => (c.name && c.name.trim()) || (c.id && String(c.id).trim()),
    );

    if (usable.length > 0) {
      for (const c of usable) {
        const total = Number(c.total ?? 0);
        const done = Number(c.done ?? 0);
        out.push({
          userName: (c.name ?? "Unknown").trim() || "Unknown",
          agentId: c.id ? String(c.id) : null,
          company: row.company_name,
          role: (c.role ?? "Contributor").trim() || "Contributor",
          kpiTitle: row.kpi_title,
          mainTask: row.main_task,
          frequency: row.frequency,
          periodKey: row.period_key,
          total,
          done,
          remaining: Math.max(0, total - done),
          percent: total > 0 ? Math.round((done / total) * 1000) / 10 : Number(row.percent) || 0,
          fullyComplete: total > 0 && done >= total,
          capturedAt: row.captured_at.toISOString(),
          source: "contributor",
        });
      }
    } else if (row.assigned_name || row.assigned_agent_id) {
      out.push({
        userName: row.assigned_name ?? "Unassigned",
        agentId: row.assigned_agent_id,
        company: row.company_name,
        role: "Assignee",
        kpiTitle: row.kpi_title,
        mainTask: row.main_task,
        frequency: row.frequency,
        periodKey: row.period_key,
        total: Number(row.total),
        done: Number(row.done),
        remaining: Number(row.missing),
        percent: Number(row.percent),
        fullyComplete: Boolean(row.fully_complete),
        capturedAt: row.captured_at.toISOString(),
        source: "assignee-fallback",
      });
    }
  }

  // Per-user summary
  const byUser = new Map<
    string,
    {
      userName: string;
      company: string | null;
      recordings: number;
      totalItems: number;
      doneItems: number;
      kpiTitles: Set<string>;
      frequencies: Set<string>;
      lastCaptured: string;
    }
  >();

  for (const r of out) {
    const key = r.agentId ?? r.userName.toLowerCase();
    const cur = byUser.get(key) ?? {
      userName: r.userName,
      company: r.company,
      recordings: 0,
      totalItems: 0,
      doneItems: 0,
      kpiTitles: new Set<string>(),
      frequencies: new Set<string>(),
      lastCaptured: r.capturedAt,
    };
    cur.recordings += 1;
    cur.totalItems += r.total;
    cur.doneItems += r.done;
    cur.kpiTitles.add(r.kpiTitle);
    cur.frequencies.add(r.frequency);
    if (r.capturedAt > cur.lastCaptured) cur.lastCaptured = r.capturedAt;
    if (!cur.company && r.company) cur.company = r.company;
    byUser.set(key, cur);
  }

  const users = [...byUser.values()]
    .map((u) => ({
      userName: u.userName,
      company: u.company,
      recordings: u.recordings,
      kpiCount: u.kpiTitles.size,
      totalItems: u.totalItems,
      doneItems: u.doneItems,
      percent:
        u.totalItems > 0 ? Math.round((u.doneItems / u.totalItems) * 1000) / 10 : 0,
      frequencies: [...u.frequencies].sort().join(", "),
      lastCaptured: u.lastCaptured,
    }))
    .sort((a, b) => b.recordings - a.recordings || a.userName.localeCompare(b.userName));

  // Keep detail rows manageable: latest period per user+kpi+frequency if huge
  out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.userName.localeCompare(b.userName));

  const payload = {
    generatedAt: new Date().toISOString(),
    snapshotCount: rows.length,
    recordingRows: out.length,
    userCount: users.length,
    users,
    // Cap detail for canvas size: top 800 most recent recordings
    details: out.slice(0, 800),
  };

  const outPath = "scripts/.merge-tmp/recorded-kpi-users.json";
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(
    JSON.stringify(
      {
        snapshotCount: payload.snapshotCount,
        recordingRows: payload.recordingRows,
        userCount: payload.userCount,
        outPath,
        topUsers: users.slice(0, 15),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
