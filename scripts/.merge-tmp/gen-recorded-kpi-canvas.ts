import { readFileSync, writeFileSync } from "node:fs";

const d = JSON.parse(
  readFileSync("scripts/.merge-tmp/recorded-kpi-users.json", "utf8"),
);
const companies = [...new Set(d.users.map((u: { company: string | null }) => u.company || "Unscoped"))].sort();
const usersLit = JSON.stringify(d.users, null, 2);
const metaLit = JSON.stringify(
  {
    generatedAt: d.generatedAt,
    snapshotCount: d.snapshotCount,
    recordingRows: d.recordingRows,
    userCount: d.userCount,
    companies,
  },
  null,
  2,
);

const canvas = `import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Select,
  Stack,
  Stat,
  Table,
  Text,
  TextInput,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type UserRow = {
  userName: string;
  company: string | null;
  recordings: number;
  kpiCount: number;
  totalItems: number;
  doneItems: number;
  percent: number;
  frequencies: string;
  lastCaptured: string;
};

const META = ${metaLit} as const;

const USERS: UserRow[] = ${usersLit};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toneForPercent(p: number): "success" | "warning" | "danger" | "neutral" {
  if (p >= 80) return "success";
  if (p >= 50) return "warning";
  if (p > 0) return "danger";
  return "neutral";
}

export default function RecordedKpiUsersCanvas() {
  useHostTheme();
  const [company, setCompany] = useCanvasState<string>("company", "all");
  const [freq, setFreq] = useCanvasState<string>("freq", "all");
  const [query, setQuery] = useCanvasState<string>("query", "");
  const [sort, setSort] = useCanvasState<string>("sort", "recordings");

  const filtered = USERS.filter((u) => {
    if (company !== "all" && (u.company || "Unscoped") !== company) return false;
    if (freq !== "all" && !u.frequencies.split(", ").includes(freq)) return false;
    const q = query.trim().toLowerCase();
    if (
      q &&
      !u.userName.toLowerCase().includes(q) &&
      !(u.company || "").toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  }).sort((a, b) => {
    if (sort === "name") return a.userName.localeCompare(b.userName);
    if (sort === "percent") return b.percent - a.percent || b.recordings - a.recordings;
    if (sort === "recent") return b.lastCaptured.localeCompare(a.lastCaptured);
    return b.recordings - a.recordings || a.userName.localeCompare(b.userName);
  });

  const totalDone = filtered.reduce((s, u) => s + u.doneItems, 0);
  const totalItems = filtered.reduce((s, u) => s + u.totalItems, 0);
  const totalRecordings = filtered.reduce((s, u) => s + u.recordings, 0);
  const avgPercent =
    totalItems > 0 ? Math.round((totalDone / totalItems) * 1000) / 10 : 0;

  const companyOptions = [
    { value: "all", label: "All companies" },
    ...META.companies.map((c) => ({ value: c, label: c })),
  ];

  return (
    <Stack gap={20} style={{ padding: 20 }}>
      <Stack gap={6}>
        <H1>Recorded KPI by user</H1>
        <Text tone="secondary">
          Checklist progress from kpi_maintenance_period_snapshots (contributor_progress),
          with assignee fallback when contributors are empty. Source: ticketing_system_v3-LIVE · Asia/Manila
        </Text>
        <Text tone="tertiary" size="small">
          Generated {fmtWhen(META.generatedAt)} · {META.snapshotCount} snapshots ·{" "}
          {META.recordingRows} recording rows · {META.userCount} users
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value={String(filtered.length)} label="Users shown" />
        <Stat value={String(totalRecordings)} label="Period recordings" />
        <Stat
          value={\`\${avgPercent}%\`}
          label="Weighted done %"
          tone={toneForPercent(avgPercent)}
        />
        <Stat
          value={\`\${totalDone.toLocaleString()} / \${totalItems.toLocaleString()}\`}
          label="Items done / total"
        />
      </Grid>

      <Card>
        <CardHeader>Filters</CardHeader>
        <CardBody>
          <Stack gap={12}>
            <Row gap={12} align="center" wrap>
              <Select value={company} onChange={setCompany} options={companyOptions} />
              <Select
                value={freq}
                onChange={setFreq}
                options={[
                  { value: "all", label: "All frequencies" },
                  { value: "DAILY", label: "Daily" },
                  { value: "MONTHLY", label: "Monthly" },
                ]}
              />
              <Select
                value={sort}
                onChange={setSort}
                options={[
                  { value: "recordings", label: "Sort: recordings" },
                  { value: "percent", label: "Sort: completion %" },
                  { value: "recent", label: "Sort: last captured" },
                  { value: "name", label: "Sort: name" },
                ]}
              />
            </Row>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder="Search name or company…"
            />
          </Stack>
        </CardBody>
      </Card>

      <Callout tone="info">
        Each row is one person across all captured KPI periods. Recordings = snapshot
        attributions; KPIs = distinct KPI titles; Done % = sum(done) / sum(total).
      </Callout>

      <Stack gap={8}>
        <Row align="center" gap={8}>
          <H2>Users</H2>
          <Pill tone="neutral">{filtered.length} shown</Pill>
        </Row>
        <Divider />
        <Table
          headers={[
            "User",
            "Company",
            "Recordings",
            "KPIs",
            "Done / Total",
            "Done %",
            "Cadence",
            "Last captured",
          ]}
          columnAlign={["left", "left", "right", "right", "right", "right", "left", "left"]}
          rows={filtered.map((u) => [
            u.userName,
            u.company || "—",
            String(u.recordings),
            String(u.kpiCount),
            \`\${u.doneItems.toLocaleString()} / \${u.totalItems.toLocaleString()}\`,
            <Pill key={u.userName + u.lastCaptured} tone={toneForPercent(u.percent)}>
              {\`\${u.percent}%\`}
            </Pill>,
            u.frequencies || "—",
            fmtWhen(u.lastCaptured),
          ])}
        />
      </Stack>

      <Text tone="tertiary" size="small">
        Unassigned rows are snapshots with no contributor_progress and no assigned agent.
      </Text>
    </Stack>
  );
}
`;

const out =
  "C:/Users/tk/.cursor/projects/c-Users-tk-Desktop-work-ticket-system-v3/canvases/recorded-kpi-users.canvas.tsx";
writeFileSync(out, canvas, "utf8");
console.log(`wrote ${out} users=${d.users.length}`);
