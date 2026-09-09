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
 * Workforce → Org. Chart: shared chart + Manage departments workspace.
 * Keeps nodes/sections in one place so department edits refresh the diagram.
 */
export function WorkforceSectioningClient({
  initialSections,
  initialNodes,
  initialEitherOrLinks,
  roster,
  companyOptions,
  readOnly = false,
  canSetPortalRoles = false,
  initialPortalRoleByMergedId = {},
}: {
  initialSections: OrgChartSectionRow[];
  initialNodes: OrgChartNodeRow[];
  initialEitherOrLinks: OrgChartEitherOrLinkRow[];
  roster: PersonnelRosterRow[];
  companyOptions: CompanyOption[];
  /** Admin / heads: browse only (scoped server-side). */
  readOnly?: boolean;
  /** SuperAdmin: elevate Personnel / Admin / HighAdmin from member rows. */
  canSetPortalRoles?: boolean;
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
      {readOnly ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Read-only: you can view your department / sub-department tree. SuperAdmin elevates
          Personnel, Admin, and HighAdmin from this Org Chart.
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
        canSetPortalRoles={canSetPortalRoles}
        initialPortalRoleByMergedId={initialPortalRoleByMergedId}
      />
    </div>
  );
}
