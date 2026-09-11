"use client";

import type { OrgChartNode } from "@prisma/client/primary";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
} from "@xyflow/react";
import type {
  Edge,
  EdgeProps,
  Node,
  NodeChange,
  NodeProps,
  DefaultEdgeOptions,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Crown, GitCompareArrows, Link2Off, Lock, LockOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  OrgChartBulkReportsBar,
  type BulkReportsToOptions,
} from "./OrgChartBulkReportsBar";
import type { OrgChartSectionRow } from "./OrgChartSectionsPanel";
import { resolveExecutiveTitle } from "@/lib/org-chart-executive-titles";
import {
  eitherOrLinkLabel,
  encodeReportsToValue,
  formatOrgChartLevelLabel,
  orgChartLayerById,
  orgChartOptionLabel,
  orgChartOutlineById,
  orgChartPersonOutlineFromLayout,
  buildOrgChartChildrenOf,
  buildSectionTreeChildrenOf,
  orgChartSectionsLayoutKey,
  ORG_CHART_OUTSIDE_SECTIONS_ID,
  sortOrgNodesByLayer,
  type OrgChartLayoutOptions,
} from "./org-chart-layers";

export { ORG_CHART_OUTSIDE_SECTIONS_ID };

const NODE_W = 248;
/** Must match rendered card height so connector handles align with layout rows. */
const NODE_H = 248;
const X_GAP = 48;
const X_ROOT_GAP = 72;
const Y_GAP = 72;
/** Rounded elbow routing for hierarchy connectors. */
const ORG_STEP_PATH = { borderRadius: 2, offset: 16 } as const;
/** Department overview: sharp orthogonal bus (shared mid-rank). */
const ORG_TREE_STEP_PATH = { borderRadius: 0, offset: 10 } as const;
const ORG_PEER_HANDLE_TOP = "38%";
const ORG_CHILD_IN_LEFT = "32%";
const ORG_CHILD_IN_RIGHT = "68%";

const ORG_EDGE_NORMAL: Edge["style"] = {
  stroke: "var(--org-line-strong)",
  strokeWidth: 2,
};

const ORG_EDGE_SHARED: Edge["style"] = {
  stroke: "#ea580c",
  strokeWidth: 2,
  strokeDasharray: "6 4",
};

const DEFAULT_ORG_EDGE_OPTIONS = {
  type: "smoothstep" as const,
  pathOptions: ORG_STEP_PATH,
  style: ORG_EDGE_NORMAL,
} as unknown as DefaultEdgeOptions;

const SECTION_TREE_EDGE_OPTIONS = {
  type: "orgTree" as const,
  pathOptions: ORG_TREE_STEP_PATH,
  style: ORG_EDGE_NORMAL,
} as unknown as DefaultEdgeOptions;

export type OrgChartDiagramNode = OrgChartNode & {
  sectionMemberships?: Array<{
    sectionId: string;
    roleId?: string | null;
    role?: { id: string; label: string } | null;
  }>;
};

function orgStepEdge(
  partial: Omit<Edge, "type"> & { type?: Edge["type"] },
  pathOptions: { borderRadius: number; offset: number } = ORG_STEP_PATH,
): Edge {
  return {
    type: "smoothstep",
    pathOptions,
    ...partial,
  } as Edge;
}

type OrgTreeEdgeData = {
  /** Shared horizontal bus Y for all siblings under the same parent. */
  busY: number;
};

/**
 * Classic org-chart orthogonal path:
 * down from parent → shared horizontal bus → down to child.
 * Collapses to a straight vertical when parent/child share an X (column spine).
 */
function buildOrgTreePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  busY: number,
): string {
  const sx = Math.round(sourceX);
  const sy = Math.round(sourceY);
  const tx = Math.round(targetX);
  const ty = Math.round(targetY);
  const gap = ty - sy;
  if (gap <= 1) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }
  const mid = Math.round(
    Math.min(Math.max(busY, sy + Math.min(10, gap / 2)), ty - Math.min(10, gap / 2)),
  );

  if (Math.abs(sx - tx) <= 1) {
    return `M ${sx} ${sy} L ${sx} ${ty}`;
  }
  return `M ${sx} ${sy} L ${sx} ${mid} L ${tx} ${mid} L ${tx} ${ty}`;
}

/** Orthogonal connectors with a shared mid-rank bus so sibling branches look uniform. */
const OrgTreeEdge = memo(function OrgTreeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data,
}: EdgeProps<Edge<OrgTreeEdgeData>>) {
  const busY =
    typeof data?.busY === "number"
      ? data.busY
      : sourceY + (targetY - sourceY) / 2;
  const edgePath = buildOrgTreePath(sourceX, sourceY, targetX, targetY, busY);
  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: "var(--org-tree-line)",
        strokeWidth: 1.75,
        strokeLinecap: "square",
        strokeLinejoin: "miter",
        fill: "none",
        ...style,
      }}
    />
  );
});

type ManagersByLayer = Array<[number, OrgChartNode[]]>;

type OrgBoxData = {
  node: OrgChartNode;
  kidsCount: number;
  managersByLayer: ManagersByLayer;
  eitherOrParentOptions: Array<{ value: string; label: string }>;
  reportsToValue: string;
  nodeLayer: number;
  outline: string;
  outlineById: Map<string, string>;
  siblingIndex: number;
  siblingCount: number;
  busy: boolean;
  selected: boolean;
  /** When > 1, Lock on this card applies to the whole Shift-click selection. */
  selectionLockCount: number;
  sectionLabel: string | null;
  onReparent: (id: string, parentId: string) => void;
  onMove: (id: string, moveUp: boolean) => void;
  onRemove: (id: string, reports: number) => void;
  onToggleParentLock: (id: string, locked: boolean) => void;
};

type OrgBoxNodeType = Node<OrgBoxData, "orgBox">;

type DiagramNode = OrgBoxNodeType;

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

function groupManagersByLayer(
  managerOptions: OrgChartNode[],
  layerById: Map<string, number>,
  outlineById?: Map<string, string>,
): ManagersByLayer {
  const sorted = sortOrgNodesByLayer(managerOptions, layerById, outlineById);
  const groups = new Map<number, OrgChartNode[]>();
  for (const m of sorted) {
    const layer = layerById.get(m.id) ?? 1;
    const list = groups.get(layer) ?? [];
    list.push(m);
    groups.set(layer, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b);
}

const OrgBox = memo(function OrgBox({ data }: NodeProps<OrgBoxNodeType>) {
  const {
    node,
    kidsCount,
    managersByLayer,
    eitherOrParentOptions,
    reportsToValue,
    nodeLayer,
    outline,
    outlineById,
    siblingIndex,
    siblingCount,
    busy,
    selected,
    selectionLockCount,
    sectionLabel,
    onReparent,
    onMove,
    onRemove,
    onToggleParentLock,
  } = data;
  const roleLine = [node.personRole, node.companyName].filter(Boolean).join(" · ") || "No role info";
  const locked = node.parentLocked;
  const displayOutline = outlineById.get(node.id) ?? outline;
  const lockCount = selected && selectionLockCount > 1 ? selectionLockCount : 1;
  const executiveTitle = resolveExecutiveTitle({
    mergedSourceUserId: node.mergedSourceUserId,
    personName: node.personName,
  });
  const designationLine = executiveTitle
    ? sectionLabel && sectionLabel !== "Individual (no department)"
      ? `${executiveTitle} · ${sectionLabel}`
      : executiveTitle
    : sectionLabel;

  return (
    <article
      data-box-id={node.id}
      style={{ minHeight: NODE_H }}
      title={`${displayOutline} · ${node.personName}\n${roleLine}${designationLine ? `\nDesignation: ${designationLine}` : ""}`}
      className={`relative w-[248px] rounded-xl border bg-white shadow-sm dark:bg-zinc-900 ${
        selected
          ? "border-orange-500/90 ring-2 ring-orange-500/45"
          : locked
            ? "border-amber-500/70 ring-1 ring-amber-500/30"
            : "border-zinc-200/90 hover:border-orange-400/50 dark:border-zinc-800 dark:hover:border-orange-500/35"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        className="!h-0.5 !w-0.5 !opacity-0"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="in-left"
        style={{ left: ORG_CHILD_IN_LEFT }}
        className="!h-0.5 !w-0.5 !opacity-0"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="in-right"
        style={{ left: ORG_CHILD_IN_RIGHT }}
        className="!h-0.5 !w-0.5 !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="peer-left"
        style={{ top: ORG_PEER_HANDLE_TOP }}
        className="!h-0.5 !w-0.5 !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="peer-right"
        style={{ top: ORG_PEER_HANDLE_TOP }}
        className="!h-0.5 !w-0.5 !opacity-0"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="peer-in-left"
        style={{ top: ORG_PEER_HANDLE_TOP }}
        className="!h-0.5 !w-0.5 !opacity-0"
      />
      <Handle
        type="target"
        position={Position.Right}
        id="peer-in-right"
        style={{ top: ORG_PEER_HANDLE_TOP }}
        className="!h-0.5 !w-0.5 !opacity-0"
      />
      <span
        className="absolute -left-2 -top-2 z-10 min-w-[1.75rem] rounded-lg bg-orange-600 px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums leading-none text-white shadow-md ring-2 ring-white dark:ring-zinc-900"
        title={`Chart position ${displayOutline}`}
      >
        {displayOutline}
      </span>
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white/70 dark:ring-zinc-800 ${avatarColor(node.id)}`}
        >
          {initials(node.personName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
              {node.personName}
            </p>
            {executiveTitle ? (
              <span className="shrink-0 rounded-md bg-[#1e3a5f] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                {executiveTitle}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
            {roleLine}
          </p>
          <p className="mt-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
            {formatOrgChartLevelLabel(nodeLayer)}
            {designationLine ? ` · ${designationLine}` : ""}
          </p>
        </div>
        {kidsCount > 0 || locked ? (
          <span className="mt-0.5 flex shrink-0 flex-col items-end gap-0.5">
            {locked ? (
              <span
                className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                title="Locked to current manager"
              >
                <Lock className="inline h-3 w-3" aria-hidden />
              </span>
            ) : null}
            {kidsCount > 0 ? (
              <span
                className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                title={`${kidsCount} direct report${kidsCount === 1 ? "" : "s"}`}
              >
                {kidsCount}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className="space-y-1.5 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <label className="block">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            Reports to · you are {displayOutline} ({formatOrgChartLevelLabel(nodeLayer)})
          </span>
          <select
            value={reportsToValue}
            disabled={busy || locked}
            onChange={(e) => onReparent(node.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-8 w-full cursor-pointer rounded-lg border border-zinc-300 bg-zinc-50 px-2 text-[11px] font-medium text-zinc-900 outline-none transition focus:border-orange-500/60 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 nodrag nopan"
          >
            <option value="">— Top level ({formatOrgChartLevelLabel(1)}) —</option>
            {eitherOrParentOptions.length > 0 ? (
              <optgroup label="Shared either / or">
                {eitherOrParentOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {managersByLayer.map(([level, people]) => (
              <optgroup key={`level-${level}`} label={formatOrgChartLevelLabel(level)}>
                {people.map((m) => (
                  <option key={m.id} value={m.id}>
                    {orgChartOptionLabel(
                      m,
                      outlineById.get(m.id) ?? displayOutline,
                      outlineById,
                    )}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5 nodrag nopan">
          <button
            type="button"
            disabled={busy}
            aria-label={
              locked
                ? lockCount > 1
                  ? `Unlock ${lockCount} selected`
                  : "Unlock reports-to"
                : lockCount > 1
                  ? `Lock ${lockCount} selected`
                  : "Lock to current manager"
            }
            title={
              locked
                ? lockCount > 1
                  ? `Unlock ${lockCount} selected members`
                  : "Unlock — allow changing reports-to"
                : lockCount > 1
                  ? `Lock ${lockCount} selected members to their current managers`
                  : "Lock to current manager (moves with them when reparented)"
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleParentLock(node.id, !locked);
            }}
            onPointerDown={(e) => {
              // Keep React Flow from treating this as a node drag/click that
              // can clear selection or fight the lock action.
              e.stopPropagation();
            }}
            className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
              locked
                ? "border-amber-400/80 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
                : "border-zinc-300 bg-zinc-50 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            }`}
          >
            {locked ? (
              <Lock className="size-3.5 shrink-0 stroke-[2.5]" aria-hidden />
            ) : (
              <LockOpen className="size-3.5 shrink-0 stroke-[2.5]" aria-hidden />
            )}
            <span>
              {locked
                ? lockCount > 1
                  ? `Unlock ${lockCount}`
                  : "Locked"
                : lockCount > 1
                  ? `Lock ${lockCount}`
                  : "Lock"}
            </span>
          </button>
          <button
            type="button"
            disabled={busy || siblingIndex === 0}
            aria-label="Move up among peers"
            title="Move up among peers"
            onClick={(e) => {
              e.stopPropagation();
              onMove(node.id, true);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-300 bg-zinc-50 px-2 text-[11px] font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <ArrowUp className="size-3.5 shrink-0 stroke-[2.5]" aria-hidden />
            <span>Up</span>
          </button>
          <button
            type="button"
            disabled={busy || siblingIndex === siblingCount - 1}
            aria-label="Move down among peers"
            title="Move down among peers"
            onClick={(e) => {
              e.stopPropagation();
              onMove(node.id, false);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-300 bg-zinc-50 px-2 text-[11px] font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <ArrowDown className="size-3.5 shrink-0 stroke-[2.5]" aria-hidden />
            <span>Down</span>
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label="Remove from chart"
            title="Remove from chart"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(node.id, kidsCount);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-300/70 bg-rose-50 px-2 text-[11px] font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
          >
            <Trash2 className="size-3.5 shrink-0 stroke-[2.5]" aria-hidden />
            <span>Remove</span>
          </button>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        className="!h-0.5 !w-0.5 !opacity-0"
      />
    </article>
  );
});

const nodeTypes = { orgBox: OrgBox };

/** Section id plus all nested child departments (depth-first). */
function collectSectionSubtreeIds(
  rootId: string,
  childrenByParent: Map<string | null, OrgChartSectionRow[]>,
): string[] {
  const ids: string[] = [rootId];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const child = stack.pop()!;
    ids.push(child.id);
    stack.push(...(childrenByParent.get(child.id) ?? []));
  }
  return ids;
}

function membersOfSectionTree(
  nodes: OrgChartDiagramNode[],
  rootSectionId: string,
  childrenByParent: Map<string | null, OrgChartSectionRow[]>,
): OrgChartDiagramNode[] {
  const sectionIds = new Set(collectSectionSubtreeIds(rootSectionId, childrenByParent));
  const seen = new Set<string>();
  const out: OrgChartDiagramNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const inTree =
      (n.sectionId && sectionIds.has(n.sectionId)) ||
      (n.sectionMemberships ?? []).some((m) => sectionIds.has(m.sectionId));
    if (!inTree) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

/** Scope reports-to layout to members of this department and all nested sub-departments. */
function scopeNodesForSectionView(
  nodes: OrgChartDiagramNode[],
  sectionId: string,
  childrenByParent: Map<string | null, OrgChartSectionRow[]>,
): OrgChartDiagramNode[] {
  const members = membersOfSectionTree(nodes, sectionId, childrenByParent);
  const ids = new Set(members.map((m) => m.id));
  return members.map((n) => ({
    ...n,
    parentId: n.parentId && ids.has(n.parentId) ? n.parentId : null,
    parentEitherOrLinkId:
      n.parentEitherOrLinkId && n.parentId && ids.has(n.parentId)
        ? n.parentEitherOrLinkId
        : null,
  }));
}

function sectionLabelForNode(
  node: OrgChartDiagramNode,
  sectionNameById?: Map<string, string>,
): string | null {
  const fromMemberships = (node.sectionMemberships ?? [])
    .map((m) => sectionNameById?.get(m.sectionId)?.trim())
    .filter((label): label is string => Boolean(label));
  if (fromMemberships.length > 0) {
    return [...new Set(fromMemberships)].join(" · ");
  }
  if (node.sectionId) {
    return sectionNameById?.get(node.sectionId)?.trim() || null;
  }
  return null;
}

/** Angular (elbow) tree layout: children centered under their manager (horizontal siblings). */
function computeLayout(
  nodes: OrgChartDiagramNode[],
  sections: OrgChartSectionRow[] = [],
  layoutOptions?: OrgChartLayoutOptions,
) {
  const childrenOf = buildOrgChartChildrenOf(nodes, sections, layoutOptions);

  const widthOf = new Map<string, number>();
  function subtreeWidth(id: string): number {
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) return NODE_W;
    const w =
      kids.reduce((sum, k) => sum + subtreeWidth(k.id), 0) + X_GAP * (kids.length - 1);
    widthOf.set(id, w);
    return w;
  }

  const positions = new Map<string, { x: number; y: number }>();
  function place(id: string, left: number, depth: number): number {
    const kids = childrenOf.get(id) ?? [];
    const w = widthOf.get(id) ?? subtreeWidth(id);
    const x = left + (w - NODE_W) / 2;
    positions.set(id, { x, y: depth * (NODE_H + Y_GAP) });
    const childrenWidth =
      kids.reduce((sum, k) => sum + (widthOf.get(k.id) ?? NODE_W), 0) +
      X_GAP * Math.max(0, kids.length - 1);
    let childLeft = left + (w - childrenWidth) / 2;
    for (const kid of kids) {
      childLeft = place(kid.id, childLeft, depth + 1) + X_GAP;
    }
    return left + w;
  }

  const roots = childrenOf.get(null) ?? [];
  let cursor = 0;
  for (const root of roots) {
    cursor = place(root.id, cursor, 0) + X_ROOT_GAP;
  }
  return { positions, childrenOf, roots };
}

export type OrgChartEitherOrLinkRow = {
  id: string;
  nodeAId: string;
  nodeBId: string;
};

const SUB_CONTENT_W = 320;
/** Indent for nested subs (e.g. AREA under LPG WHOLESALE) so they don't look like peers. */
const NEST_INDENT = 28;
const SECTION_COLUMN_W = SUB_CONTENT_W + NEST_INDENT;
/** Main department header bar (dark blue, horizontal row of peers). */
const MAIN_NODE_W = SUB_CONTENT_W;
const MAIN_NODE_H = 52;
/** Sub-department row: yellow label + head name to the right. */
const SUB_BOX_W = 168;
const SUB_NAME_W = 140;
const SUB_NODE_W = SUB_CONTENT_W;
const SUB_NODE_H = 40;
const SECTION_X_GAP = 28;
const SECTION_X_ROOT_GAP = 40;
const SECTION_Y_GAP = 12;
const SECTION_Y_GAP_AFTER_MAIN = 18;
const PERSON_PREFIX = "person:";

type SectionBoxData = {
  section: OrgChartSectionRow;
  memberCount: number;
  subsectionCount: number;
  /** Main = blue header; sub = yellow box + head name (Amalgamated-style TO). */
  variant: "main" | "sub";
  /** 0 = main, 1 = direct sub, 2+ = nested under another sub. */
  nestDepth: number;
};

type SectionTreeNodeType = Node<SectionBoxData, "sectionBox"> | OrgBoxNodeType;

function personAnchorId(nodeId: string) {
  return `${PERSON_PREFIX}${nodeId}`;
}

function isMainDepartment(
  section: OrgChartSectionRow,
  sectionIds: Set<string>,
): boolean {
  if (section.reportsToNodeId) return true;
  if (section.parentId && sectionIds.has(section.parentId)) return false;
  return true;
}

function sectionNodeHeight(variant: "main" | "sub") {
  return variant === "main" ? MAIN_NODE_H : SUB_NODE_H;
}

function computeSectionTreeLayout(
  sections: OrgChartSectionRow[],
  peopleById: Map<string, OrgChartDiagramNode>,
  individualNodes: OrgChartDiagramNode[] = [],
) {
  const { byParent: childrenOf, personParentIds } = buildSectionTreeChildrenOf(sections);
  const sectionIds = new Set(sections.map((s) => s.id));
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const individualIds = new Set(individualNodes.map((n) => n.id));
  const individualChildren = new Map<string | null, OrgChartDiagramNode[]>();
  for (const n of individualNodes) {
    const parentId =
      n.parentId && individualIds.has(n.parentId) ? n.parentId : null;
    const list = individualChildren.get(parentId) ?? [];
    list.push(n);
    individualChildren.set(parentId, list);
  }
  for (const [, list] of individualChildren) {
    list.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.personName.localeCompare(b.personName),
    );
  }

  const widthOf = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();

  function variantOf(id: string): "main" | "sub" {
    const s = sectionById.get(id);
    if (!s) return "main";
    return isMainDepartment(s, sectionIds) ? "main" : "sub";
  }

  /**
   * Sub-departments stack vertically under their parent (single column).
   * Nested levels (AREA under Wholesale, etc.) indent so they read as children,
   * not peers of the parent department.
   */
  function placeSection(id: string, x: number, y: number, depth = 0): number {
    positions.set(id, { x, y });
    const h = sectionNodeHeight(variantOf(id));
    const kids = childrenOf.get(id) ?? [];
    const gapAfter =
      variantOf(id) === "main" ? SECTION_Y_GAP_AFTER_MAIN : SECTION_Y_GAP;
    let childY = y + h + gapAfter;
    for (const kid of kids) {
      // depth 0 = main header; depth 1 = its direct yellows; depth 2+ = indent.
      const childX = depth >= 1 ? x + NEST_INDENT : x;
      childY = placeSection(kid.id, childX, childY, depth + 1) + SECTION_Y_GAP;
    }
    return childY - SECTION_Y_GAP;
  }

  /** Width of N main departments laid out horizontally. */
  function mainDepartmentsWidth(count: number): number {
    if (count <= 0) return 0;
    return count * SECTION_COLUMN_W + SECTION_X_GAP * (count - 1);
  }

  /**
   * Main departments (siblings under a person): horizontal row; each column
   * then stacks its own sub-departments vertically via placeSection.
   */
  function placeMainDepartmentsHorizontal(
    deptKids: OrgChartSectionRow[],
    left: number,
    y: number,
  ): { right: number; bottom: number } {
    if (deptKids.length === 0) return { right: left, bottom: y };
    const rowW = mainDepartmentsWidth(deptKids.length);
    let childLeft = left;
    let bottom = y;
    for (const kid of deptKids) {
      bottom = Math.max(bottom, placeSection(kid.id, childLeft, y));
      childLeft += SECTION_COLUMN_W + SECTION_X_GAP;
    }
    return { right: left + rowW, bottom };
  }

  function placePersonRoot(personId: string, left: number): number {
    const anchorKey = personAnchorId(personId);
    const kids = childrenOf.get(anchorKey) ?? [];
    const rowW = mainDepartmentsWidth(kids.length);
    const w = Math.max(rowW, SECTION_COLUMN_W, NODE_W);
    positions.set(anchorKey, { x: left + (w - NODE_W) / 2, y: 0 });
    const childY = NODE_H + SECTION_Y_GAP_AFTER_MAIN;
    const childLeft = left + (w - rowW) / 2;
    placeMainDepartmentsHorizontal(kids, childLeft, childY);
    return left + w;
  }

  /** Chart-only people stay horizontal (siblings side-by-side under managers). */
  function individualSubtreeWidth(id: string): number {
    const kids = individualChildren.get(id) ?? [];
    const deptKids = childrenOf.get(personAnchorId(id)) ?? [];
    const peopleW =
      kids.length === 0
        ? 0
        : kids.reduce((sum, k) => sum + individualSubtreeWidth(k.id), 0) +
          SECTION_X_GAP * Math.max(0, kids.length - 1);
    const deptW = mainDepartmentsWidth(deptKids.length);
    // Departments that report to this person sit beside person-reports (not under them),
    // so Audit-under-CEO stays a horizontal peer of the COO column instead of centering
    // under Accounting.
    let contentW = NODE_W;
    if (deptW > 0 && peopleW > 0) contentW = deptW + SECTION_X_GAP + peopleW;
    else if (deptW > 0) contentW = deptW;
    else if (peopleW > 0) contentW = peopleW;
    const w = Math.max(NODE_W, contentW);
    widthOf.set(`indiv:${id}`, w);
    return w;
  }

  /**
   * Place a chart-only person tree. Departments that report to this person must be
   * laid out here too — they are excluded from top-level roots, and personRoots
   * skips individuals to avoid double cards.
   *
   * Direct-report departments and direct-report people are horizontal siblings
   * under this person (e.g. Audit Committee | COO), not stacked under the people tree.
   */
  function placeIndividual(
    id: string,
    left: number,
    y: number,
  ): { right: number; bottom: number } {
    const kids = individualChildren.get(id) ?? [];
    const deptKids = childrenOf.get(personAnchorId(id)) ?? [];
    const w = widthOf.get(`indiv:${id}`) ?? individualSubtreeWidth(id);
    positions.set(id, { x: left + (w - NODE_W) / 2, y });

    const childY = y + NODE_H + SECTION_Y_GAP_AFTER_MAIN;
    const peopleW =
      kids.length === 0
        ? 0
        : kids.reduce((sum, k) => sum + (widthOf.get(`indiv:${k.id}`) ?? NODE_W), 0) +
          SECTION_X_GAP * Math.max(0, kids.length - 1);
    const deptW = mainDepartmentsWidth(deptKids.length);
    let contentW = 0;
    if (deptW > 0 && peopleW > 0) contentW = deptW + SECTION_X_GAP + peopleW;
    else contentW = Math.max(deptW, peopleW);

    let childLeft = left + Math.max(0, (w - contentW) / 2);
    let bottom = y + NODE_H;

    // Department columns first (left), then people — matches TO: Audit beside CEO/COO line.
    if (deptKids.length > 0) {
      const placed = placeMainDepartmentsHorizontal(deptKids, childLeft, childY);
      bottom = Math.max(bottom, placed.bottom);
      childLeft = placed.right + (peopleW > 0 ? SECTION_X_GAP : 0);
    }
    for (const kid of kids) {
      const placed = placeIndividual(kid.id, childLeft, childY);
      childLeft = placed.right + SECTION_X_GAP;
      bottom = Math.max(bottom, placed.bottom);
    }

    return { right: left + w, bottom };
  }

  const topSections = childrenOf.get(null) ?? [];
  // People that departments report to — skip chart-only individuals (handled in placeIndividual).
  const personRoots = [...personParentIds]
    .filter((id) => !individualIds.has(id))
    .sort((a, b) => {
      const na = peopleById.get(a)?.personName ?? a;
      const nb = peopleById.get(b)?.personName ?? b;
      return na.localeCompare(nb);
    });
  const individualRoots = individualChildren.get(null) ?? [];

  let cursor = 0;
  for (const person of individualRoots) {
    individualSubtreeWidth(person.id);
    cursor = placeIndividual(person.id, cursor, 0).right + SECTION_X_ROOT_GAP;
  }
  for (const personId of personRoots) {
    cursor = placePersonRoot(personId, cursor) + SECTION_X_ROOT_GAP;
  }
  // Main (top-level) departments: horizontal row; subs stack vertically inside each.
  for (const root of topSections) {
    placeSection(root.id, cursor, 0);
    cursor += SECTION_COLUMN_W + SECTION_X_ROOT_GAP;
  }

  // Safety net: never leave departments unpositioned (e.g. reports-to person missing).
  for (const section of sections) {
    if (positions.has(section.id)) continue;
    if (
      !section.reportsToNodeId &&
      section.parentId &&
      sectionIds.has(section.parentId) &&
      !positions.has(section.parentId)
    ) {
      continue;
    }
    placeSection(section.id, cursor, 0);
    cursor += SECTION_COLUMN_W + SECTION_X_ROOT_GAP;
  }

  return { positions, childrenOf, personParentIds, individualIds };
}

const SectionBox = memo(function SectionBox({ data }: NodeProps<Node<SectionBoxData, "sectionBox">>) {
  const { section, memberCount, subsectionCount, variant, nestDepth } = data;
  const headLine = section.headName?.trim() || "";
  const headMeta = [section.headRole, section.headCompanyName].filter(Boolean).join(" · ");

  if (variant === "main") {
    return (
      <article
        style={{ width: MAIN_NODE_W, height: MAIN_NODE_H }}
        className="cursor-grab active:cursor-grabbing"
        title={`${section.name} — ${memberCount} members${subsectionCount ? `, ${subsectionCount} sub` : ""}. Drag to nest · Click to open`}
      >
        <Handle type="target" position={Position.Top} id="in" className="!h-0.5 !w-0.5 !opacity-0" />
        <div className="flex h-full w-full items-center justify-center rounded-sm bg-[#1e3a5f] px-2 text-center shadow-sm transition hover:bg-[#254a73] dark:bg-[#243b55] dark:hover:bg-[#2f4a68]">
          <h3 className="line-clamp-2 text-[11px] font-bold uppercase leading-tight tracking-wide text-white">
            {section.name}
          </h3>
        </div>
        <Handle type="source" position={Position.Bottom} id="out" className="!h-0.5 !w-0.5 !opacity-0" />
      </article>
    );
  }

  const nested = nestDepth >= 2;

  return (
    <article
      style={{ width: SUB_NODE_W, height: SUB_NODE_H }}
      className="cursor-grab active:cursor-grabbing"
      title={`${section.name}${headLine ? ` — ${headLine}` : ""}. Drag to nest · Click to open`}
    >
      <Handle type="target" position={Position.Top} id="in" className="!h-0.5 !w-0.5 !opacity-0" />
      <div className="flex h-full w-full items-center justify-center gap-2">
        <div
          style={{ width: SUB_BOX_W, minWidth: SUB_BOX_W }}
          className={`flex h-full items-center justify-center rounded-sm border px-1.5 text-center shadow-sm transition hover:brightness-95 ${
            nested
              ? "border-amber-600/70 bg-[#ffe9a8] dark:border-amber-500 dark:bg-amber-300/90"
              : "border-amber-500/80 bg-[#f5d76e] dark:border-amber-600 dark:bg-amber-400"
          }`}
        >
          <p className="line-clamp-2 text-[9px] font-bold uppercase leading-tight tracking-wide text-[#1e3a5f]">
            {section.name}
          </p>
        </div>
        <div style={{ width: SUB_NAME_W, minWidth: SUB_NAME_W }} className="min-w-0 text-left">
          {headLine ? (
            <>
              <p className="truncate text-[10px] font-bold uppercase leading-tight text-[#1e3a5f] dark:text-sky-100">
                {headLine}
              </p>
              {headMeta ? (
                <p className="truncate text-[9px] text-zinc-500 dark:text-zinc-400">{headMeta}</p>
              ) : null}
            </>
          ) : (
            <p className="truncate text-[9px] italic text-zinc-400">No head</p>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="out" className="!h-0.5 !w-0.5 !opacity-0" />
    </article>
  );
});

const sectionNodeTypes = {
  sectionBox: SectionBox,
  orgBox: OrgBox,
};

const sectionEdgeTypes = {
  orgTree: OrgTreeEdge,
};

function SectionTreeCanvas({
  sections,
  nodes,
  memberCountBySection,
  childrenByParent,
  eitherOrLinks,
  busy,
  onOpenSection,
  onReparentSection,
  onSetSectionReportsTo,
  onReparent,
  onMove,
  onRemove,
  onToggleParentLock,
  onSelectNode,
}: {
  sections: OrgChartSectionRow[];
  nodes: OrgChartDiagramNode[];
  memberCountBySection: Map<string, number>;
  childrenByParent: Map<string | null, OrgChartSectionRow[]>;
  eitherOrLinks: OrgChartEitherOrLinkRow[];
  busy: boolean;
  onOpenSection: (sectionId: string) => void;
  onReparentSection: (sectionId: string, newParentId: string | null) => void;
  onSetSectionReportsTo: (sectionId: string, reportsToNodeId: string) => void;
  onReparent: (id: string, parentId: string) => void;
  onMove: (id: string, moveUp: boolean) => void;
  onRemove: (id: string, reports: number) => void;
  onToggleParentLock: (id: string, locked: boolean) => void;
  onSelectNode?: (node: OrgChartNode | null) => void;
}) {
  const { fitView } = useReactFlow();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const peopleById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const sectionNameById = useMemo(
    () => new Map(sections.map((s) => [s.id, s.name])),
    [sections],
  );
  const sectionsLayoutKey = useMemo(() => orgChartSectionsLayoutKey(sections), [sections]);
  const layerById = useMemo(() => orgChartLayerById(nodes), [nodes]);
  const childrenOf = useMemo(
    () => buildOrgChartChildrenOf(nodes, sections),
    [nodes, sections, sectionsLayoutKey],
  );
  const outlineById = useMemo(
    () => orgChartPersonOutlineFromLayout(childrenOf),
    [childrenOf],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const individualNodes = useMemo(() => chartOnlyNodes(nodes), [nodes]);
  const { positions, personParentIds, individualIds } = useMemo(
    () => computeSectionTreeLayout(sections, peopleById, individualNodes),
    [sections, peopleById, individualNodes],
  );

  const descendants = useMemo(() => {
    const result = new Map<string, Set<string>>();
    const visit = (id: string): Set<string> => {
      const set = new Set<string>();
      for (const child of childrenOf.get(id) ?? []) {
        set.add(child.id);
        for (const d of visit(child.id)) set.add(d);
      }
      return set;
    };
    for (const n of nodes) result.set(n.id, visit(n.id));
    return result;
  }, [childrenOf, nodes]);

  const siblingInfo = useMemo(() => {
    const info = new Map<string, { index: number; count: number }>();
    for (const list of childrenOf.values()) {
      list.forEach((n, index) => info.set(n.id, { index, count: list.length }));
    }
    for (const n of nodes) {
      if (!info.has(n.id)) info.set(n.id, { index: 0, count: 1 });
    }
    return info;
  }, [childrenOf, nodes]);

  const sharedKidsByPeer = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of eitherOrLinks) {
      const count = (childrenOf.get(link.nodeAId) ?? []).length;
      map.set(link.nodeBId, (map.get(link.nodeBId) ?? 0) + count);
    }
    return map;
  }, [eitherOrLinks, childrenOf]);

  const sectionTreeDescendants = useMemo(() => {
    const map = new Map<string, Set<string>>();
    function collect(id: string): Set<string> {
      const cached = map.get(id);
      if (cached) return cached;
      const kids = childrenByParent.get(id) ?? [];
      const set = new Set<string>();
      for (const kid of kids) {
        set.add(kid.id);
        for (const d of collect(kid.id)) set.add(d);
      }
      map.set(id, set);
      return set;
    }
    for (const s of sections) collect(s.id);
    return map;
  }, [sections, childrenByParent]);

  const diagramSize = useMemo(() => {
    const sectionIds = new Set(sections.map((s) => s.id));
    let w = 0;
    let h = 0;
    for (const [id, p] of positions) {
      const isPerson = id.startsWith(PERSON_PREFIX) || peopleById.has(id);
      if (isPerson) {
        w = Math.max(w, p.x + NODE_W);
        h = Math.max(h, p.y + NODE_H);
        continue;
      }
      const section = sectionById.get(id);
      const variant =
        section && isMainDepartment(section, sectionIds) ? "main" : "sub";
      w = Math.max(w, p.x + SECTION_COLUMN_W);
      h = Math.max(h, p.y + sectionNodeHeight(variant));
    }
    return { w: Math.max(w, 400), h: Math.max(h, 280) };
  }, [positions, peopleById, sections, sectionById]);
  // Primitive key so lock/busy node refreshes do not refit the viewport.
  const diagramSizeKey = `${diagramSize.w}x${diagramSize.h}`;

  const layoutNodes = useMemo<SectionTreeNodeType[]>(() => {
    const sectionIds = new Set(sections.map((s) => s.id));

    function nestDepthOf(sectionId: string): number {
      let depth = 0;
      let cur = sectionById.get(sectionId);
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        // Person reports-to stops the department nest (that section is a main).
        if (cur.reportsToNodeId) break;
        if (cur.parentId && sectionIds.has(cur.parentId)) {
          depth += 1;
          cur = sectionById.get(cur.parentId);
          continue;
        }
        break;
      }
      return depth;
    }

    const sectionNodes: SectionTreeNodeType[] = sections.map((section) => {
      const variant = isMainDepartment(section, sectionIds) ? "main" : "sub";
      const nestDepth = nestDepthOf(section.id);
      return {
        id: section.id,
        type: "sectionBox",
        position: positions.get(section.id) ?? { x: 0, y: 0 },
        width: variant === "main" ? MAIN_NODE_W : SUB_NODE_W,
        height: sectionNodeHeight(variant),
        draggable: !busy,
        selectable: true,
        data: {
          section,
          memberCount: memberCountBySection.get(section.id) ?? 0,
          subsectionCount: (childrenByParent.get(section.id) ?? []).length,
          variant,
          nestDepth,
        },
      };
    });
    const personIdsToShow = new Set<string>([...personParentIds, ...individualIds]);
    const personNodes: OrgBoxNodeType[] = [...personIdsToShow].flatMap((personId) => {
      const person = peopleById.get(personId);
      if (!person) return [];
      const isIndividual = individualIds.has(personId);
      const pos =
        positions.get(personId) ??
        positions.get(personAnchorId(personId));
      if (!pos) return [];
      const sibling = siblingInfo.get(personId) ?? { index: 0, count: 1 };
      const managerOptions = nodes.filter(
        (m) => m.id !== personId && !(descendants.get(personId)?.has(m.id) ?? false),
      );
      const eitherOrParentOptions = eitherOrLinks
        .filter((link) => {
          if (link.nodeAId === personId || link.nodeBId === personId) return false;
          if (descendants.get(personId)?.has(link.nodeAId)) return false;
          if (descendants.get(personId)?.has(link.nodeBId)) return false;
          return true;
        })
        .map((link) => ({
          value: encodeReportsToValue({ parentEitherOrLinkId: link.id }),
          label: eitherOrLinkLabel(link, byId),
        }));
      return [
        {
          id: personId,
          type: "orgBox",
          position: pos,
          width: NODE_W,
          height: NODE_H,
          draggable: false,
          selectable: isIndividual,
          zIndex: 2,
          data: {
            node: person,
            kidsCount:
              (childrenOf.get(personId) ?? []).length + (sharedKidsByPeer.get(personId) ?? 0),
            managersByLayer: groupManagersByLayer(managerOptions, layerById, outlineById),
            eitherOrParentOptions,
            reportsToValue: encodeReportsToValue({
              parentId: person.parentId,
              parentEitherOrLinkId: person.parentEitherOrLinkId,
            }),
            nodeLayer: layerById.get(personId) ?? 1,
            outline: outlineById.get(personId) ?? "1",
            outlineById,
            siblingIndex: sibling.index,
            siblingCount: sibling.count,
            busy,
            selected: false,
            selectionLockCount: 1,
            sectionLabel: isIndividual
              ? "Individual (no department)"
              : sectionLabelForNode(person, sectionNameById),
            onReparent,
            onMove,
            onRemove,
            onToggleParentLock,
          },
        },
      ];
    });
    return [...personNodes, ...sectionNodes];
  }, [
    sections,
    positions,
    memberCountBySection,
    childrenByParent,
    personParentIds,
    individualIds,
    peopleById,
    sectionById,
    busy,
    outlineById,
    layerById,
    sectionNameById,
    childrenOf,
    descendants,
    siblingInfo,
    sharedKidsByPeer,
    eitherOrLinks,
    nodes,
    byId,
    onReparent,
    onMove,
    onRemove,
    onToggleParentLock,
  ]);

  const [liveNodes, setLiveNodes] = useState<SectionTreeNodeType[]>(layoutNodes);
  useEffect(() => {
    setLiveNodes((current) => {
      const prevById = new Map(current.map((n) => [n.id, n]));
      return layoutNodes.map((n) => {
        const prev = prevById.get(n.id);
        if (
          prev &&
          prev.position.x === n.position.x &&
          prev.position.y === n.position.y
        ) {
          return { ...n, position: prev.position, selected: prev.selected };
        }
        return n;
      });
    });
  }, [layoutNodes]);

  const rfEdges = useMemo<Edge[]>(() => {
    const sectionIds = new Set(sections.map((s) => s.id));
    type Pending = { id: string; source: string; target: string };
    const pending: Pending[] = [];

    for (const s of sections) {
      if (!positions.has(s.id)) continue;
      if (s.reportsToNodeId) {
        const source = s.reportsToNodeId;
        const hasPerson =
          positions.has(source) || positions.has(personAnchorId(source));
        if (!hasPerson) continue;
        pending.push({
          id: `dept-person-edge-${s.id}`,
          source,
          target: s.id,
        });
      } else if (s.parentId && positions.has(s.parentId)) {
        pending.push({
          id: `dept-edge-${s.id}`,
          source: s.parentId,
          target: s.id,
        });
      }
    }
    for (const n of individualNodes) {
      if (!n.parentId || !individualIds.has(n.parentId)) continue;
      if (!positions.has(n.id) || !positions.has(n.parentId)) continue;
      pending.push({
        id: `indiv-edge-${n.id}`,
        source: n.parentId,
        target: n.id,
      });
    }

    function sourceBottomY(sourceId: string): number | null {
      const pos =
        positions.get(sourceId) ?? positions.get(personAnchorId(sourceId));
      if (!pos) return null;
      if (peopleById.has(sourceId) || sourceId.startsWith(PERSON_PREFIX)) {
        return pos.y + NODE_H;
      }
      const section = sectionById.get(sourceId);
      const variant =
        section && isMainDepartment(section, sectionIds) ? "main" : "sub";
      return pos.y + sectionNodeHeight(variant);
    }

    const bySource = new Map<string, Pending[]>();
    for (const edge of pending) {
      const list = bySource.get(edge.source) ?? [];
      list.push(edge);
      bySource.set(edge.source, list);
    }

    const edges: Edge[] = [];
    for (const [source, group] of bySource) {
      const bottom = sourceBottomY(source);
      const childTops = group
        .map((e) => positions.get(e.target)?.y)
        .filter((y): y is number => typeof y === "number");
      if (bottom == null || childTops.length === 0) continue;

      const minChildTop = Math.min(...childTops);
      const maxChildTop = Math.max(...childTops);
      // Same-rank row (main departments under a person) → one shared bus.
      // Vertical stack (subs / nested AREAs) → elbow just above each child.
      const sameRank = maxChildTop - minChildTop < 24;
      const sharedBusY =
        bottom + Math.min(16, Math.max(8, Math.max(0, minChildTop - bottom) * 0.5));

      for (const edge of group) {
        const targetTop = positions.get(edge.target)?.y;
        if (targetTop == null) continue;
        const busY = sameRank
          ? sharedBusY
          : Math.max(bottom + 6, targetTop - 8);

        edges.push({
          id: edge.id,
          type: "orgTree",
          source: edge.source,
          target: edge.target,
          sourceHandle: "out",
          targetHandle: "in",
          data: { busY },
          style: {
            stroke: "var(--org-tree-line)",
            strokeWidth: 1.75,
          },
          zIndex: 0,
        } as Edge);
      }
    }
    return edges;
  }, [sections, positions, individualNodes, individualIds, peopleById, sectionById]);

  const layoutKey = useMemo(
    () =>
      sections
        .map(
          (s) =>
            `${s.id}:${s.parentId ?? ""}:${s.reportsToNodeId ?? ""}:${s.sortOrder}`,
        )
        .join("|"),
    [sections],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function applyViewport() {
      const target = containerRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      fitView({ padding: 0.12, maxZoom: 1.05, duration: 0 });
    }

    // Refit when the tree structure / diagram size changes.
    applyViewport();

    // Do not refit on tiny resizes (e.g. success banner appearing after Lock).
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      const target = containerRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const becameVisible = (lastW < 8 || lastH < 8) && w >= 8 && h >= 8;
      const bigChange = Math.abs(w - lastW) > 80 || Math.abs(h - lastH) > 120;
      lastW = w;
      lastH = h;
      if (becameVisible || bigChange) applyViewport();
    });
    ro.observe(el);

    let wasVisible = false;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio > 0);
        if (visible && !wasVisible) {
          requestAnimationFrame(applyViewport);
        }
        wasVisible = visible;
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [fitView, layoutKey, diagramSizeKey]);

  const draggingIdRef = useRef<string | null>(null);
  const didDragRef = useRef(false);
  const overIdRef = useRef<string | null>(null);
  const nodeElsRef = useRef<Map<string, DOMRect>>(new Map());

  function measureNodeRects() {
    const el = containerRef.current;
    if (!el) return;
    const next = new Map<string, DOMRect>();
    for (const wrapper of el.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const id = wrapper.getAttribute("data-id");
      if (id) next.set(id, wrapper.getBoundingClientRect());
    }
    nodeElsRef.current = next;
  }

  function nodeAtScreenPoint(clientX: number, clientY: number): string | null {
    let hit: string | null = null;
    for (const [id, r] of nodeElsRef.current) {
      if (id === draggingIdRef.current) continue;
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        hit = id;
      }
    }
    return hit;
  }

  function setDropTargetClass(nextId: string | null) {
    const el = containerRef.current;
    if (!el) return;
    const prev = overIdRef.current;
    if (prev === nextId) return;
    if (prev) {
      el.querySelector(`[data-id="${prev}"]`)?.classList.remove("org-chart-drop-target");
    }
    if (nextId) {
      el.querySelector(`[data-id="${nextId}"]`)?.classList.add("org-chart-drop-target");
    }
    overIdRef.current = nextId;
  }

  function isEligibleSectionTarget(draggingId: string, targetId: string) {
    if (targetId === draggingId) return false;
    if (personParentIds.has(targetId) || individualIds.has(targetId)) return true;
    if (sectionTreeDescendants.get(draggingId)?.has(targetId)) return false;
    const dragging = sectionById.get(draggingId);
    if (!dragging) return false;
    // Already nested under this department (and not via a person reports-to).
    if (dragging.parentId === targetId && !dragging.reportsToNodeId) return false;
    return true;
  }

  const onNodesChange = useCallback((changes: NodeChange<SectionTreeNodeType>[]) => {
    setLiveNodes((current) => {
      if (draggingIdRef.current) {
        const positionChanges = changes.filter((change) => change.type === "position");
        if (positionChanges.length > 0) {
          return applyNodeChanges(positionChanges, current);
        }
      }
      const otherChanges = changes.filter((change) => change.type !== "position");
      if (otherChanges.length === 0) return current;
      return applyNodeChanges(otherChanges, current);
    });
  }, []);

  const handleNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      if (didDragRef.current) {
        didDragRef.current = false;
        return;
      }
      if (node.type === "orgBox") {
        const orgNode = node as OrgBoxNodeType;
        onSelectNode?.(orgNode.data.node);
        return;
      }
      if (node.type === "sectionBox" && !node.id.startsWith(PERSON_PREFIX)) {
        onOpenSection(node.id);
      }
    },
    [onOpenSection, onSelectNode],
  );

  return (
    <div className="relative h-[640px] w-full min-h-[640px] org-chart-flow">
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-950/40"
      >
        <ReactFlow
          nodes={liveNodes}
          edges={rfEdges}
          nodeTypes={sectionNodeTypes}
          edgeTypes={sectionEdgeTypes}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeClick}
          onNodesChange={onNodesChange}
          onNodeDragStart={(_, node) => {
            if (node.type !== "sectionBox" || busy) return;
            draggingIdRef.current = node.id;
            didDragRef.current = false;
            setDropTargetClass(null);
            measureNodeRects();
          }}
          onNodeDrag={(event, node) => {
            if (!draggingIdRef.current) return;
            didDragRef.current = true;
            const cx = "clientX" in event ? event.clientX : 0;
            const cy = "clientY" in event ? event.clientY : 0;
            const hit = nodeAtScreenPoint(cx, cy);
            const next =
              hit && isEligibleSectionTarget(node.id, hit) ? hit : null;
            setDropTargetClass(next);
          }}
          onNodeDragStop={(_, node) => {
            const target = overIdRef.current;
            const draggingId = draggingIdRef.current;
            draggingIdRef.current = null;
            setDropTargetClass(null);
            setLiveNodes(layoutNodes);
            if (!draggingId || !target || !didDragRef.current) return;
            if (!isEligibleSectionTarget(draggingId, target)) return;
            if (personParentIds.has(target) || individualIds.has(target)) {
              onSetSectionReportsTo(draggingId, target);
              return;
            }
            onReparentSection(draggingId, target);
          }}
          onInit={(instance) => {
            requestAnimationFrame(() => {
              const el = containerRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              if (!rect.width || !rect.height) return;
              instance.fitView({ padding: 0.12, maxZoom: 1.05, duration: 0 });
            });
          }}
          defaultEdgeOptions={SECTION_TREE_EDGE_OPTIONS}
          minZoom={0.05}
          maxZoom={2.5}
          nodesConnectable={false}
          nodesDraggable={!busy}
          edgesReconnectable={false}
          deleteKeyCode={null}
          elementsSelectable={false}
          selectNodesOnDrag={false}
          panOnDrag
          zoomOnScroll
          fitView={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1.5}
            color="var(--org-line)"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

function isOutsideSectionsId(id: string | null | undefined): boolean {
  return id === ORG_CHART_OUTSIDE_SECTIONS_ID;
}

function nodeHasAnySection(n: OrgChartDiagramNode): boolean {
  if (n.sectionId) return true;
  return (n.sectionMemberships ?? []).some((m) => Boolean(m.sectionId));
}

function chartOnlyNodes(nodes: OrgChartDiagramNode[]): OrgChartDiagramNode[] {
  return nodes.filter((n) => !nodeHasAnySection(n));
}

/** Ancestor path from a root department down to `sectionId` (inclusive). */
function sectionPathFromRoot(
  sectionId: string,
  sectionById: Map<string, OrgChartSectionRow>,
): string[] {
  if (isOutsideSectionsId(sectionId)) return [ORG_CHART_OUTSIDE_SECTIONS_ID];
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: OrgChartSectionRow | undefined = sectionById.get(sectionId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur.id);
    cur = cur.parentId ? sectionById.get(cur.parentId) : undefined;
  }
  return path;
}

export function OrgChartDiagram({
  nodes,
  sections = [],
  busy,
  onReparent,
  onReparentMany,
  onMove,
  onRemove,
  onToggleParentLock,
  onSelectNode,
  onSelectionChange,
  highlightId = null,
  sectionNameById,
  eitherOrLinks = [],
  onCreateEitherOr,
  onRemoveEitherOr,
  onOpenEitherOrPicker,
  onReparentSection,
  onSetSectionReportsTo,
  bulkReportsTo = "",
  onBulkReportsToChange,
  onBulkApply,
  bulkReportsToOptions,
  bulkMovableCount = 0,
  bulkLockedCount = 0,
  onBulkLock,
  onBulkUnlock,
  onRemoveSelected,
  focusSectionRequest = null,
  onCurrentSectionChange,
  drillStack: controlledDrillStack,
  onDrillStackChange,
}: {
  nodes: OrgChartDiagramNode[];
  /** Org-chart departments — top-level browse shows these (+ heads) instead of every person. */
  sections?: OrgChartSectionRow[];
  busy: boolean;
  onReparent: (id: string, parentId: string) => void;
  onReparentMany: (ids: string[], parentId: string) => void;
  onMove: (id: string, moveUp: boolean) => void;
  onRemove: (id: string, reports: number) => void;
  onToggleParentLock: (id: string, locked: boolean) => void;
  onSelectNode: (node: OrgChartNode | null) => void;
  onSelectionChange?: (ids: string[]) => void;
  highlightId?: string | null;
  sectionNameById?: Map<string, string>;
  eitherOrLinks?: OrgChartEitherOrLinkRow[];
  onCreateEitherOr?: (nodeAId: string, nodeBId: string) => void;
  onRemoveEitherOr?: (linkId: string) => void;
  onOpenEitherOrPicker?: (prefillA?: string, prefillB?: string) => void;
  /** Nest a department under another (or clear parent via Manage departments). */
  onReparentSection?: (sectionId: string, newParentId: string | null) => void;
  /** Point a department at a person on the chart (reports-to). */
  onSetSectionReportsTo?: (sectionId: string, reportsToNodeId: string) => void;
  bulkReportsTo?: string;
  onBulkReportsToChange?: (value: string) => void;
  onBulkApply?: () => void;
  bulkReportsToOptions?: BulkReportsToOptions;
  bulkMovableCount?: number;
  bulkLockedCount?: number;
  onBulkLock?: () => void;
  onBulkUnlock?: () => void;
  /** Remove one or more selected chart members (panel + overlay). */
  onRemoveSelected?: (ids: string[]) => void;
  /** When `token` changes, open the given department (full path from root).
   *  Pass `ORG_CHART_OUTSIDE_SECTIONS_ID` to open chart-only members. */
  focusSectionRequest?: { sectionId: string; token: number } | null;
  /** Fired whenever the drilled department changes (null = department overview).
   *  May be `ORG_CHART_OUTSIDE_SECTIONS_ID` for chart-only members. */
  onCurrentSectionChange?: (sectionId: string | null) => void;
  /** Optional controlled drill path — survives chart remounts (e.g. lock refresh). */
  drillStack?: string[];
  onDrillStackChange?: (stack: string[]) => void;
}) {
  const [internalDrillStack, setInternalDrillStack] = useState<string[]>([]);
  const drillStack = controlledDrillStack ?? internalDrillStack;
  const setDrillStack = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      if (controlledDrillStack !== undefined) {
        const resolved =
          typeof next === "function" ? next(controlledDrillStack) : next;
        onDrillStackChange?.(resolved);
        return;
      }
      setInternalDrillStack(next);
    },
    [controlledDrillStack, onDrillStackChange],
  );
  const currentSectionId = drillStack.length > 0 ? drillStack[drillStack.length - 1]! : null;
  const viewingOutsideSections = isOutsideSectionsId(currentSectionId);

  const childrenByParent = useMemo(() => {
    const { byParent } = buildSectionTreeChildrenOf(sections);
    return byParent as Map<string | null, OrgChartSectionRow[]>;
  }, [sections]);

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const sectionByIdRef = useRef(sectionById);
  sectionByIdRef.current = sectionById;

  useEffect(() => {
    if (!focusSectionRequest?.sectionId) return;
    const path = sectionPathFromRoot(
      focusSectionRequest.sectionId,
      sectionByIdRef.current,
    );
    if (path.length === 0) return;
    setDrillStack(path);
    onSelectionChange?.([]);
    onSelectNode(null);
    // Only a new focus request should change the drill — not Map identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSectionRequest]);

  const onCurrentSectionChangeRef = useRef(onCurrentSectionChange);
  onCurrentSectionChangeRef.current = onCurrentSectionChange;
  useEffect(() => {
    onCurrentSectionChangeRef.current?.(currentSectionId);
  }, [currentSectionId]);

  const currentSection = viewingOutsideSections
    ? null
    : currentSectionId
      ? sectionById.get(currentSectionId) ?? null
      : null;
  const childSections =
    !viewingOutsideSections && currentSectionId
      ? (childrenByParent.get(currentSectionId) ?? [])
      : [];

  const outsideNodes = useMemo(() => chartOnlyNodes(nodes), [nodes]);

  const scopedNodes = useMemo(() => {
    if (viewingOutsideSections) {
      const ids = new Set(outsideNodes.map((m) => m.id));
      return outsideNodes.map((n) => ({
        ...n,
        parentId: n.parentId && ids.has(n.parentId) ? n.parentId : null,
        parentEitherOrLinkId:
          n.parentEitherOrLinkId && n.parentId && ids.has(n.parentId)
            ? n.parentEitherOrLinkId
            : null,
      }));
    }
    if (!currentSectionId) return [];
    return scopeNodesForSectionView(nodes, currentSectionId, childrenByParent);
  }, [nodes, currentSectionId, childrenByParent, viewingOutsideSections, outsideNodes]);

  const scopedSectionIds = useMemo(() => {
    if (!currentSectionId) return undefined;
    return new Set(collectSectionSubtreeIds(currentSectionId, childrenByParent));
  }, [currentSectionId, childrenByParent]);

  const hierarchyLayerById = useMemo(() => orgChartLayerById(nodes), [nodes]);

  const scopedEitherOrLinks = useMemo(() => {
    if (!currentSectionId) return [];
    const ids = new Set(scopedNodes.map((n) => n.id));
    return eitherOrLinks.filter((l) => ids.has(l.nodeAId) && ids.has(l.nodeBId));
  }, [eitherOrLinks, scopedNodes, currentSectionId]);

  const memberCountBySection = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sections) {
      map.set(s.id, membersOfSectionTree(nodes, s.id, childrenByParent).length);
    }
    return map;
  }, [sections, nodes, childrenByParent]);

  function openSection(sectionId: string) {
    setDrillStack((prev) => [...prev, sectionId]);
    onSelectionChange?.([]);
    onSelectNode(null);
  }

  const handleOpenSection = useCallback(
    (sectionId: string) => {
      setDrillStack((prev) => [...prev, sectionId]);
      onSelectionChange?.([]);
      onSelectNode(null);
    },
    [onSelectionChange, onSelectNode],
  );

  function goBack() {
    setDrillStack((prev) => prev.slice(0, -1));
    onSelectionChange?.([]);
    onSelectNode(null);
  }

  function jumpToBreadcrumb(index: number) {
    setDrillStack((prev) => prev.slice(0, index + 1));
    onSelectionChange?.([]);
    onSelectNode(null);
  }

  // No sections yet — fall back to the classic full people chart.
  if (sections.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          Create departments under <span className="font-semibold">Manage departments</span> to
          browse by group. Until then, all chart members are shown here.
        </p>
        <ReactFlowProvider>
          <OrgChartCanvas
            nodes={nodes}
            sections={sections}
            busy={busy}
            onReparent={onReparent}
            onReparentMany={onReparentMany}
            onMove={onMove}
            onRemove={onRemove}
            onToggleParentLock={onToggleParentLock}
            onSelectNode={onSelectNode}
            onSelectionChange={onSelectionChange}
            highlightId={highlightId}
            sectionNameById={sectionNameById}
            eitherOrLinks={eitherOrLinks}
            onCreateEitherOr={onCreateEitherOr}
            onRemoveEitherOr={onRemoveEitherOr}
            onOpenEitherOrPicker={onOpenEitherOrPicker}
            bulkReportsTo={bulkReportsTo}
            onBulkReportsToChange={onBulkReportsToChange}
            onBulkApply={onBulkApply}
            bulkReportsToOptions={bulkReportsToOptions}
            bulkMovableCount={bulkMovableCount}
            bulkLockedCount={bulkLockedCount}
            onBulkLock={onBulkLock}
            onBulkUnlock={onBulkUnlock}
            onRemoveSelected={onRemoveSelected}
            hierarchyLayerById={hierarchyLayerById}
          />
        </ReactFlowProvider>
      </div>
    );
  }

  // Chart-only members (no department) — full people tree for that subset.
  if (viewingOutsideSections) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <nav
              className="flex flex-wrap items-center gap-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400"
              aria-label="Outside departments path"
            >
              <button
                type="button"
                className="hover:text-orange-600 dark:hover:text-orange-300"
                onClick={() => {
                  setDrillStack([]);
                  onSelectionChange?.([]);
                  onSelectNode(null);
                }}
              >
                Department chart
              </button>
              <span className="text-zinc-400">/</span>
              <span className="text-zinc-800 dark:text-zinc-200">Outside departments</span>
            </nav>
            <h3 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Outside departments
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Members on the chart with no department — reports-to still applies. Assign a
              department anytime from Manage departments or by re-adding with a department.
            </p>
          </div>
          <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={goBack}>
            <ChevronLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
        </div>
        {scopedNodes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No chart-only members. Add someone with Department set to “None (chart only)”.
          </p>
        ) : (
          <ReactFlowProvider>
            <OrgChartCanvas
              nodes={scopedNodes}
              sections={sections}
              busy={busy}
              onReparent={onReparent}
              onReparentMany={onReparentMany}
              onMove={onMove}
              onRemove={onRemove}
              onToggleParentLock={onToggleParentLock}
              onSelectNode={onSelectNode}
              onSelectionChange={onSelectionChange}
              highlightId={highlightId}
              sectionNameById={sectionNameById}
              eitherOrLinks={scopedEitherOrLinks}
              onCreateEitherOr={onCreateEitherOr}
              onRemoveEitherOr={onRemoveEitherOr}
              onOpenEitherOrPicker={onOpenEitherOrPicker}
              bulkReportsTo={bulkReportsTo}
              onBulkReportsToChange={onBulkReportsToChange}
              onBulkApply={onBulkApply}
              bulkReportsToOptions={bulkReportsToOptions}
              bulkMovableCount={bulkMovableCount}
              bulkLockedCount={bulkLockedCount}
              onBulkLock={onBulkLock}
              onBulkUnlock={onBulkUnlock}
              onRemoveSelected={onRemoveSelected}
              hierarchyLayerById={hierarchyLayerById}
            />
          </ReactFlowProvider>
        )}
      </div>
    );
  }

  if (!currentSectionId || !currentSection) {
    const unassignedCount = outsideNodes.length;
    return (
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Department org chart — main departments in a horizontal row (blue), sub-departments
          stacked vertically under each (yellow + head). Drag to nest or set reports-to. Click a
          department to open its members.
        </p>
        {unassignedCount > 0 ? (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
            {unassignedCount} individual{unassignedCount === 1 ? "" : "s"} with no department —
            shown as person cards on the chart. Use Manage departments anytime to assign them.
          </p>
        ) : null}
        <ReactFlowProvider>
          <SectionTreeCanvas
            sections={sections}
            nodes={nodes}
            memberCountBySection={memberCountBySection}
            childrenByParent={childrenByParent}
            eitherOrLinks={eitherOrLinks}
            busy={busy}
            onOpenSection={handleOpenSection}
            onReparentSection={onReparentSection ?? (() => {})}
            onSetSectionReportsTo={onSetSectionReportsTo ?? (() => {})}
            onReparent={onReparent}
            onMove={onMove}
            onRemove={onRemove}
            onToggleParentLock={onToggleParentLock}
            onSelectNode={onSelectNode}
          />
        </ReactFlowProvider>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav
            className="flex flex-wrap items-center gap-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400"
            aria-label="Department path"
          >
            <button
              type="button"
              className="hover:text-orange-600 dark:hover:text-orange-300"
              onClick={() => {
                setDrillStack([]);
                onSelectionChange?.([]);
                onSelectNode(null);
              }}
            >
              Department chart
            </button>
            {drillStack.map((id, index) => {
              const s = sectionById.get(id);
              if (!s) return null;
              const isLast = index === drillStack.length - 1;
              return (
                <span key={id} className="inline-flex items-center gap-1">
                  <span className="text-zinc-400">/</span>
                  {isLast ? (
                    <span className="text-zinc-800 dark:text-zinc-200">{s.name}</span>
                  ) : (
                    <button
                      type="button"
                      className="hover:text-orange-600 dark:hover:text-orange-300"
                      onClick={() => jumpToBreadcrumb(index)}
                    >
                      {s.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
          <h3 className="mt-1 text-lg font-bold text-zinc-950 dark:text-zinc-50">
            {currentSection.name}
          </h3>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
              <Crown className="size-3.5" aria-hidden />
              {currentSection.headName?.trim() || "No head"}
            </span>
            {" · "}
            {scopedNodes.length} member{scopedNodes.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button type="button" variant="outline" className="h-9 rounded-xl" onClick={goBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to chart
        </Button>
      </div>

      {childSections.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            Child departments
          </span>
          {childSections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => openSection(section.id)}
              className="rounded-full border border-orange-300/70 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-800 transition hover:bg-orange-100 dark:border-orange-700/50 dark:bg-orange-950/30 dark:text-orange-200 dark:hover:bg-orange-950/50"
            >
              {section.name}
              <span className="ml-1 opacity-70">
                ({memberCountBySection.get(section.id) ?? 0})
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          Members in this department
          {childSections.length > 0 ? " (includes sub-departments)" : ""}
        </p>
        {scopedNodes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No members assigned to this department or its sub-departments yet. Use Manage
            departments to add people.
          </p>
        ) : (
          <ReactFlowProvider>
            <OrgChartCanvas
              nodes={scopedNodes}
              allNodesForOutline={nodes}
              sections={sections}
              scopeSectionIds={scopedSectionIds}
              scopeRootSectionId={currentSectionId}
              busy={busy}
              onReparent={onReparent}
              onReparentMany={onReparentMany}
              onMove={onMove}
              onRemove={onRemove}
              onToggleParentLock={onToggleParentLock}
              onSelectNode={onSelectNode}
              onSelectionChange={onSelectionChange}
              highlightId={highlightId}
              sectionNameById={sectionNameById}
              eitherOrLinks={scopedEitherOrLinks}
              onCreateEitherOr={onCreateEitherOr}
              onRemoveEitherOr={onRemoveEitherOr}
              onOpenEitherOrPicker={onOpenEitherOrPicker}
              bulkReportsTo={bulkReportsTo}
              onBulkReportsToChange={onBulkReportsToChange}
              onBulkApply={onBulkApply}
              bulkReportsToOptions={bulkReportsToOptions}
              bulkMovableCount={bulkMovableCount}
              bulkLockedCount={bulkLockedCount}
              onBulkLock={onBulkLock}
              onBulkUnlock={onBulkUnlock}
              onRemoveSelected={onRemoveSelected}
            />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}

function OrgChartCanvas({
  nodes,
  allNodesForOutline,
  sections = [],
  busy,
  onReparent,
  onReparentMany,
  onMove,
  onRemove,
  onToggleParentLock,
  onSelectNode,
  onSelectionChange,
  highlightId,
  sectionNameById,
  eitherOrLinks,
  onCreateEitherOr,
  onRemoveEitherOr,
  onOpenEitherOrPicker,
  bulkReportsTo = "",
  onBulkReportsToChange,
  onBulkApply,
  bulkReportsToOptions,
  bulkMovableCount = 0,
  bulkLockedCount = 0,
  onBulkLock,
  onBulkUnlock,
  onRemoveSelected,
  hierarchyLayerById,
  scopeSectionIds,
  scopeRootSectionId,
}: {
  nodes: OrgChartDiagramNode[];
  /** Full chart members for scoped outline prefix (dept head stays at company 1.n). */
  allNodesForOutline?: OrgChartDiagramNode[];
  sections?: OrgChartSectionRow[];
  /** Section ids in the current department view (includes nested sub-departments). */
  scopeSectionIds?: Set<string>;
  /** Root department when drilled into a section (drives sub-dept sort order). */
  scopeRootSectionId?: string | null;
  busy: boolean;
  onReparent: (id: string, parentId: string) => void;
  onReparentMany: (ids: string[], parentId: string) => void;
  onMove: (id: string, moveUp: boolean) => void;
  onRemove: (id: string, reports: number) => void;
  onToggleParentLock: (id: string, locked: boolean) => void;
  onSelectNode: (node: OrgChartNode | null) => void;
  onSelectionChange?: (ids: string[]) => void;
  highlightId?: string | null;
  sectionNameById?: Map<string, string>;
  eitherOrLinks: OrgChartEitherOrLinkRow[];
  onCreateEitherOr?: (nodeAId: string, nodeBId: string) => void;
  onRemoveEitherOr?: (linkId: string) => void;
  onOpenEitherOrPicker?: (prefillA?: string, prefillB?: string) => void;
  bulkReportsTo?: string;
  onBulkReportsToChange?: (value: string) => void;
  onBulkApply?: () => void;
  bulkReportsToOptions?: BulkReportsToOptions;
  bulkMovableCount?: number;
  bulkLockedCount?: number;
  onBulkLock?: () => void;
  onBulkUnlock?: () => void;
  onRemoveSelected?: (ids: string[]) => void;
  /** Full-chart level map (preferred over computing from scoped layout nodes). */
  hierarchyLayerById?: Map<string, number>;
}) {
  const { fitView } = useReactFlow();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionsLayoutKey = useMemo(
    () => orgChartSectionsLayoutKey(sections),
    [sections],
  );
  const layoutOptions = useMemo<OrgChartLayoutOptions | undefined>(
    () =>
      scopeSectionIds && scopeSectionIds.size > 0 && scopeRootSectionId
        ? {
            sectionIdsInScope: scopeSectionIds,
            scopeRootSectionId,
            allNodesForOutline: allNodesForOutline ?? nodes,
          }
        : undefined,
    [scopeSectionIds, scopeRootSectionId, allNodesForOutline, nodes],
  );
  const { positions, childrenOf, outlineById } = useMemo(() => {
    const layout = computeLayout(nodes, sections, layoutOptions);
    const outlineById = layoutOptions?.scopeRootSectionId
      ? orgChartOutlineById(nodes, sections, layoutOptions)
      : orgChartPersonOutlineFromLayout(layout.childrenOf);
    return {
      ...layout,
      outlineById,
    };
  }, [nodes, sections, sectionsLayoutKey, layoutOptions]);

  const diagramSize = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const p of positions.values()) {
      w = Math.max(w, p.x + NODE_W);
      h = Math.max(h, p.y + NODE_H);
    }
    return { w, h };
  }, [positions]);
  // Primitive key so lock/busy node refreshes do not refit the viewport.
  const diagramSizeKey = `${diagramSize.w}x${diagramSize.h}`;

  const descendants = useMemo(() => {
    const result = new Map<string, Set<string>>();
    const visit = (id: string): Set<string> => {
      const set = new Set<string>();
      for (const child of childrenOf.get(id) ?? []) {
        set.add(child.id);
        for (const d of visit(child.id)) set.add(d);
      }
      return set;
    };
    for (const n of nodes) result.set(n.id, visit(n.id));
    return result;
  }, [childrenOf, nodes]);

  const siblingInfo = useMemo(() => {
    const info = new Map<string, { index: number; count: number }>();
    for (const list of childrenOf.values()) {
      list.forEach((n, index) => info.set(n.id, { index, count: list.length }));
    }
    for (const n of nodes) {
      if (!info.has(n.id)) info.set(n.id, { index: 0, count: 1 });
    }
    return info;
  }, [childrenOf, nodes]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const overIdRef = useRef<string | null>(null);
  const dragIdsRef = useRef<Set<string> | null>(null);
  const draggingRef = useRef(false);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  function updateSelection(next: Set<string>) {
    selectedIdsRef.current = next;
    setSelectedIds(next);
    onSelectionChangeRef.current?.([...next]);
  }

  function handleNodeClick(event: React.MouseEvent, node: Node) {
    if (node.type !== "orgBox") return;
    const orgNode = node as OrgBoxNodeType;
    const multi = event.shiftKey || event.metaKey || event.ctrlKey;
    const next = new Set(selectedIdsRef.current);
    if (multi) {
      if (next.has(orgNode.id)) next.delete(orgNode.id);
      else next.add(orgNode.id);
    } else {
      next.clear();
      next.add(orgNode.id);
    }
    updateSelection(next);
    onSelectNode(next.has(orgNode.id) ? orgNode.data.node : null);
  }

  function isEligibleTarget(dragging: Set<string>, targetId: string) {
    if (dragging.has(targetId)) return false;
    for (const id of dragging) {
      if (descendants.get(id)?.has(targetId)) return false;
    }
    return true;
  }

  const layerById = useMemo(
    () => hierarchyLayerById ?? orgChartLayerById(nodes),
    [hierarchyLayerById, nodes],
  );
  const layoutNodes = useMemo<DiagramNode[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const sharedKidsByPeer = new Map<string, number>();
    for (const link of eitherOrLinks) {
      const count = nodes.filter((c) => c.parentEitherOrLinkId === link.id).length;
      if (count === 0) continue;
      // Layout parent (nodeA) already counted via childrenOf; credit nodeB only.
      sharedKidsByPeer.set(
        link.nodeBId,
        (sharedKidsByPeer.get(link.nodeBId) ?? 0) + count,
      );
    }
    const personNodes: OrgBoxNodeType[] = nodes.map((n) => {
      const sibling = siblingInfo.get(n.id) ?? { index: 0, count: 1 };
      const selected = selectedIds.has(n.id);
      const managerOptions = nodes.filter(
        (m) => m.id !== n.id && !(descendants.get(n.id)?.has(m.id) ?? false),
      );
      const eitherOrParentOptions = eitherOrLinks
        .filter((link) => {
          if (link.nodeAId === n.id || link.nodeBId === n.id) return false;
          if (descendants.get(n.id)?.has(link.nodeAId)) return false;
          if (descendants.get(n.id)?.has(link.nodeBId)) return false;
          return true;
        })
        .map((link) => ({
          value: encodeReportsToValue({ parentEitherOrLinkId: link.id }),
          label: eitherOrLinkLabel(link, byId),
        }));
      return {
        id: n.id,
        type: "orgBox",
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        width: NODE_W,
        height: NODE_H,
        selectable: true,
        draggable: !n.parentLocked,
        selected,
        zIndex: 1,
        data: {
          node: n,
          kidsCount:
            (childrenOf.get(n.id) ?? []).length + (sharedKidsByPeer.get(n.id) ?? 0),
          managersByLayer: groupManagersByLayer(managerOptions, layerById, outlineById),
          eitherOrParentOptions,
          reportsToValue: encodeReportsToValue({
            parentId: n.parentId,
            parentEitherOrLinkId: n.parentEitherOrLinkId,
          }),
          nodeLayer: layerById.get(n.id) ?? 1,
          outline: outlineById.get(n.id) ?? "1",
          outlineById,
          siblingIndex: sibling.index,
          siblingCount: sibling.count,
          busy,
          selected,
          selectionLockCount: selected ? selectedIds.size : 1,
          sectionLabel: sectionLabelForNode(n, sectionNameById),
          onReparent,
          onMove,
          onRemove,
          onToggleParentLock,
        },
      };
    });
    return personNodes;
  }, [
    nodes,
    positions,
    childrenOf,
    descendants,
    siblingInfo,
    layerById,
    outlineById,
    busy,
    selectedIds,
    sectionNameById,
    eitherOrLinks,
    onReparent,
    onMove,
    onRemove,
    onToggleParentLock,
  ]);

  const [liveNodes, setLiveNodes] = useState<DiagramNode[]>(layoutNodes);

  useEffect(() => {
    if (draggingRef.current) return;
    setLiveNodes((current) => {
      const prevById = new Map(current.map((n) => [n.id, n]));
      // Keep existing positions/selection when the tree structure is unchanged so
      // cosmetic updates (lock, busy) do not jump the viewport.
      return layoutNodes.map((n) => {
        const prev = prevById.get(n.id);
        if (
          prev &&
          prev.position.x === n.position.x &&
          prev.position.y === n.position.y
        ) {
          return {
            ...n,
            position: prev.position,
            selected: prev.selected,
          };
        }
        return n;
      });
    });
  }, [layoutNodes]);

  const rfEdges = useMemo<Edge[]>(() => {
    const linkById = new Map(eitherOrLinks.map((l) => [l.id, l]));
    const hierarchy = nodes
      .filter((n) => n.parentId && positions.has(n.parentId))
      .flatMap((n) => {
        const shared = n.parentEitherOrLinkId
          ? linkById.get(n.parentEitherOrLinkId)
          : undefined;

        // Shared either/or parent: clean V from both peers into the child top.
        if (shared) {
          const peers = [shared.nodeAId, shared.nodeBId]
            .filter((id) => positions.has(id))
            .sort((a, b) => (positions.get(a)!.x - positions.get(b)!.x));
          if (peers.length >= 2) {
            return peers.map((sourceId, i) =>
              orgStepEdge(
                {
                  id: `edge-shared-${n.id}-${sourceId}`,
                  source: sourceId,
                  target: n.id,
                  sourceHandle: "out",
                  targetHandle: i === 0 ? "in-left" : "in-right",
                  style: ORG_EDGE_SHARED,
                  zIndex: 0,
                },
                { borderRadius: 10, offset: i === 0 ? 28 : 28 },
              ),
            );
          }
          const sourceId = peers[0] ?? n.parentId!;
          return [
            orgStepEdge({
              id: `edge-shared-${n.id}-${sourceId}`,
              source: sourceId,
              target: n.id,
              sourceHandle: "out",
              targetHandle: "in",
              style: ORG_EDGE_SHARED,
              zIndex: 0,
            }),
          ];
        }

        return [
          orgStepEdge({
            id: `edge-${n.id}`,
            source: n.parentId!,
            target: n.id,
            sourceHandle: "out",
            targetHandle: "in",
            style: ORG_EDGE_NORMAL,
            zIndex: 0,
          }),
        ];
      });

    const peers: Edge[] = [];
    for (const link of eitherOrLinks) {
      if (!positions.has(link.nodeAId) || !positions.has(link.nodeBId)) continue;
      const a = positions.get(link.nodeAId)!;
      const b = positions.get(link.nodeBId)!;
      const aIsLeft = a.x <= b.x;
      const sameRow = Math.abs(a.y - b.y) < 12;
      peers.push({
        id: `either-or-${link.id}`,
        source: link.nodeAId,
        target: link.nodeBId,
        sourceHandle: aIsLeft ? "peer-right" : "peer-left",
        targetHandle: aIsLeft ? "peer-in-left" : "peer-in-right",
        type: sameRow ? "straight" : "smoothstep",
        pathOptions: sameRow ? undefined : { borderRadius: 8, offset: 16 },
        style: {
          ...ORG_EDGE_SHARED,
          strokeWidth: 1.5,
        },
        zIndex: 1,
        data: { linkId: link.id, kind: "either-or" },
      } as Edge);
    }
    return [...hierarchy, ...peers];
  }, [nodes, positions, eitherOrLinks]);

  const layoutKey = useMemo(
    () =>
      `${sectionsLayoutKey}::${nodes
        .map(
          (n) =>
            // Omit parentLocked — toggling lock must not refit/reset the viewport.
            `${n.id}:${n.parentId}:${n.parentEitherOrLinkId ?? ""}:${n.sortOrder}`,
        )
        .join("|")}`,
    [nodes, sectionsLayoutKey],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function applyViewport() {
      const target = containerRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      fitView({ padding: 0.12, maxZoom: 1.05, duration: 0 });
    }

    // Refit when the people-tree structure / diagram size changes.
    applyViewport();

    // Do not refit on tiny resizes (e.g. success banner appearing after Lock).
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      const target = containerRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      const becameVisible = (lastW < 8 || lastH < 8) && w >= 8 && h >= 8;
      const bigChange = Math.abs(w - lastW) > 80 || Math.abs(h - lastH) > 120;
      lastW = w;
      lastH = h;
      if (becameVisible || bigChange) applyViewport();
    });
    ro.observe(el);

    let wasVisible = false;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting && e.intersectionRatio > 0);
        if (visible && !wasVisible) {
          requestAnimationFrame(applyViewport);
        }
        wasVisible = visible;
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [fitView, layoutKey, diagramSizeKey]);

  useEffect(() => {
    const alive = new Set(nodes.map((n) => n.id));
    const next = new Set([...selectedIdsRef.current].filter((id) => alive.has(id)));
    if (next.size !== selectedIdsRef.current.size) {
      updateSelection(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when node ids change
  }, [layoutKey]);

  const nodeElsRef = useRef<Map<string, DOMRect>>(new Map());

  function measureNodeRects() {
    const el = containerRef.current;
    if (!el) return;
    const next = new Map<string, DOMRect>();
    for (const wrapper of el.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const id = wrapper.getAttribute("data-id");
      if (id) next.set(id, wrapper.getBoundingClientRect());
    }
    nodeElsRef.current = next;
  }

  function nodeAtScreenPoint(clientX: number, clientY: number): string | null {
    let hit: string | null = null;
    const rects = nodeElsRef.current;
    for (const [id, r] of rects) {
      if (dragIdsRef.current?.has(id)) continue;
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        hit = id;
      }
    }
    return hit;
  }

  function setDropTargetClass(nextId: string | null) {
    const el = containerRef.current;
    if (!el) return;
    const prev = overIdRef.current;
    if (prev === nextId) return;
    if (prev) {
      el.querySelector(`[data-box-id="${prev}"]`)?.classList.remove("org-chart-drop-target");
    }
    if (nextId) {
      el.querySelector(`[data-box-id="${nextId}"]`)?.classList.add("org-chart-drop-target");
    }
    overIdRef.current = nextId;
  }

  useEffect(() => {
    measureNodeRects();
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!draggingRef.current) measureNodeRects();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [layoutKey, diagramSizeKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    for (const box of el.querySelectorAll<HTMLElement>("[data-box-id]")) {
      box.classList.toggle("org-chart-picked", box.getAttribute("data-box-id") === highlightId);
    }
  });

  const onNodesChange = useCallback((changes: NodeChange<DiagramNode>[]) => {
    if (!draggingRef.current) return;
    const positionChanges = changes.filter((change) => change.type === "position");
    if (positionChanges.length === 0) return;
    setLiveNodes((current) => applyNodeChanges(positionChanges, current));
  }, []);

  const selectedPair = useMemo(() => {
    if (selectedIds.size !== 2) return null;
    const [a, b] = [...selectedIds];
    return a && b ? ([a, b] as const) : null;
  }, [selectedIds]);

  const existingPairLink = useMemo(() => {
    if (!selectedPair) return null;
    const [a, b] = selectedPair;
    return (
      eitherOrLinks.find(
        (l) =>
          (l.nodeAId === a && l.nodeBId === b) || (l.nodeAId === b && l.nodeBId === a),
      ) ?? null
    );
  }, [eitherOrLinks, selectedPair]);

  return (
    <div className="relative h-[640px] w-full min-h-[640px] org-chart-flow">
      {selectedIds.size >= 1 && onRemoveSelected ? (
        <div
          className={`absolute left-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-rose-300/90 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm dark:border-rose-800 dark:bg-zinc-900/95 ${
            selectedIds.size >= 2 && bulkReportsToOptions && onBulkApply && onBulkReportsToChange
              ? "top-[4.75rem]"
              : "top-3"
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-rose-300 px-3 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemoveSelected([...selectedIds]);
            }}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {selectedIds.size > 1 ? `Remove ${selectedIds.size}` : "Remove member"}
          </Button>
        </div>
      ) : null}
      {selectedIds.size >= 2 && bulkReportsToOptions && onBulkApply && onBulkReportsToChange ? (
        <div
          className="absolute inset-x-3 top-3 z-20 rounded-xl border border-orange-300/90 bg-white/95 px-3 py-2.5 shadow-md backdrop-blur-sm dark:border-orange-800 dark:bg-zinc-900/95"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <OrgChartBulkReportsBar
            selectedCount={selectedIds.size}
            movableCount={bulkMovableCount}
            value={bulkReportsTo}
            onChange={onBulkReportsToChange}
            onApply={onBulkApply}
            busy={busy}
            options={{ ...bulkReportsToOptions, outlineById }}
            lockedSelectedCount={bulkLockedCount}
            onLockSelected={onBulkLock}
            onUnlockSelected={onBulkUnlock}
          />
        </div>
      ) : null}
      {selectedPair && (onOpenEitherOrPicker || onCreateEitherOr || onRemoveEitherOr) ? (
        <div
          className={`absolute right-3 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-300/90 bg-white/95 px-3 py-2 shadow-md backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95 ${
            selectedIds.size >= 2 && bulkReportsToOptions && onBulkApply && onBulkReportsToChange
              ? "top-[4.75rem]"
              : "top-3"
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {existingPairLink ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg px-3 text-xs"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemoveEitherOr?.(existingPairLink.id);
              }}
            >
              <Link2Off className="mr-1.5 h-3.5 w-3.5" />
              Unlink either / or
            </Button>
          ) : (
            <Button
              type="button"
              className="h-9 rounded-lg bg-orange-600 px-3 text-xs text-white hover:bg-orange-500"
              disabled={busy || (!onOpenEitherOrPicker && !onCreateEitherOr)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onOpenEitherOrPicker) {
                  onOpenEitherOrPicker(selectedPair[0], selectedPair[1]);
                  return;
                }
                onCreateEitherOr?.(selectedPair[0], selectedPair[1]);
              }}
            >
              <GitCompareArrows className="mr-1.5 h-3.5 w-3.5" />
              Link either / or
            </Button>
          )}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-950/40"
      >
      <ReactFlow
        nodes={liveNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          requestAnimationFrame(() => {
            const el = containerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            instance.fitView({ padding: 0.12, maxZoom: 1.05, duration: 0 });
          });
        }}
        defaultEdgeOptions={DEFAULT_ORG_EDGE_OPTIONS}
        minZoom={0.05}
        maxZoom={2.5}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        nodeDragThreshold={5}
        onlyRenderVisibleElements
        elevateNodesOnSelect={false}
        autoPanOnNodeDrag={false}
        multiSelectionKeyCode={["Shift"]}
        onPaneClick={() => {
          updateSelection(new Set());
          onSelectNode(null);
        }}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => handleNodeClick(event, node)}
        onNodeDragStart={(_, node) => {
          if (node.type !== "orgBox") return;
          if (!("node" in node.data) || node.data.node.parentLocked) return;
          const dragSet = new Set(selectedIdsRef.current);
          if (!dragSet.has(node.id)) {
            dragSet.clear();
            dragSet.add(node.id);
          }
          for (const id of [...dragSet]) {
            const n = nodes.find((x) => x.id === id);
            if (n?.parentLocked) dragSet.delete(id);
          }
          if (dragSet.size === 0) return;
          // Keep panel Remove in sync even when a tiny drag swallows onNodeClick.
          updateSelection(dragSet);
          draggingRef.current = true;
          dragIdsRef.current = dragSet;
          setDropTargetClass(null);
          measureNodeRects();
          onSelectNode(node.data.node);
        }}
        onNodeDrag={(event) => {
          if (!dragIdsRef.current) return;
          const cx = "clientX" in event ? event.clientX : 0;
          const cy = "clientY" in event ? event.clientY : 0;
          const hit = nodeAtScreenPoint(cx, cy);
          const next = hit && isEligibleTarget(dragIdsRef.current, hit) ? hit : null;
          setDropTargetClass(next);
        }}
        onNodeDragStop={(_, node) => {
          const draggedSet = dragIdsRef.current ?? new Set([node.id]);
          const target = overIdRef.current;
          draggingRef.current = false;
          dragIdsRef.current = null;
          setDropTargetClass(null);
          setLiveNodes(layoutNodes);
          if (target && isEligibleTarget(draggedSet, target)) {
            const ids = [...draggedSet];
            if (ids.length > 1) {
              onReparentMany(ids, target);
            } else {
              onReparent(ids[0], target);
            }
          }
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.5}
          color="var(--org-line)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      </div>
    </div>
  );
}
