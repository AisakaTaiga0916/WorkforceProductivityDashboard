"use client";

import { useState } from "react";
import type { OrgChartSectionRow } from "../superadmin-settings/OrgChartSectionsPanel";
import {
  OrgChartWorkspace,
  type OrgChartEitherOrLinkRow,
  type OrgChartNodeRow,
} from "../superadmin-settings/OrgChartWorkspace";
import type { PersonnelRosterRow } from "@/lib/personnel-accounts-data";

type CompanyOption = { id: string; name: string };

/**
 * Workforce → Org. Chart: shared chart + Manage teams workspace.
 * Keeps nodes/sections in one place so team edits refresh the diagram.
 * Structure only — roles and company access live in Settings → User Management.
 */
export function WorkforceSectioningClient({
  initialSections,
  initialNodes,
  initialEitherOrLinks,
  roster,
  companyOptions,
  readOnly = false,
  canEditAssignmentColor = false,
  currentCompanyName = null,
  initialPortalRoleByMergedId = {},
}: {
  initialSections: OrgChartSectionRow[];
  initialNodes: OrgChartNodeRow[];
  initialEitherOrLinks: OrgChartEitherOrLinkRow[];
  roster: PersonnelRosterRow[];
  companyOptions: CompanyOption[];
  /** Admin / heads: browse only (scoped server-side). */
  readOnly?: boolean;
  /** Admin / Super Admin: edit staff assignment colors from the team member lists. */
  canEditAssignmentColor?: boolean;
  /** Current company context; the chart shows its teams plus their parent chain. */
  currentCompanyName?: string | null;
  initialPortalRoleByMergedId?: Record<string, string>;
}) {
  const [sections, setSections] = useState(initialSections);
  const [nodes, setNodes] = useState(initialNodes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {message ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {currentCompanyName ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Showing teams in <strong className="font-semibold">{currentCompanyName}</strong> plus the parent teams
          they report into. Switch company from the sidebar to see another company&apos;s teams.
        </p>
      ) : null}
      {readOnly ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Read-only: you can view your team / sub-team tree.
        </p>
      ) : null}

      <OrgChartWorkspace
        initialNodes={initialNodes}
        initialSections={initialSections}
        initialEitherOrLinks={initialEitherOrLinks}
        roster={roster}
        companyOptions={companyOptions}
        nodes={nodes}
        sections={sections}
        onNodesChange={setNodes}
        onSectionsChange={setSections}
        busy={busy}
        onBusyChange={setBusy}
        onMessage={setMessage}
        onError={setError}
        readOnly={readOnly}
        canEditAssignmentColor={canEditAssignmentColor}
        initialPortalRoleByMergedId={initialPortalRoleByMergedId}
      />
    </div>
  );
}
