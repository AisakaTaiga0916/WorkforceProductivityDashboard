"use client";

import type { OrgChartNode } from "@prisma/client/primary";
import type { PersonnelRosterRow } from "@/lib/personnel-accounts-data";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import {
  Check,
  FolderKanban,
  GitBranch,
  GitCompareArrows,
  Link2Off,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  OrgChartBulkReportsBar,
  type BulkReportsToOptions,
} from "./OrgChartBulkReportsBar";
import {
  OrgChartSectionsPanel,
  type OrgChartSectionRow,
} from "./OrgChartSectionsPanel";
import {
  eitherOrLinkLabel,
  encodeReportsToValue,
  formatOrgChartLevelLabel,
  orgChartLayerById,
  orgChartOptionLabel,
  orgChartOutlineById,
  orgChartReportsToOptions,
  orgChartSectionsLayoutKey,
  parseReportsToValue,
  sortOrgNodesByLayer,
} from "./org-chart-layers";

const OrgChartDiagram = dynamic(
  () => import("./OrgChartDiagram").then((m) => m.OrgChartDiagram),
  {
    ssr: false,
    loading: () => (
      <div className="h-[640px] w-full animate-pulse rounded-2xl border border-zinc-200/80 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-950/40" />
    ),
  },
);

export type OrgChartEitherOrLinkRow = {
  id: string;
  nodeAId: string;
  nodeBId: string;
};

export type OrgChartNodeRow = OrgChartNode & {
  sectionMemberships: Array<{
    sectionId: string;
    roleId?: string | null;
    role?: { id: string; label: string } | null;
  }>;
};

const AVATAR_PALETTE = [
  "bg-orange-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-indigo-500",
];

function avatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Add / remove members, either-or links, and the drill-down org chart diagram.
 * Self-contained by default (owns nodes/links/message/error/busy) and can be
 * driven from a host that also renders the Sectioning panel: pass `nodes` /
 * `sections` plus the matching `on*Change` callbacks to share one source of
 * truth, and `onMessage` / `onError` / `busy` to share banners.
 */
export function OrgChartWorkspace({
  initialNodes,
  initialSections,
  initialEitherOrLinks,
  roster,
  companyOptions = [],
  sections: controlledSections,
  nodes: controlledNodes,
  onSectionsChange,
  onNodesChange,
  busy: controlledBusy,
  onBusyChange,
  onMessage,
  onError,
  onChartSelectionChange,
  readOnly = false,
  canSetPortalRoles = false,
  initialPortalRoleByMergedId = {},
}: {
  initialNodes: OrgChartNodeRow[];
  initialSections: OrgChartSectionRow[];
  initialEitherOrLinks: OrgChartEitherOrLinkRow[];
  roster: PersonnelRosterRow[];
  /** Companies for the Manage departments panel. */
  companyOptions?: Array<{ id: string; name: string }>;
  /** Optional: controlled sync with a host that also tracks departments. */
  sections?: OrgChartSectionRow[];
  nodes?: OrgChartNodeRow[];
  onSectionsChange?: (s: OrgChartSectionRow[]) => void;
  onNodesChange?: (n: OrgChartNodeRow[]) => void;
  /** Optional: shared busy / banners with a host panel. */
  busy?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onMessage?: (msg: string | null) => void;
  onError?: (msg: string | null) => void;
  /** Optional: mirror the diagram's multi-select for the host's bulk actions. */
  onChartSelectionChange?: (ids: string[]) => void;
  /** Browse-only (no drag/edit). SuperAdmin elevate still allowed when canSetPortalRoles. */
  readOnly?: boolean;
  canSetPortalRoles?: boolean;
  initialPortalRoleByMergedId?: Record<string, string>;
}) {
  const [internalNodes, setInternalNodes] = useState<OrgChartNodeRow[]>(initialNodes);
  const [internalSections, setInternalSections] =
    useState<OrgChartSectionRow[]>(initialSections);
  const [eitherOrLinks, setEitherOrLinks] =
    useState<OrgChartEitherOrLinkRow[]>(initialEitherOrLinks);
  const [internalMessage, setInternalMessage] = useState<string | null>(null);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [internalBusy, setInternalBusy] = useState(false);
  const [sectionsPanelOpen, setSectionsPanelOpen] = useState(false);
  const [portalRoleByMergedId, setPortalRoleByMergedId] = useState<Record<string, string>>(
    () => {
      const fromRoster: Record<string, string> = {};
      for (const r of roster) {
        const id = r.mergedSourceUserId?.trim();
        const role = r.staffRole?.trim();
        if (id && role) fromRoster[id] = role;
      }
      return { ...fromRoster, ...initialPortalRoleByMergedId };
    },
  );

  const nodes = controlledNodes ?? internalNodes;
  const sections = controlledSections ?? internalSections;
  const busy = controlledBusy ?? internalBusy;
  /** Lock chart mutations when read-only or a request is in flight. */
  const chartLocked = busy || readOnly;

  const setNodes = useCallback(
    (next: OrgChartNodeRow[]) => {
      setInternalNodes(next);
      onNodesChange?.(next);
    },
    [onNodesChange],
  );

  const setSections = useCallback(
    (next: OrgChartSectionRow[]) => {
      setInternalSections(next);
      onSectionsChange?.(next);
    },
    [onSectionsChange],
  );

  const setMessage = useCallback(
    (msg: string | null) => {
      if (onMessage) onMessage(msg);
      else setInternalMessage(msg);
    },
    [onMessage],
  );

  const setError = useCallback(
    (msg: string | null) => {
      if (onError) onError(msg);
      else setInternalError(msg);
    },
    [onError],
  );

  const setBusy = useCallback(
    (next: boolean) => {
      setInternalBusy(next);
      onBusyChange?.(next);
    },
    [onBusyChange],
  );

  const sectionNameById = useMemo(() => {
    const byId = new Map(sections.map((s) => [s.id, s]));
    const cache = new Map<string, string>();
    function pathFor(id: string, visiting = new Set<string>()): string {
      const cached = cache.get(id);
      if (cached) return cached;
      if (visiting.has(id)) return byId.get(id)?.name ?? id;
      visiting.add(id);
      const s = byId.get(id);
      if (!s) return id;
      const label = s.parentId
        ? `${pathFor(s.parentId, visiting)} › ${s.name}`
        : s.name;
      cache.set(id, label);
      return label;
    }
    for (const s of sections) pathFor(s.id);
    return cache;
  }, [sections]);

  // Org chart customizer state
  const [query, setQuery] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<PersonnelRosterRow | null>(null);
  const [pendingAdds, setPendingAdds] = useState<PersonnelRosterRow[]>([]);
  const [chartSelectedIds, setChartSelectedIds] = useState<string[]>([]);
  const [bulkReportsTo, setBulkReportsTo] = useState<string>("");
  const [addParentId, setAddParentId] = useState<string>("");
  /** Optional department to place new/queued people into when adding. */
  const [addSectionId, setAddSectionId] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [eitherOrPickerOpen, setEitherOrPickerOpen] = useState(false);
  const [eitherOrPersonA, setEitherOrPersonA] = useState("");
  const [eitherOrPersonB, setEitherOrPersonB] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const assignedPersonIds = useMemo(
    () => new Set(nodes.map((n) => n.mergedSourceUserId)),
    [nodes],
  );
  const pendingAddIds = useMemo(
    () => new Set(pendingAdds.map((p) => p.mergedSourceUserId)),
    [pendingAdds],
  );

  useEffect(() => {
    // When no department is chosen, queued "add" people who land on the chart
    // are cleared. With a department selected, on-chart people may stay queued
    // so they can be assigned into that department.
    if (addSectionId) return;
    setPendingAdds((prev) => {
      const next = prev.filter((p) => !assignedPersonIds.has(p.mergedSourceUserId));
      return next.length === prev.length ? prev : next;
    });
  }, [assignedPersonIds, addSectionId]);

  const memberRosterIdsInAddSection = useMemo(() => {
    if (!addSectionId) return new Set<string>();
    const ids = new Set<string>();
    for (const n of nodes) {
      if (n.sectionMemberships.some((m) => m.sectionId === addSectionId)) {
        ids.add(n.mergedSourceUserId);
      }
    }
    return ids;
  }, [nodes, addSectionId]);

  const departmentOptions = useMemo(() => {
    return [...sections]
      .map((s) => ({
        id: s.id,
        label: sectionNameById.get(s.id) ?? s.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sections, sectionNameById]);

  const addSectionLabel = useMemo(() => {
    if (!addSectionId) return null;
    return sectionNameById.get(addSectionId) ?? sections.find((s) => s.id === addSectionId)?.name ?? "department";
  }, [addSectionId, sectionNameById, sections]);

  /** Prefer the department head; else its reports-to person; else walk parents. */
  function reportsToForDepartment(sectionId: string): string {
    const byId = new Map(sections.map((s) => [s.id, s]));
    const nodeIds = new Set(nodes.map((n) => n.id));
    let cur = byId.get(sectionId) ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.headNodeId && nodeIds.has(cur.headNodeId)) {
        return cur.headNodeId;
      }
      if (cur.reportsToNodeId && nodeIds.has(cur.reportsToNodeId)) {
        return cur.reportsToNodeId;
      }
      cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null;
    }
    return "";
  }

  useEffect(() => {
    if (!addSectionId) return;
    setPendingAdds((prev) => {
      const next = prev.filter((p) => !memberRosterIdsInAddSection.has(p.mergedSourceUserId));
      return next.length === prev.length ? prev : next;
    });
  }, [addSectionId, memberRosterIdsInAddSection]);

  const reportsToAssignment = useMemo(
    () => parseReportsToValue(addParentId),
    [addParentId],
  );
  const reportsToParentLabel = useMemo(() => {
    if (reportsToAssignment.parentEitherOrLinkId) {
      const link = eitherOrLinks.find((l) => l.id === reportsToAssignment.parentEitherOrLinkId);
      if (!link) return "shared either/or";
      const byId = new Map(nodes.map((n) => [n.id, n]));
      return eitherOrLinkLabel(link, byId);
    }
    if (reportsToAssignment.parentId) {
      return nodes.find((n) => n.id === reportsToAssignment.parentId)?.personName ?? "manager";
    }
    return "the top level";
  }, [reportsToAssignment, eitherOrLinks, nodes]);
  /** The picker covers the whole roster: people already on the chart carry an
   *  "On chart" badge so the same search works for both Add and Remove. */
  const pickerPeople = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? roster.filter((p) =>
          `${p.name} ${p.teamName} ${p.staffRole}`.toLowerCase().includes(q),
        )
      : roster;
    const unassigned = matches.filter((p) => !assignedPersonIds.has(p.mergedSourceUserId));
    const assigned = matches.filter((p) => assignedPersonIds.has(p.mergedSourceUserId));
    return [...unassigned, ...assigned].slice(0, 60);
  }, [roster, query, assignedPersonIds]);

  /** Selected person's chart node, when they are already on the chart. */
  const selectedOnChart = useMemo(
    () =>
      selectedPerson
        ? nodes.find((n) => n.mergedSourceUserId === selectedPerson.mergedSourceUserId) ?? null
        : null,
    [selectedPerson, nodes],
  );

  const sectionsLayoutKey = useMemo(() => orgChartSectionsLayoutKey(sections), [sections]);
  const layerById = useMemo(() => orgChartLayerById(nodes), [nodes]);
  const outlineById = useMemo(
    () => orgChartOutlineById(nodes, sections),
    [nodes, sections, sectionsLayoutKey],
  );
  const reportsToOptionsByLayer = useMemo(() => {
    const sorted = sortOrgNodesByLayer(nodes, layerById, outlineById);
    const groups = new Map<number, typeof nodes>();
    for (const n of sorted) {
      const layer = layerById.get(n.id) ?? 1;
      const list = groups.get(layer) ?? [];
      list.push(n);
      groups.set(layer, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [nodes, layerById, outlineById]);

  const bulkMovableIds = useMemo(
    () =>
      chartSelectedIds.filter(
        (id) => !nodes.find((n) => n.id === id)?.parentLocked,
      ),
    [chartSelectedIds, nodes],
  );

  const bulkReportsToOptions = useMemo(
    () => orgChartReportsToOptions(nodes, chartSelectedIds, eitherOrLinks, sections),
    [nodes, chartSelectedIds, eitherOrLinks, sections, sectionsLayoutKey],
  );

  const chartSelectedPairLink = useMemo(() => {
    if (chartSelectedIds.length !== 2) return null;
    const [a, b] = chartSelectedIds;
    if (!a || !b) return null;
    return (
      eitherOrLinks.find(
        (l) =>
          (l.nodeAId === a && l.nodeBId === b) || (l.nodeAId === b && l.nodeBId === a),
      ) ?? null
    );
  }, [chartSelectedIds, eitherOrLinks]);

  const eitherOrPickerLink = useMemo(() => {
    if (!eitherOrPersonA || !eitherOrPersonB || eitherOrPersonA === eitherOrPersonB) {
      return null;
    }
    return (
      eitherOrLinks.find(
        (l) =>
          (l.nodeAId === eitherOrPersonA && l.nodeBId === eitherOrPersonB) ||
          (l.nodeAId === eitherOrPersonB && l.nodeBId === eitherOrPersonA),
      ) ?? null
    );
  }, [eitherOrPersonA, eitherOrPersonB, eitherOrLinks]);

  function openEitherOrPicker(prefillA?: string, prefillB?: string) {
    const a = prefillA ?? chartSelectedIds[0] ?? "";
    const b = prefillB ?? chartSelectedIds[1] ?? "";
    setEitherOrPersonA(a);
    setEitherOrPersonB(b && b !== a ? b : "");
    setEitherOrPickerOpen(true);
  }

  function closeEitherOrPicker() {
    setEitherOrPickerOpen(false);
    setEitherOrPersonA("");
    setEitherOrPersonB("");
  }

  function confirmEitherOrLink() {
    if (!eitherOrPersonA || !eitherOrPersonB || eitherOrPersonA === eitherOrPersonB) {
      setError("Choose two different people for Person A and Person B.");
      return;
    }
    if (eitherOrPickerLink) {
      removeEitherOr(eitherOrPickerLink.id);
      closeEitherOrPicker();
      return;
    }
    createEitherOr(eitherOrPersonA, eitherOrPersonB);
    closeEitherOrPicker();
  }

  const eitherOrNodeOptions = useMemo(
    () =>
      [...nodes].sort((x, y) => x.personName.localeCompare(y.personName)),
    [nodes],
  );

  /** Close the roster dropdown on outside click / Escape instead of leaving it
   *  floating over the page. */
  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen]);

  const load = useCallback(async () => {
    const [nodesRes, linksRes] = await Promise.all([
      fetch("/api/admin/org-chart"),
      fetch("/api/admin/org-chart-either-or"),
    ]);
    if (!nodesRes.ok) {
      setError("Could not load the chart.");
      return;
    }
    setNodes(await nodesRes.json());
    if (linksRes.ok) {
      setEitherOrLinks(await linksRes.json());
    }
  }, [setError, setNodes]);

  const run = useCallback(
    async (action: () => Promise<Response>, success: string) => {
      setBusy(true);
      setMessage(null);
      setError(null);
      try {
        const res = await action();
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? "Request failed.");
          return false;
        }
        await load();
        setMessage(success);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [load, setBusy, setError, setMessage],
  );

  const createEitherOr = useCallback(
    (nodeAId: string, nodeBId: string) => {
      if (!nodeAId || !nodeBId || nodeAId === nodeBId) {
        setError("Shift-click two different members on the chart, then link them.");
        return;
      }
      void run(
        () =>
          fetch("/api/admin/org-chart-either-or", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nodeAId, nodeBId }),
          }),
        "Linked members as either/or for approvals.",
      );
    },
    [run, setError],
  );

  const removeEitherOr = useCallback(
    (linkId: string) => {
      void run(
        () =>
          fetch(`/api/admin/org-chart-either-or?id=${encodeURIComponent(linkId)}`, {
            method: "DELETE",
          }),
        "Removed either/or approval link.",
      );
    },
    [run],
  );

  function togglePendingAdd(person: PersonnelRosterRow) {
    const onChart = assignedPersonIds.has(person.mergedSourceUserId);
    if (onChart && !addSectionId) {
      const chartNode = nodes.find((n) => n.mergedSourceUserId === person.mergedSourceUserId);
      setSelectedPerson(person);
      setChartSelectedIds(chartNode ? [chartNode.id] : []);
      setPendingAdds([]);
      setPickerOpen(false);
      return;
    }
    if (addSectionId && memberRosterIdsInAddSection.has(person.mergedSourceUserId)) {
      setError("That person is already in the selected department.");
      return;
    }
    setPendingAdds((prev) => {
      const exists = prev.some((p) => p.mergedSourceUserId === person.mergedSourceUserId);
      if (exists) return prev.filter((p) => p.mergedSourceUserId !== person.mergedSourceUserId);
      return [...prev, person];
    });
  }

  function addMembers() {
    const toAdd = addSectionId
      ? pendingAdds.filter((p) => !memberRosterIdsInAddSection.has(p.mergedSourceUserId))
      : pendingAdds.filter((p) => !assignedPersonIds.has(p.mergedSourceUserId));
    if (toAdd.length === 0) return;
    const assignment = parseReportsToValue(addParentId);
    const body: Record<string, unknown> = {
      mergedSourceUserIds: toAdd.map((p) => p.mergedSourceUserId),
      parentId: assignment.parentEitherOrLinkId ? undefined : assignment.parentId,
      parentEitherOrLinkId: assignment.parentEitherOrLinkId,
    };
    if (addSectionId) body.sectionId = addSectionId;
    const count = toAdd.length;
    const deptNote = addSectionLabel ? ` in “${addSectionLabel}”` : "";
    void run(
      () =>
        fetch("/api/admin/org-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      count === 1
        ? `${toAdd[0]!.name} added under ${reportsToParentLabel}${deptNote}.`
        : `${count} members added under ${reportsToParentLabel}${deptNote}.`,
    ).then(async () => {
      setPendingAdds([]);
      setQuery("");
      setPickerOpen(false);
      if (addSectionId) {
        try {
          await reloadSections();
        } catch {
          /* chart reload already ran via run() */
        }
      }
    });
  }

  // Stable identities: these are passed into the org chart diagram and appear in
  // its rfNodes memo deps — recreating them on every panel render would make
  // React Flow re-adopt all nodes and swallow the next card click.
  const reparent = useCallback(
    (id: string, parentValue: string) => {
      const node = nodes.find((n) => n.id === id);
      if (node?.parentLocked) {
        setError("This member is locked to their current manager.");
        return;
      }
      const assignment = parseReportsToValue(parentValue);
      void run(
        () =>
          fetch("/api/admin/org-chart", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              parentId: assignment.parentEitherOrLinkId ? null : assignment.parentId,
              parentEitherOrLinkId: assignment.parentEitherOrLinkId,
            }),
          }),
        "Manager updated.",
      );
    },
    [run, nodes, setError],
  );

  const reparentMany = useCallback(
    (ids: string[], parentValue: string) => {
      const movable = ids.filter((id) => !nodes.find((n) => n.id === id)?.parentLocked);
      if (movable.length === 0) {
        setError("All selected members are locked to their current manager.");
        return;
      }
      const assignment = parseReportsToValue(parentValue);
      const suffix =
        movable.length > 1
          ? ` (${movable.length} members)`
          : movable.length < ids.length
            ? ` (${movable.length} unlocked)`
            : "";
      void run(
        () =>
          fetch("/api/admin/org-chart", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ids: movable,
              parentId: assignment.parentEitherOrLinkId ? null : assignment.parentId,
              parentEitherOrLinkId: assignment.parentEitherOrLinkId,
            }),
          }),
        `Moved under the new head${suffix}.`,
      );
    },
    [run, nodes, setError],
  );

  const reloadSections = useCallback(async () => {
    const res = await fetch("/api/admin/org-chart-sections", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not reload departments.");
    const body = (await res.json()) as OrgChartSectionRow[];
    setSections(body);
  }, [setSections]);

  const reparentSection = useCallback(
    (sectionId: string, newParentId: string | null) => {
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return;
      if (section.parentId === newParentId && !section.reportsToNodeId) return;
      if (newParentId === sectionId) {
        setError("A department cannot be nested under itself.");
        return;
      }
      void (async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const res = await fetch("/api/admin/org-chart-sections", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sectionId, parentId: newParentId }),
          });
          const body = (await res.json().catch(() => ({}))) as OrgChartSectionRow & {
            error?: string;
          };
          if (!res.ok) throw new Error(body.error ?? "Could not move department.");
          await reloadSections();
          if (newParentId) {
            const parent = sections.find((s) => s.id === newParentId);
            setMessage(
              `Moved “${section.name}” under “${parent?.name ?? body.name ?? "department"}”.`,
            );
          } else {
            setMessage(`Made “${section.name}” a top-level department.`);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not move department.");
        } finally {
          setBusy(false);
        }
      })();
    },
    [sections, reloadSections, setBusy, setError, setMessage],
  );

  const setSectionReportsTo = useCallback(
    (sectionId: string, reportsToNodeId: string) => {
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return;
      if (section.reportsToNodeId === reportsToNodeId) return;
      const person = nodes.find((n) => n.id === reportsToNodeId);
      void (async () => {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const res = await fetch("/api/admin/org-chart-sections", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: sectionId, reportsToNodeId }),
          });
          const body = (await res.json().catch(() => ({}))) as OrgChartSectionRow & {
            error?: string;
          };
          if (!res.ok) throw new Error(body.error ?? "Could not update reports-to.");
          await reloadSections();
          await load();
          setMessage(
            `“${section.name}” now reports to ${person?.personName ?? "selected person"}.`,
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not update reports-to.");
        } finally {
          setBusy(false);
        }
      })();
    },
    [sections, nodes, reloadSections, load, setBusy, setError, setMessage],
  );

  const toggleParentLock = useCallback(
    (id: string, locked: boolean) => {
      void run(
        () =>
          fetch("/api/admin/org-chart", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, parentLocked: locked }),
          }),
        locked
          ? "Member locked to their current manager."
          : "Member unlocked — reports-to can be changed.",
      );
    },
    [run],
  );

  function applyBulkReportsTo() {
    if (bulkMovableIds.length === 0) {
      setError("All selected members are locked to their current manager.");
      return;
    }
    reparentMany(bulkMovableIds, bulkReportsTo);
  }

  const move = useCallback(
    (id: string, moveUp: boolean) => {
      void run(
        () =>
          fetch("/api/admin/org-chart", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, moveUp, moveDown: !moveUp }),
          }),
        "Order updated.",
      );
    },
    [run],
  );

  /** When several selected nodes nest under each other, only delete the
   *  outermost ones — cascade removal already clears their selected children. */
  function topmostSelectedIds(ids: string[]) {
    const idSet = new Set(ids);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return ids.filter((id) => {
      let cur = byId.get(id);
      while (cur?.parentId) {
        if (idSet.has(cur.parentId)) return false;
        cur = byId.get(cur.parentId);
      }
      return true;
    });
  }

  const clearChartSelection = useCallback(() => {
    setChartSelectedIds([]);
    setSelectedPerson(null);
    setQuery("");
    setPickerOpen(false);
  }, []);

  const remove = useCallback(
    (id: string, reports: number) => {
      const name = nodes.find((n) => n.id === id)?.personName ?? "this member";
      const suffix =
        reports > 0
          ? ` This also removes ${reports} direct report${reports === 1 ? "" : "s"}.`
          : "";
      if (!window.confirm(`Remove ${name} from the chart?${suffix}`)) return;
      void run(
        () => fetch(`/api/admin/org-chart?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
        "Member removed from the chart.",
      ).then((ok) => {
        if (ok === false) return;
        clearChartSelection();
      });
    },
    [nodes, run, clearChartSelection],
  );

  const removeMany = useCallback(
    (ids: string[]) => {
      const targets = topmostSelectedIds(ids);
      if (targets.length === 0) return;
      const names = targets
        .map((id) => nodes.find((n) => n.id === id)?.personName ?? "member")
        .slice(0, 5);
      const extra = targets.length > names.length ? ` (+${targets.length - names.length} more)` : "";
      const cascadeNote =
        " Removing a member also removes their direct reports from the chart.";
      if (
        !window.confirm(
          targets.length === 1
            ? `Remove ${names[0]} from the chart?${cascadeNote}`
            : `Remove ${targets.length} members (${names.join(", ")}${extra}) from the chart?${cascadeNote}`,
        )
      ) {
        return;
      }
      void run(async () => {
        let last: Response | null = null;
        for (const id of targets) {
          last = await fetch(`/api/admin/org-chart?id=${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          if (!last.ok) return last;
        }
        return last!;
      }, targets.length === 1 ? "Member removed from the chart." : `${targets.length} members removed from the chart.`).then(
        (ok) => {
          if (ok === false) return;
          clearChartSelection();
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topmostSelectedIds uses nodes
    [nodes, run, clearChartSelection],
  );

  function removeSelectedMember() {
    const ids =
      chartSelectedIds.length > 0
        ? chartSelectedIds
        : selectedOnChart
          ? [selectedOnChart.id]
          : [];
    if (ids.length === 0) return;
    if (ids.length > 1) {
      removeMany(ids);
      return;
    }
    const id = ids[0]!;
    const reports = nodes.filter((n) => n.parentId === id).length;
    remove(id, reports);
  }

  const handleChartSelectionChange = useCallback((ids: string[]) => {
    setChartSelectedIds(ids);
  }, []);

  /** Mirror the diagram's multi-select up to the host so its Sectioning panel
   *  can offer "Add N selected" against the same boxes. */
  useEffect(() => {
    onChartSelectionChange?.(chartSelectedIds);
  }, [chartSelectedIds, onChartSelectionChange]);

  /** Live copy of selectedOnChart so handleCardSelect stays identity-stable
   *  (recreating it on every selection would re-trigger the diagram's rfNodes
   *  memo and swallow the next card click) while still reading fresh state. */
  const selectedOnChartRef = useRef(selectedOnChart);
  selectedOnChartRef.current = selectedOnChart;

  /** A card clicked on the chart selects that member in the panel, so Remove
   *  member can act on it directly. */
  const handleCardSelect = useCallback(
    (node: OrgChartNode | null) => {
      if (!node) {
        // Shift-toggle unselected a card: clear only if it was the panel's pick.
        if (selectedOnChartRef.current) setSelectedPerson(null);
        return;
      }
      const row =
        roster.find((p) => p.mergedSourceUserId === node.mergedSourceUserId) ??
        ({
          mergedSourceUserId: node.mergedSourceUserId,
          agentId: null,
          name: node.personName,
          email: "",
          username: null,
          teamId: "",
          teamName: node.companyName ?? "",
          portalAccountId: null,
          staffRole: node.personRole ?? "",
          accountStatus: "ACTIVE",
          staffAssignmentColor: null,
          kpiOverallPercent: null,
          kpiAveragePercent: null,
        } satisfies PersonnelRosterRow);
      setSelectedPerson(row);
      // Only fill an empty selection (e.g. drag swallowed click). Never replace
      // an existing multi-select from Shift-click.
      setChartSelectedIds((prev) => (prev.length === 0 ? [node.id] : prev));
      setPickerOpen(false);
    },
    [roster],
  );

  const handleSectionMemberSelect = useCallback(
    (node: OrgChartNodeRow) => {
      const row =
        roster.find((p) => p.mergedSourceUserId === node.mergedSourceUserId) ?? null;
      setSelectedPerson(row);
      setPickerOpen(false);
    },
    [roster],
  );

  const handleSectionMembersSelect = useCallback(
    (ids: string[], focusNode?: OrgChartNodeRow | null) => {
      setChartSelectedIds(ids);
      if (focusNode) {
        const row =
          roster.find((p) => p.mergedSourceUserId === focusNode.mergedSourceUserId) ?? null;
        setSelectedPerson(row);
      } else if (ids.length === 0) {
        setSelectedPerson(null);
      } else if (ids.length === 1) {
        const node = nodes.find((n) => n.id === ids[0]);
        if (node) {
          const row =
            roster.find((p) => p.mergedSourceUserId === node.mergedSourceUserId) ?? null;
          setSelectedPerson(row);
        }
      }
      setPickerOpen(false);
    },
    [roster, nodes],
  );

  return (
    <section className="space-y-6">
      {!onMessage && internalMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
          {internalMessage}
        </p>
      ) : null}
      {!onError && internalError ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-100">
          {internalError}
        </p>
      ) : null}

      {!readOnly ? (
      <div className="rounded-2xl border border-zinc-200/80 bg-white/95 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Add or remove member
              </h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Search the roster and click several people to queue them. Choose a department to
              place them in — Reports to fills with that department&apos;s head, or its assigned
              reports-to person when there is no head. You can still change Reports to before
              adding.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] sm:items-end">
            <div ref={pickerRef} className="relative min-w-0">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Person
              </label>
              <div className="flex h-10 items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-3 transition focus-within:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPickerOpen(true);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  placeholder={
                    addSectionId
                      ? "Search roster — queue people for this department…"
                      : "Search and click several people…"
                  }
                  className="h-full w-full min-w-0 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
                  autoComplete="off"
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery("");
                      setPickerOpen(true);
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {pickerOpen ? (
                <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <p className="border-b border-zinc-100 px-3 py-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    {pickerPeople.length} {pickerPeople.length === 1 ? "person" : "people"}
                    {query.trim() ? " found" : " on the roster"}
                    {pendingAdds.length > 0
                      ? ` · ${pendingAdds.length} queued to add`
                      : addSectionId
                        ? " · click to queue into the department"
                        : " · click to queue several under one manager"}
                  </p>
                  {pickerPeople.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-zinc-500">
                      {query.trim()
                        ? "No matches."
                        : "Everyone in the roster is already on the chart."}
                    </p>
                  ) : (
                    <ul className="max-h-60 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                      {pickerPeople.map((p) => {
                        const onChart = assignedPersonIds.has(p.mergedSourceUserId);
                        const queued = pendingAddIds.has(p.mergedSourceUserId);
                        const inDept = memberRosterIdsInAddSection.has(p.mergedSourceUserId);
                        return (
                          <li key={p.mergedSourceUserId}>
                            <button
                              type="button"
                              onClick={() => togglePendingAdd(p)}
                              disabled={Boolean(addSectionId && inDept)}
                              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800/60 ${
                                queued ? "bg-orange-50 dark:bg-orange-950/30" : ""
                              }`}
                            >
                              <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarColor(p.mergedSourceUserId)}`}
                              >
                                {queued ? <Check className="h-4 w-4" /> : initials(p.name)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                  {p.name}
                                </span>
                                <span className="block truncate text-xs text-zinc-500">
                                  {[p.teamName, p.staffRole].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                              {inDept && addSectionId ? (
                                <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                                  In dept
                                </span>
                              ) : onChart ? (
                                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                  On chart
                                </span>
                              ) : queued ? (
                                <span className="shrink-0 rounded-full bg-orange-200/80 px-2 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-900/50 dark:text-orange-200">
                                  Queued
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>

            <label className="min-w-0">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Department
              </span>
              <select
                value={addSectionId}
                onChange={(e) => {
                  const next = e.target.value;
                  setAddSectionId(next);
                  if (next) {
                    setAddParentId(reportsToForDepartment(next));
                  }
                }}
                className="h-10 w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">— None (chart only) —</option>
                {departmentOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              {addSectionId && !addParentId ? (
                <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                  No head or reports-to on this department — Reports to stays top level until you
                  pick someone.
                </p>
              ) : null}
            </label>

            <label className="min-w-0">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Reports to
              </span>
              <select
                value={addParentId}
                onChange={(e) => setAddParentId(e.target.value)}
                className="h-10 w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">— Top level ({formatOrgChartLevelLabel(1)}) —</option>
                {eitherOrLinks.length > 0 ? (
                  <optgroup label="Shared either / or">
                    {eitherOrLinks.map((link) => {
                      const byId = new Map(nodes.map((n) => [n.id, n]));
                      return (
                        <option key={link.id} value={encodeReportsToValue({ parentEitherOrLinkId: link.id })}>
                          {eitherOrLinkLabel(link, byId)}
                        </option>
                      );
                    })}
                  </optgroup>
                ) : null}
                {reportsToOptionsByLayer.map(([level, people]) => (
                  <optgroup key={`add-level-${level}`} label={formatOrgChartLevelLabel(level)}>
                    {people.map((n) => (
                      <option key={n.id} value={n.id}>
                        {orgChartOptionLabel(n, outlineById.get(n.id) ?? level, outlineById)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          {pendingAdds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Adding under {reportsToParentLabel}
                {addSectionLabel ? ` · ${addSectionLabel}` : ""}:
              </span>
              {pendingAdds.map((p) => (
                <button
                  key={`queued-${p.mergedSourceUserId}`}
                  type="button"
                  onClick={() => togglePendingAdd(p)}
                  className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-900 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-100 dark:hover:bg-orange-950/70"
                  title="Remove from queue"
                >
                  {p.name}
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <Button
              className="h-10 min-w-[9.5rem] flex-1 rounded-xl px-4 sm:flex-none"
              disabled={busy || pendingAdds.length === 0}
              onClick={addMembers}
            >
              {pendingAdds.length > 1 ? (
                <Users className="mr-2 h-4 w-4" />
              ) : (
                <UserRound className="mr-2 h-4 w-4" />
              )}
              {pendingAdds.length === 0
                ? "Add members"
                : pendingAdds.length === 1
                  ? `Add ${pendingAdds[0]!.name.trim().split(/\s+/)[0] || "member"}`
                  : `Add ${pendingAdds.length} members`}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-[9.5rem] flex-1 rounded-xl border-rose-300 px-4 text-rose-700 hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700 sm:flex-none dark:border-rose-800 dark:text-rose-300 dark:hover:border-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-200"
              disabled={
                busy ||
                (chartSelectedIds.length === 0 && !selectedOnChart)
              }
              onClick={removeSelectedMember}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {chartSelectedIds.length > 1
                ? `Remove ${chartSelectedIds.length}`
                : "Remove member"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-[9.5rem] flex-1 rounded-xl px-4 sm:flex-none"
              disabled={busy || nodes.length < 2}
              title="Choose Person A and Person B to link as either/or"
              onClick={() => {
                if (chartSelectedPairLink) {
                  removeEitherOr(chartSelectedPairLink.id);
                  return;
                }
                openEitherOrPicker();
              }}
            >
              {chartSelectedPairLink ? (
                <Link2Off className="mr-2 h-4 w-4" />
              ) : (
                <GitCompareArrows className="mr-2 h-4 w-4" />
              )}
              {chartSelectedPairLink ? "Unlink either / or" : "Link either / or"}
            </Button>
          </div>

          {eitherOrPickerOpen ? (
            <div className="rounded-xl border border-orange-300 bg-orange-50/80 p-4 dark:border-orange-800 dark:bg-orange-950/30">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Either / or link
                </p>
                <button
                  type="button"
                  aria-label="Close either/or picker"
                  onClick={closeEitherOrPicker}
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-orange-800 dark:text-orange-200">
                    Person A
                  </span>
                  <select
                    value={eitherOrPersonA}
                    onChange={(e) => setEitherOrPersonA(e.target.value)}
                    disabled={busy}
                    className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="">— Choose person A —</option>
                    {eitherOrNodeOptions.map((n) => (
                      <option
                        key={`eo-a-${n.id}`}
                        value={n.id}
                        disabled={n.id === eitherOrPersonB}
                      >
                        {n.personName}
                        {n.personRole ? ` · ${n.personRole}` : ""}
                      </option>
                    ))}
                  </select>
                  {eitherOrPersonA ? (
                    <p className="mt-1.5 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {nodes.find((n) => n.id === eitherOrPersonA)?.personName}
                    </p>
                  ) : null}
                </label>
                <div className="flex items-center justify-center pb-2 sm:pb-2.5">
                  <span className="rounded-full border border-orange-300 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-orange-800 dark:border-orange-700 dark:bg-zinc-900 dark:text-orange-200">
                    either / or
                  </span>
                </div>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-orange-800 dark:text-orange-200">
                    Person B
                  </span>
                  <select
                    value={eitherOrPersonB}
                    onChange={(e) => setEitherOrPersonB(e.target.value)}
                    disabled={busy}
                    className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="">— Choose person B —</option>
                    {eitherOrNodeOptions.map((n) => (
                      <option
                        key={`eo-b-${n.id}`}
                        value={n.id}
                        disabled={n.id === eitherOrPersonA}
                      >
                        {n.personName}
                        {n.personRole ? ` · ${n.personRole}` : ""}
                      </option>
                    ))}
                  </select>
                  {eitherOrPersonB ? (
                    <p className="mt-1.5 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {nodes.find((n) => n.id === eitherOrPersonB)?.personName}
                    </p>
                  ) : null}
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="h-9 rounded-xl"
                  disabled={
                    busy ||
                    !eitherOrPersonA ||
                    !eitherOrPersonB ||
                    eitherOrPersonA === eitherOrPersonB
                  }
                  onClick={confirmEitherOrLink}
                >
                  {eitherOrPickerLink ? (
                    <>
                      <Link2Off className="mr-1.5 h-4 w-4" />
                      Unlink pair
                    </>
                  ) : (
                    <>
                      <GitCompareArrows className="mr-1.5 h-4 w-4" />
                      Confirm link
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl"
                  disabled={busy}
                  onClick={closeEitherOrPicker}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {chartSelectedIds.length >= 2 ? (
            <div className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2.5 dark:border-orange-800 dark:bg-orange-950/40">
              <p className="mb-2 text-[11px] font-semibold text-orange-900 dark:text-orange-100">
                Bulk move — {chartSelectedIds.length} chart boxes selected
              </p>
              <OrgChartBulkReportsBar
                selectedCount={chartSelectedIds.length}
                movableCount={bulkMovableIds.length}
                value={bulkReportsTo}
                onChange={setBulkReportsTo}
                onApply={applyBulkReportsTo}
                busy={busy}
                options={bulkReportsToOptions as BulkReportsToOptions}
              />
            </div>
          ) : null}

          <div
            className={`flex min-h-[42px] flex-wrap items-center gap-2 rounded-xl border px-3.5 py-2 text-xs ${
              pendingAdds.length > 0 || chartSelectedIds.length > 1 || selectedPerson
                ? "border-orange-200 bg-orange-50 font-medium text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-100"
                : "border-dashed border-zinc-200 bg-zinc-50/70 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400"
            }`}
          >
            {pendingAdds.length > 0 ? (
              <>
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {pendingAdds.length} {pendingAdds.length === 1 ? "person" : "people"} queued
                  under {reportsToParentLabel}
                  <span className="font-normal opacity-80">
                    {" "}
                    · click more names to add them to the same manager
                  </span>
                </span>
              </>
            ) : chartSelectedIds.length > 1 ? (
              <>
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {chartSelectedIds.length} boxes selected
                  <span className="font-normal opacity-80">
                    {" "}
                    · use Bulk move above
                    {chartSelectedIds.length === 2
                      ? " · or Link either / or"
                      : ""}{" "}
                    · Shift-click on chart to adjust selection
                  </span>
                </span>
              </>
            ) : selectedPerson ? (
              <>
                <UserRound className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">
                  Selected: {selectedPerson.name}
                  <span className="font-normal opacity-80"> · {selectedPerson.teamName}</span>
                </span>
                {selectedOnChart ? (
                  <span className="rounded-full bg-orange-200/70 px-2 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
                    On chart
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-200/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                    Ready to add
                  </span>
                )}
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span>
                  Search and click several people, then choose who they report to.
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200/80 bg-white/95 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Organizational chart
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {nodes.length} {nodes.length === 1 ? "member" : "members"}
            </span>
            {sections.length > 0 ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                {sections.length} department{sections.length === 1 ? "" : "s"}
              </span>
            ) : null}
            {eitherOrLinks.length > 0 ? (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800 dark:bg-orange-950/50 dark:text-orange-200">
                {eitherOrLinks.length} either/or
              </span>
            ) : null}
            {chartSelectedIds.length > 0 ? (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800 dark:bg-orange-950/50 dark:text-orange-200">
                {chartSelectedIds.length} selected
              </span>
            ) : null}
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl"
              onClick={() => setSectionsPanelOpen((v) => !v)}
            >
              <FolderKanban className="mr-1.5 h-4 w-4" />
              {sectionsPanelOpen
                ? readOnly
                  ? "Hide departments"
                  : "Hide departments"
                : readOnly
                  ? "View departments"
                  : "Manage departments"}
            </Button>
            <p className="max-w-xl text-xs leading-relaxed text-zinc-500 sm:text-right">
              {readOnly
                ? "Read-only view of your department tree. SuperAdmin elevates Personnel, Admin, and HighAdmin from member rows."
                : "The org chart shows departments and heads with hierarchy lines. Click a department to open its members. Use Manage departments to create groups, nest them, set heads, or elevate portal roles."}
            </p>
          </div>
        </div>

        {chartSelectedIds.length < 2 && !readOnly ? (
          <p className="mt-3 text-[11px] text-zinc-500">
            Tip: drag a department onto another to nest it. Open a department, then Shift-click
            members. Use Add / Remove for membership. Link either / or opens a Person A / Person B
            picker.
          </p>
        ) : null}

        <div className="relative mt-4">
          {sectionsPanelOpen ? (
            <div className="mb-4 max-h-[min(70vh,560px)] overflow-y-auto rounded-2xl border border-sky-200/80 bg-sky-50/40 p-1 dark:border-sky-900/40 dark:bg-sky-950/20">
              <OrgChartSectionsPanel
                sections={sections}
                nodes={nodes}
                companyOptions={companyOptions}
                busy={chartLocked}
                chartSelectedIds={chartSelectedIds}
                onSectionsChange={setSections}
                onNodesChange={setNodes}
                onSelectMember={handleSectionMemberSelect}
                onSelectMembers={handleSectionMembersSelect}
                onRemoveSelected={
                  readOnly
                    ? undefined
                    : (ids) => {
                        if (ids.length > 1) removeMany(ids);
                        else if (ids.length === 1) {
                          const id = ids[0]!;
                          remove(id, nodes.filter((n) => n.parentId === id).length);
                        }
                      }
                }
                onMessage={setMessage}
                onError={setError}
                setBusy={setBusy}
                readOnly={readOnly}
                canSetPortalRoles={canSetPortalRoles}
                portalRoleByMergedId={portalRoleByMergedId}
                onPortalRoleChange={(mergedId, role) => {
                  setPortalRoleByMergedId((prev) => ({ ...prev, [mergedId]: role }));
                }}
              />
            </div>
          ) : null}
          {nodes.length === 0 && sections.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
              {readOnly
                ? "No departments in your org-chart scope."
                : "The chart is empty. Use Manage departments to create groups, then add people with Add or remove member (choose a department)."}
            </p>
          ) : (
            <OrgChartDiagram
              nodes={nodes}
              sections={sections}
              busy={chartLocked}
              onReparent={reparent}
              onReparentMany={reparentMany}
              onMove={move}
              onRemove={remove}
              onToggleParentLock={toggleParentLock}
              onSelectNode={handleCardSelect}
              onSelectionChange={handleChartSelectionChange}
              highlightId={selectedOnChart?.id ?? null}
              sectionNameById={sectionNameById}
              eitherOrLinks={eitherOrLinks}
              onCreateEitherOr={createEitherOr}
              onRemoveEitherOr={removeEitherOr}
              onOpenEitherOrPicker={openEitherOrPicker}
              onReparentSection={reparentSection}
              onSetSectionReportsTo={setSectionReportsTo}
              bulkReportsTo={bulkReportsTo}
              onBulkReportsToChange={setBulkReportsTo}
              onBulkApply={applyBulkReportsTo}
              bulkReportsToOptions={bulkReportsToOptions}
              bulkMovableCount={bulkMovableIds.length}
              onRemoveSelected={(ids) => {
                if (ids.length > 1) removeMany(ids);
                else if (ids.length === 1) {
                  const id = ids[0]!;
                  remove(id, nodes.filter((n) => n.parentId === id).length);
                }
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
