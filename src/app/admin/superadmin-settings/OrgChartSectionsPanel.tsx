"use client";

import type { OrgChartNode } from "@prisma/client/primary";
import { useCallback, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Crown,
  FolderKanban,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Ungroup,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PointerDragGhostLayer, usePointerColumnDrag } from "@/lib/pointer-column-drag";
import {
  compareOutlineLabels,
  orgChartOutlineById,
  orgChartSectionOutlineById,
} from "./org-chart-layers";

export type OrgChartSectionRoleRow = {
  id: string;
  label: string;
  sortOrder: number;
};

export type OrgChartSectionRow = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  companyTeamId: string | null;
  companyName: string | null;
  headNodeId: string | null;
  headName: string | null;
  headRole: string | null;
  headCompanyName: string | null;
  reportsToNodeId?: string | null;
  reportsToName?: string | null;
  reportsToRole?: string | null;
  reportsToCompanyName?: string | null;
  roles: OrgChartSectionRoleRow[];
  memberCount: number;
};

type OrgChartNodeRow = OrgChartNode & {
  sectionMemberships: Array<{
    sectionId: string;
    roleId?: string | null;
    role?: { id: string; label: string } | null;
  }>;
};

type CompanyOption = { id: string; name: string };

/** Drop target id for promoting a section to top-level. */
const MAIN_SECTION_DROP = "__main__";

/** Drop target prefix: move a direct child out one level (to the parent's parent). */
const MOVE_UP_DROP_PREFIX = "__up__:";

/** Drop before a sibling department (reorder). */
const BEFORE_DROP_PREFIX = "__before__:";

/** Drop at end of a sibling list (reorder). */
const END_DROP_PREFIX = "__end__:";

function moveUpDropId(parentSectionId: string) {
  return `${MOVE_UP_DROP_PREFIX}${parentSectionId}`;
}

function parseMoveUpDropId(column: string): string | null {
  if (!column.startsWith(MOVE_UP_DROP_PREFIX)) return null;
  return column.slice(MOVE_UP_DROP_PREFIX.length) || null;
}

function beforeDropId(sectionId: string) {
  return `${BEFORE_DROP_PREFIX}${sectionId}`;
}

function parseBeforeDropId(column: string): string | null {
  if (!column.startsWith(BEFORE_DROP_PREFIX)) return null;
  return column.slice(BEFORE_DROP_PREFIX.length) || null;
}

function endDropId(parentId: string | null) {
  return `${END_DROP_PREFIX}${parentId ?? "root"}`;
}

function parseEndDropId(column: string): { parentId: string | null } | null {
  if (!column.startsWith(END_DROP_PREFIX)) return null;
  const key = column.slice(END_DROP_PREFIX.length);
  if (!key) return null;
  return { parentId: key === "root" ? null : key };
}

export function OrgChartSectionsPanel({
  sections,
  nodes,
  companyOptions,
  busy,
  chartSelectedIds,
  onSectionsChange,
  onNodesChange,
  onSelectMember,
  onSelectMembers,
  onRemoveSelected,
  onMessage,
  onError,
  setBusy,
  readOnly = false,
  canSetPortalRoles = false,
  portalRoleByMergedId = {},
  onPortalRoleChange,
}: {
  sections: OrgChartSectionRow[];
  nodes: OrgChartNodeRow[];
  companyOptions: CompanyOption[];
  busy: boolean;
  chartSelectedIds: string[];
  onSectionsChange: (next: OrgChartSectionRow[]) => void;
  onNodesChange: (next: OrgChartNodeRow[]) => void;
  onSelectMember: (node: OrgChartNodeRow) => void;
  /** Replace chart selection (Shift/Ctrl multi-select in lists). */
  onSelectMembers?: (ids: string[], focusNode?: OrgChartNodeRow | null) => void;
  /** Remove selected members from the org chart entirely. */
  onRemoveSelected?: (ids: string[]) => void;
  onMessage: (msg: string | null) => void;
  onError: (msg: string | null) => void;
  setBusy: (busy: boolean) => void;
  readOnly?: boolean;
  canSetPortalRoles?: boolean;
  portalRoleByMergedId?: Record<string, string>;
  onPortalRoleChange?: (mergedSourceUserId: string, role: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [parentIdForCreate, setParentIdForCreate] = useState<string | null>(null);
  /** Reports-to target when editing/creating: "" | dept:<id> | person:<id> */
  const [reportsToTarget, setReportsToTarget] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [companyTeamId, setCompanyTeamId] = useState("");
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [dropSectionId, setDropSectionId] = useState<string | null>(null);
  const [dropSectionBeforeId, setDropSectionBeforeId] = useState<string | null>(null);
  /** Anchor for Shift+click range select in Unassigned. */
  const unassignedSelectAnchorRef = useRef<string | null>(null);
  const [newRoleBySection, setNewRoleBySection] = useState<Record<string, string>>({});
  const draggingSectionRef = useRef<string | null>(null);
  const sectionParentIdRef = useRef<Map<string, string | null>>(new Map());
  const isSectionDescendantOfRef = useRef<(ancestorId: string, candidateId: string) => boolean>(
    () => false,
  );
  const moveSectionRef = useRef<(sectionId: string, newParentId: string | null) => void>(() => {});
  const reorderSiblingDepartmentsRef = useRef<
    (parentId: string | null, draggedId: string, beforeId: string | null) => void
  >(() => {});

  const sectionById = useMemo(() => {
    const map = new Map(sections.map((s) => [s.id, s]));
    return map;
  }, [sections]);

  const nodesBySection = useMemo(() => {
    const map = new Map<string | null, OrgChartNodeRow[]>();
    for (const n of nodes) {
      const memberships = (n.sectionMemberships ?? []).filter((m) =>
        sectionById.has(m.sectionId),
      );
      if (memberships.length === 0) {
        const list = map.get(null) ?? [];
        list.push(n);
        map.set(null, list);
        continue;
      }
      for (const membership of memberships) {
        const list = map.get(membership.sectionId) ?? [];
        list.push(n);
        map.set(membership.sectionId, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.personName.localeCompare(b.personName));
    }
    return map;
  }, [nodes, sectionById]);

  const { roots, childrenByParent } = useMemo(() => {
    const byParent = new Map<string, OrgChartSectionRow[]>();
    const top: OrgChartSectionRow[] = [];
    for (const s of sections) {
      if (s.parentId) {
        const list = byParent.get(s.parentId) ?? [];
        list.push(s);
        byParent.set(s.parentId, list);
      } else {
        top.push(s);
      }
    }
    for (const list of byParent.values()) {
      list.sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
    }
    top.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return { roots: top, childrenByParent: byParent };
  }, [sections]);

  sectionParentIdRef.current = new Map(sections.map((s) => [s.id, s.parentId]));

  const basePersonOutlineById = useMemo(
    () => orgChartOutlineById(nodes, sections),
    [nodes, sections],
  );
  const sectionOutlineById = useMemo(
    () => orgChartSectionOutlineById(sections, nodes, basePersonOutlineById),
    [sections, nodes, basePersonOutlineById],
  );

  const sectionsForReportsToPicker = useMemo(
    () =>
      [...sections]
        .filter((s) => s.id !== editId)
        .sort((a, b) =>
          compareOutlineLabels(
            sectionOutlineById.get(a.id) ?? "",
            sectionOutlineById.get(b.id) ?? "",
          ),
        ),
    [sections, editId, sectionOutlineById],
  );

  const peopleForReportsToPicker = useMemo(
    () =>
      [...nodes].sort((a, b) =>
        a.personName.localeCompare(b.personName, undefined, { sensitivity: "base" }),
      ),
    [nodes],
  );

  const unassigned = nodesBySection.get(null) ?? [];
  const unassignedSelectedIds = useMemo(
    () => chartSelectedIds.filter((id) => unassigned.some((n) => n.id === id)),
    [chartSelectedIds, unassigned],
  );

  function selectUnassignedMember(e: MouseEvent, node: OrgChartNodeRow) {
    if (busy || !onSelectMembers) {
      onSelectMember(node);
      return;
    }

    const orderedIds = unassigned.map((n) => n.id);
    const multiToggle = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;

    if (range && unassignedSelectAnchorRef.current) {
      const anchorIdx = orderedIds.indexOf(unassignedSelectAnchorRef.current);
      const targetIdx = orderedIds.indexOf(node.id);
      if (anchorIdx >= 0 && targetIdx >= 0) {
        const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        const rangeIds = orderedIds.slice(lo, hi + 1);
        onSelectMembers(rangeIds, node);
        return;
      }
    }

    if (multiToggle) {
      const set = new Set(chartSelectedIds);
      if (set.has(node.id)) set.delete(node.id);
      else set.add(node.id);
      const next = [...set];
      unassignedSelectAnchorRef.current = node.id;
      onSelectMembers(next, node);
      return;
    }

    // Plain click — single select; Shift without an anchor also starts here.
    unassignedSelectAnchorRef.current = node.id;
    onSelectMembers([node.id], node);
  }

  const isSectionDescendantOf = useCallback(
    (ancestorId: string, candidateId: string): boolean => {
      const stack = [...(childrenByParent.get(ancestorId) ?? []).map((c) => c.id)];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current === candidateId) return true;
        for (const child of childrenByParent.get(current) ?? []) {
          stack.push(child.id);
        }
      }
      return false;
    },
    [childrenByParent],
  );
  isSectionDescendantOfRef.current = isSectionDescendantOf;

  const sectionDrag = usePointerColumnDrag<string>({
    disabled: busy,
    activationDistance: 6,
    onDrop: (itemId, column) => {
      if (column === MAIN_SECTION_DROP) {
        moveSectionRef.current(itemId, null);
        return;
      }
      const moveUpParentId = parseMoveUpDropId(column);
      if (moveUpParentId) {
        const grandparentId = sectionParentIdRef.current.get(moveUpParentId) ?? null;
        moveSectionRef.current(itemId, grandparentId);
        return;
      }
      const beforeId = parseBeforeDropId(column);
      if (beforeId) {
        const parentId = sectionParentIdRef.current.get(beforeId) ?? null;
        reorderSiblingDepartmentsRef.current(parentId, itemId, beforeId);
        return;
      }
      const endTarget = parseEndDropId(column);
      if (endTarget) {
        reorderSiblingDepartmentsRef.current(endTarget.parentId, itemId, null);
        return;
      }
      // Same parent → rearrange before that sibling. Different parent → nest under it.
      const dragParent = sectionParentIdRef.current.get(itemId) ?? null;
      const targetParent = sectionParentIdRef.current.get(column) ?? null;
      if (dragParent === targetParent) {
        reorderSiblingDepartmentsRef.current(dragParent, itemId, column);
        return;
      }
      moveSectionRef.current(itemId, column);
    },
    onDragEnd: () => {
      draggingSectionRef.current = null;
    },
    isColumnDropDisabled: (column) => {
      const dragging = draggingSectionRef.current;
      if (!dragging) return false;
      const currentParentId = sectionParentIdRef.current.get(dragging) ?? null;
      if (column === MAIN_SECTION_DROP) return currentParentId == null;
      const moveUpParentId = parseMoveUpDropId(column);
      if (moveUpParentId) {
        return currentParentId !== moveUpParentId;
      }
      const beforeId = parseBeforeDropId(column);
      if (beforeId) {
        if (beforeId === dragging) return true;
        const targetParent = sectionParentIdRef.current.get(beforeId) ?? null;
        return targetParent !== currentParentId;
      }
      const endTarget = parseEndDropId(column);
      if (endTarget) {
        return endTarget.parentId !== currentParentId;
      }
      if (column === dragging) return true;
      // Dropping on the current parent is a no-op for nesting — use Move out / Move up instead.
      if (column === currentParentId) return true;
      return isSectionDescendantOfRef.current(dragging, column);
    },
  });

  function getSectionGripProps(section: OrgChartSectionRow) {
    const props = sectionDrag.getCardPointerProps(section.id, {
      getLabel: () => `Move “${section.name}”`,
    });
    return {
      ...props,
      onPointerDown: (e: PointerEvent) => {
        if (busy) return;
        draggingSectionRef.current = section.id;
        props.onPointerDown(e);
      },
    };
  }

  function resetForm() {
    setCreating(false);
    setEditId(null);
    setParentIdForCreate(null);
    setReportsToTarget("");
    setName("");
    setDescription("");
    setCompanyTeamId("");
  }

  function startCreateMain() {
    setEditId(null);
    setParentIdForCreate(null);
    setReportsToTarget("");
    setCreating(true);
    setName("");
    setDescription("");
    setCompanyTeamId("");
  }

  function startCreateSubsection(parent: OrgChartSectionRow) {
    setEditId(null);
    setParentIdForCreate(parent.id);
    setReportsToTarget(`dept:${parent.id}`);
    setCreating(true);
    setName("");
    setDescription("");
    setCompanyTeamId(parent.companyTeamId ?? "");
    setCollapsed((prev) => ({ ...prev, [parent.id]: false }));
  }

  function startEdit(section: OrgChartSectionRow) {
    setCreating(false);
    setParentIdForCreate(section.parentId);
    setReportsToTarget(
      section.reportsToNodeId
        ? `person:${section.reportsToNodeId}`
        : section.parentId
          ? `dept:${section.parentId}`
          : "",
    );
    setEditId(section.id);
    setName(section.name);
    setDescription(section.description ?? "");
    setCompanyTeamId(section.companyTeamId ?? "");
  }

  const reloadSections = useCallback(async () => {
    const res = await fetch("/api/admin/org-chart-sections", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not reload departments.");
    const body = (await res.json()) as OrgChartSectionRow[];
    onSectionsChange(body);
  }, [onSectionsChange]);

  const reloadNodes = useCallback(async () => {
    const res = await fetch("/api/admin/org-chart", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not reload chart members.");
    const body = (await res.json()) as OrgChartNodeRow[];
    onNodesChange(body);
  }, [onNodesChange]);

  async function setMemberPortalRole(node: OrgChartNodeRow, role: string) {
    const mergedId = (node.mergedSourceUserId ?? "").trim();
    if (!mergedId) {
      onError("This person is not linked to an HRIS user.");
      return;
    }
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart/portal-role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: node.id, mergedSourceUserId: mergedId, role }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        role?: string;
        clearedHead?: boolean;
      };
      if (!res.ok) throw new Error(body.error || "Could not update portal role.");
      const nextRole = body.role ?? role;
      onPortalRoleChange?.(mergedId, nextRole);
      onSectionsChange(
        sections.map((s) => {
          if (body.clearedHead && s.headNodeId === node.id) {
            return {
              ...s,
              headNodeId: null,
              headName: null,
              headRole: null,
              headCompanyName: null,
            };
          }
          if (s.headNodeId === node.id) {
            return { ...s, headRole: nextRole };
          }
          return s;
        }),
      );
      onMessage(
        `Set ${node.personName} to ${nextRole} (reflected on ListView).${
          body.clearedHead ? " Cleared department head." : ""
        }`,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update portal role.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSection() {
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Enter a department name.");
      return;
    }
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const payload: Record<string, unknown> = {
        name: trimmed,
        description: description.trim() || null,
        companyTeamId: companyTeamId || null,
      };
      if (editId) {
        payload.id = editId;
      }
      if (reportsToTarget.startsWith("person:")) {
        // People-chart edge only — keep department nesting (parentId) intact.
        payload.reportsToNodeId = reportsToTarget.slice("person:".length);
        if (!editId && parentIdForCreate) {
          payload.parentId = parentIdForCreate;
        }
      } else if (reportsToTarget.startsWith("dept:")) {
        payload.parentId = reportsToTarget.slice("dept:".length);
        payload.reportsToNodeId = null;
      } else if (editId || parentIdForCreate) {
        // Explicit clear / use create-parent fallback
        if (parentIdForCreate && !editId && !reportsToTarget) {
          payload.parentId = parentIdForCreate;
        } else {
          payload.parentId = null;
          payload.reportsToNodeId = null;
        }
      }
      const res = await fetch("/api/admin/org-chart-sections", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Could not save department.",
        );
      }
      await reloadSections();
      onMessage(editId ? `Updated department “${trimmed}”.` : `Created department “${trimmed}”.`);
      resetForm();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save department.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSection(section: OrgChartSectionRow) {
    function collectDescendantIds(sectionId: string): string[] {
      const ids: string[] = [];
      const stack = [...(childrenByParent.get(sectionId) ?? [])];
      while (stack.length > 0) {
        const child = stack.pop()!;
        ids.push(child.id);
        stack.push(...(childrenByParent.get(child.id) ?? []));
      }
      return ids;
    }

    function countMembersInSubtree(sectionId: string): number {
      let total = nodesBySection.get(sectionId)?.length ?? 0;
      for (const child of childrenByParent.get(sectionId) ?? []) {
        total += countMembersInSubtree(child.id);
      }
      return total;
    }

    const descendantIds = collectDescendantIds(section.id);
    const members = countMembersInSubtree(section.id);
    const bits: string[] = [];
    if (descendantIds.length > 0) {
      bits.push(
        `${descendantIds.length} nested department${descendantIds.length === 1 ? "" : "s"} will also be deleted`,
      );
    }
    if (members > 0) {
      bits.push(
        `${members} department membership${members === 1 ? "" : "s"} will be removed (hierarchy stays)`,
      );
    }
    const ok = window.confirm(
      bits.length > 0
        ? `Delete “${section.name}”? ${bits.join(". ")}.`
        : `Delete “${section.name}”?`,
    );
    if (!ok) return;

    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch(
        `/api/admin/org-chart-sections?id=${encodeURIComponent(section.id)}`,
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Could not delete section.",
        );
      }
      await reloadNodes();
      await reloadSections();
      onMessage(`Deleted “${section.name}”.`);
      if (editId === section.id || parentIdForCreate === section.id) resetForm();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not delete section.");
    } finally {
      setBusy(false);
    }
  }

  async function setSectionHead(sectionId: string, headNodeId: string | null) {
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId, headNodeId }),
      });
      const body = (await res.json().catch(() => ({}))) as OrgChartSectionRow & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not update section head.");
      }
      await reloadSections();
      const section = sectionById.get(sectionId);
      if (headNodeId) {
        await reloadNodes();
        const personName =
          body.headName ??
          nodesBySection.get(sectionId)?.find((n) => n.id === headNodeId)?.personName ??
          "Member";
        const roleNote = section?.parentId
          ? "Portal role set to Admin (sub-department head)."
          : "Portal role set to Admin (department head).";
        onMessage(`Set ${personName} as head of “${section?.name ?? body.name}”. ${roleNote}`);
      } else {
        onMessage(
          `Cleared head for “${section?.name ?? body.name}”. Portal Admin/Personnel roles were re-synced from the org chart.`,
        );
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update section head.");
    } finally {
      setBusy(false);
    }
  }

  async function moveSection(sectionId: string, newParentId: string | null) {
    const section = sectionById.get(sectionId);
    if (!section) return;
    if (section.parentId === newParentId) return;
    if (newParentId === sectionId) {
      onError("A section cannot be nested under itself.");
      return;
    }
    if (newParentId && isSectionDescendantOf(sectionId, newParentId)) {
      onError("A section cannot be nested under one of its own subsections.");
      return;
    }

    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId, parentId: newParentId }),
      });
      const body = (await res.json().catch(() => ({}))) as OrgChartSectionRow & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not move section.");
      }
      await reloadSections();
      if (newParentId) {
        const parent = sectionById.get(newParentId);
        onMessage(
          `Moved “${section.name}” under “${parent?.name ?? body.name ?? "section"}”.`,
        );
        setCollapsed((prev) => ({ ...prev, [newParentId]: false }));
      } else {
        onMessage(`Made “${section.name}” a main section.`);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not move section.");
    } finally {
      setBusy(false);
      draggingSectionRef.current = null;
    }
  }

  /** Leave the current parent: nest under grandparent, or become main if parent is a root. */
  function moveSectionUpOneLevel(sectionId: string) {
    const section = sectionById.get(sectionId);
    if (!section?.parentId) return;
    const grandparentId = sectionById.get(section.parentId)?.parentId ?? null;
    void moveSection(sectionId, grandparentId);
  }
  moveSectionRef.current = (sectionId, newParentId) => {
    void moveSection(sectionId, newParentId);
  };
  reorderSiblingDepartmentsRef.current = (parentId, draggedId, beforeId) => {
    void reorderSiblingDepartments(parentId, draggedId, beforeId);
  };

  async function createSectionRole(sectionId: string) {
    const label = (newRoleBySection[sectionId] ?? "").trim();
    if (!label) {
      onError("Enter a role label first (e.g. Deputy, Coordinator).");
      return;
    }
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId, createRole: { label } }),
      });
      const body = (await res.json().catch(() => ({}))) as OrgChartSectionRow & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Could not create role.");
      setNewRoleBySection((prev) => ({ ...prev, [sectionId]: "" }));
      await reloadSections();
      onMessage(`Added role “${label}” to “${body.name}”.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not create role.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSectionRole(sectionId: string, roleId: string, label: string) {
    if (!window.confirm(`Remove role “${label}” from this section?`)) return;
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId, deleteRoleId: roleId }),
      });
      const body = (await res.json().catch(() => ({}))) as OrgChartSectionRow & {
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Could not delete role.");
      await reloadSections();
      await reloadNodes();
      onMessage(`Removed role “${label}”.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not delete role.");
    } finally {
      setBusy(false);
    }
  }

  async function setMemberSectionRole(
    sectionId: string,
    nodeId: string,
    roleId: string | null,
  ) {
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sectionId,
          memberRoleNodeId: nodeId,
          roleId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not update member role.");
      await reloadNodes();
      onMessage("Updated section role.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update member role.");
    } finally {
      setBusy(false);
    }
  }

  async function assignNodes(sectionId: string | null, nodeIds: string[]) {
    const ids = [...new Set(nodeIds.filter(Boolean))];
    if (ids.length === 0) return;

    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      if (sectionId) {
        const res = await fetch("/api/admin/org-chart-sections", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sectionId, nodeIds: ids }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof body?.error === "string" ? body.error : "Could not assign members.",
          );
        }
      } else {
        const res = await fetch("/api/admin/org-chart-sections", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear: true, nodeIds: ids }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof body?.error === "string" ? body.error : "Could not unassign members.",
          );
        }
      }

      await reloadNodes();
      await reloadSections();
      const label =
        sectionId == null
          ? "Unassigned"
          : sections.find((s) => s.id === sectionId)?.name ?? "section";
      onMessage(
        ids.length === 1
          ? sectionId == null
            ? "Cleared all section memberships for member."
            : `Added member to ${label}.`
          : sectionId == null
            ? `Cleared all section memberships for ${ids.length} members.`
            : `Added ${ids.length} members to ${label}.`,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not update section members.");
    } finally {
      setBusy(false);
      setDragNodeId(null);
      setDropSectionId(null);
    }
  }

  async function reorderSiblingDepartments(
    parentId: string | null,
    draggedId: string,
    beforeId: string | null,
  ) {
    const siblings =
      parentId == null
        ? roots
        : (childrenByParent.get(parentId) ?? []);
    const ids = siblings.map((s) => s.id);
    if (!ids.includes(draggedId)) return;
    if (beforeId && !ids.includes(beforeId)) return;
    if (beforeId === draggedId) return;

    const without = ids.filter((id) => id !== draggedId);
    const insertAt = beforeId ? without.indexOf(beforeId) : without.length;
    if (insertAt < 0) return;
    const orderedIds = [
      ...without.slice(0, insertAt),
      draggedId,
      ...without.slice(insertAt),
    ];
    if (orderedIds.every((id, i) => id === ids[i])) return;

    // Optimistic local reorder
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
    onSectionsChange(
      sections.map((s) =>
        orderMap.has(s.id) ? { ...s, sortOrder: orderMap.get(s.id)! } : s,
      ),
    );

    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reorder: { parentId, orderedIds } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Could not reorder departments.",
        );
      }
      await reloadSections();
      onMessage("Updated department order.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not reorder departments.");
      await reloadSections();
    } finally {
      setBusy(false);
      setDragSectionId(null);
      setDropSectionBeforeId(null);
    }
  }

  async function removeNodesFromSection(sectionId: string, nodeIds: string[]) {
    const ids = [...new Set(nodeIds.filter(Boolean))];
    if (ids.length === 0) return;

    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      const res = await fetch("/api/admin/org-chart-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sectionId, nodeIds: ids, remove: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Could not remove section memberships.",
        );
      }
      await reloadNodes();
      await reloadSections();
      const label = sections.find((s) => s.id === sectionId)?.name ?? "section";
      onMessage(
        ids.length === 1
          ? `Removed member from ${label}.`
          : `Removed ${ids.length} members from ${label}.`,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove section memberships.");
    } finally {
      setBusy(false);
      setDragNodeId(null);
      setDropSectionId(null);
    }
  }

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const formOpen = creating || editId != null;
  const editingSection = editId ? sectionById.get(editId) ?? null : null;
  const formParent =
    parentIdForCreate && !editId
      ? sectionById.get(parentIdForCreate) ?? null
      : editingSection?.parentId
        ? sectionById.get(editingSection.parentId) ?? null
        : null;
  const isSubsectionForm = Boolean(formParent) || Boolean(editingSection?.parentId);

  function renderMemberList(section: OrgChartSectionRow, emptyHint: string) {
    const members = nodesBySection.get(section.id) ?? [];
    const roles = section.roles ?? [];
    return (
      <div>
        {members.length > 0 && !readOnly ? (
          <div className="space-y-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
            <label className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                <Crown className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                {section.parentId ? "Sub-department head" : "Department head"}
              </span>
              <select
                disabled={busy}
                value={section.headNodeId ?? ""}
                onChange={(e) => {
                  const next = e.target.value;
                  void setSectionHead(section.id, next || null);
                }}
                title={
                  section.parentId
                    ? "Sub-department head → portal Admin. Non-heads stay Personnel. Custom section roles stay as membership labels."
                    : "Department head → portal Admin. Non-heads stay Personnel. Custom section roles stay as membership labels."
                }
                className="h-8 min-w-[12rem] flex-1 rounded-lg border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">— No head —</option>
                {members.map((n) => (
                  <option key={`head-${section.id}-${n.id}`} value={n.id}>
                    {n.personName}
                    {[n.personRole, n.companyName].filter(Boolean).length > 0
                      ? ` · ${[n.personRole, n.companyName].filter(Boolean).join(" · ")}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/70 p-2 dark:border-zinc-700 dark:bg-zinc-950/40">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Custom section roles
              </p>
              {roles.length > 0 ? (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                  {roles.map((role) => (
                    <li
                      key={role.id}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      {role.label}
                      <button
                        type="button"
                        disabled={busy}
                        title={`Remove ${role.label}`}
                        className="text-zinc-400 hover:text-rose-600 disabled:opacity-40"
                        onClick={() => void deleteSectionRole(section.id, role.id, role.label)}
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-[11px] text-zinc-500">
                  Add roles like Deputy, Coordinator, or SME — then assign them on each member.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  value={newRoleBySection[section.id] ?? ""}
                  disabled={busy}
                  placeholder="New role label"
                  maxLength={80}
                  onChange={(e) =>
                    setNewRoleBySection((prev) => ({
                      ...prev,
                      [section.id]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void createSectionRole(section.id);
                    }
                  }}
                  className="h-8 min-w-[10rem] flex-1 rounded-lg border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  className="h-8 rounded-lg px-2 text-xs"
                  onClick={() => void createSectionRole(section.id)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Add role
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {members.length === 0 ? (
            <li className="px-4 py-3 text-xs text-zinc-500">{emptyHint}</li>
          ) : (
            members.map((n) => {
              const isHead = section.headNodeId === n.id;
              const membership = n.sectionMemberships.find((m) => m.sectionId === section.id);
              const assignedRoleId = membership?.roleId ?? membership?.role?.id ?? "";
              const assignedRoleLabel = membership?.role?.label ?? null;
              const mergedId = (n.mergedSourceUserId ?? "").trim();
              const portalRole =
                (mergedId && portalRoleByMergedId[mergedId]) ||
                (isHead ? section.headRole : null) ||
                "Personnel";
              return (
                <li
                  key={n.id}
                  draggable={!busy && !readOnly}
                  onClick={() => {
                    if (onSelectMembers) onSelectMembers([n.id], n);
                    else onSelectMember(n);
                  }}
                  onDragStart={(e) => {
                    if (readOnly) {
                      e.preventDefault();
                      return;
                    }
                    setDragNodeId(n.id);
                    e.dataTransfer.setData("text/org-node-id", n.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragNodeId(null);
                    setDropSectionId(null);
                  }}
                  className={`flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm sm:flex-nowrap sm:gap-3 ${
                    dragNodeId === n.id ? "opacity-50" : ""
                  } ${isHead ? "bg-amber-50/80 dark:bg-amber-950/20" : ""} ${
                    busy
                      ? "cursor-default"
                      : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  {isHead ? (
                    <Crown
                      className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                  ) : (
                    <span className="w-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {n.personName}
                    {isHead ? (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        Head
                      </span>
                    ) : null}
                    {assignedRoleLabel ? (
                      <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                        {assignedRoleLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 truncate text-xs text-zinc-500">
                    {[n.personRole, n.companyName].filter(Boolean).join(" · ")}
                  </span>
                  {canSetPortalRoles && mergedId ? (
                    portalRole === "SuperAdmin" ||
                    portalRole === "Customer" ||
                    portalRole === "Personnel-Guard" ? (
                      <span
                        className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        title="Change this role from ListView"
                      >
                        {portalRole}
                      </span>
                    ) : (
                      <label
                        className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-500"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="sr-only">Portal role</span>
                        <select
                          disabled={busy}
                          value={
                            portalRole === "Personnel" ||
                            portalRole === "Admin" ||
                            portalRole === "HighAdmin"
                              ? portalRole
                              : "Personnel"
                          }
                          title="Elevate portal role (ListView)"
                          onChange={(e) => {
                            void setMemberPortalRole(n, e.target.value);
                          }}
                          className="h-7 max-w-[8.5rem] rounded-md border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-950 outline-none focus:border-orange-500/60 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                        >
                          <option value="Personnel">Personnel</option>
                          <option value="Admin">Admin</option>
                          <option value="HighAdmin">HighAdmin</option>
                        </select>
                      </label>
                    )
                  ) : null}
                  {!readOnly ? (
                    <label
                      className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="sr-only">Section role</span>
                      <select
                        disabled={busy || roles.length === 0}
                        value={assignedRoleId}
                        title={
                          roles.length === 0
                            ? "Add a custom role above first"
                            : "Assign section role"
                        }
                        onChange={(e) => {
                          void setMemberSectionRole(
                            section.id,
                            n.id,
                            e.target.value || null,
                          );
                        }}
                        className="h-7 max-w-[9rem] rounded-md border border-zinc-300 bg-white px-1.5 text-[11px] outline-none focus:border-orange-500/60 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <option value="">Role…</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {!readOnly ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="shrink-0 text-[11px] font-semibold text-zinc-500 hover:text-rose-600 disabled:opacity-40"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeNodesFromSection(section.id, [n.id]);
                      }}
                    >
                      Remove from section
                    </button>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </div>
    );
  }

  function countMembersInSubtree(sectionId: string): number {
    let total = nodesBySection.get(sectionId)?.length ?? 0;
    for (const child of childrenByParent.get(sectionId) ?? []) {
      total += countMembersInSubtree(child.id);
    }
    return total;
  }

  function countDescendantSections(sectionId: string): number {
    let total = 0;
    for (const child of childrenByParent.get(sectionId) ?? []) {
      total += 1 + countDescendantSections(child.id);
    }
    return total;
  }

  function renderReorderBeforeDrop(section: OrgChartSectionRow, depth: number) {
    const dragging = sectionDrag.draggingItemId;
    if (!dragging || dragging === section.id) return null;
    const dragParent = sectionParentIdRef.current.get(dragging) ?? null;
    if (dragParent !== (section.parentId ?? null)) return null;
    const colId = beforeDropId(section.id);
    const isActive = sectionDrag.hoverColumn === colId;
    return (
      <div
        key={`before-${section.id}`}
        ref={sectionDrag.registerColumn(colId)}
        className={`rounded-lg border border-dashed px-3 py-1.5 text-center text-[11px] font-semibold transition ${
          isActive
            ? "border-orange-400 bg-orange-50 text-orange-800 dark:border-orange-600 dark:bg-orange-950/40 dark:text-orange-200"
            : "border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
        }`}
        style={depth > 0 ? { marginLeft: `${Math.min(depth, 6) * 16}px` } : undefined}
      >
        {isActive ? "Drop to place here" : "·"}
      </div>
    );
  }

  function renderSiblingEndDrop(parentId: string | null, depth: number) {
    const dragging = sectionDrag.draggingItemId || dragSectionId;
    if (!dragging) return null;
    const dragParent = sectionParentIdRef.current.get(dragging) ?? null;
    if (dragParent !== (parentId ?? null)) return null;
    const colId = endDropId(parentId);
    const isActive =
      sectionDrag.hoverColumn === colId ||
      dropSectionBeforeId === `__end__:${parentId ?? "root"}`;
    return (
      <div
        key={`end-drop-${parentId ?? "root"}`}
        ref={sectionDrag.registerColumn(colId)}
        onDragOver={(e) => {
          if (sectionDrag.draggingItemId) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          setDropSectionBeforeId(`__end__:${parentId ?? "root"}`);
        }}
        onDragLeave={() => {
          if (dropSectionBeforeId === `__end__:${parentId ?? "root"}`) {
            setDropSectionBeforeId(null);
          }
        }}
        onDrop={(e) => {
          if (sectionDrag.draggingItemId) return;
          e.preventDefault();
          e.stopPropagation();
          const sectionDragId =
            e.dataTransfer.getData("text/org-section-id") || dragSectionId;
          if (sectionDragId) {
            void reorderSiblingDepartments(parentId, sectionDragId, null);
          }
          setDragSectionId(null);
          setDropSectionBeforeId(null);
        }}
        className={`rounded-lg border border-dashed px-3 py-2 text-center text-[11px] font-semibold transition ${
          isActive
            ? "border-orange-400 bg-orange-50 text-orange-800 dark:border-orange-600 dark:bg-orange-950/40 dark:text-orange-200"
            : "border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
        }`}
        style={depth > 0 ? { marginLeft: `${Math.min(depth, 6) * 16}px` } : undefined}
      >
        Drop here to place last
      </div>
    );
  }

  function renderSectionBlock(section: OrgChartSectionRow, depth: number) {
    const members = nodesBySection.get(section.id) ?? [];
    const subsections = childrenByParent.get(section.id) ?? [];
    const isCollapsed = collapsed[section.id] === true;
    const isMemberDropTarget = dropSectionId === section.id && !dragSectionId;
    const isReorderTarget =
      dropSectionBeforeId === section.id ||
      (Boolean(sectionDrag.draggingItemId) &&
        sectionDrag.hoverColumn === section.id &&
        (sectionParentIdRef.current.get(sectionDrag.draggingItemId!) ?? null) ===
          (section.parentId ?? null) &&
        sectionDrag.draggingItemId !== section.id) ||
      sectionDrag.hoverColumn === beforeDropId(section.id);
    const isNestDropTarget =
      sectionDrag.hoverColumn === section.id &&
      Boolean(sectionDrag.draggingItemId) &&
      sectionDrag.draggingItemId !== section.id &&
      (sectionParentIdRef.current.get(sectionDrag.draggingItemId!) ?? null) !==
        (section.parentId ?? null);
    const isDraggingThis =
      sectionDrag.draggingItemId === section.id || dragSectionId === section.id;
    const totalInTree = countMembersInSubtree(section.id);
    const nestedCount = countDescendantSections(section.id);
    const isMain = depth === 0;
    const siblingParentId = section.parentId;
    const gripProps = getSectionGripProps(section);
    const draggingParentId = sectionDrag.draggingItemId
      ? (sectionParentIdRef.current.get(sectionDrag.draggingItemId) ?? null)
      : null;
    const showMoveOutDrop = draggingParentId === section.id;
    const isMoveOutDropTarget =
      showMoveOutDrop && sectionDrag.hoverColumn === moveUpDropId(section.id);
    const parentName = section.parentId
      ? (sectionById.get(section.parentId)?.name ?? "parent")
      : null;
    const grandparentId = section.parentId
      ? (sectionById.get(section.parentId)?.parentId ?? null)
      : null;
    const grandparentName = grandparentId
      ? (sectionById.get(grandparentId)?.name ?? null)
      : null;

    return (
      <div
        key={section.id}
        className={`overflow-hidden rounded-xl border transition ${
          depth > 0 ? "border-l-2 border-l-orange-300/70 dark:border-l-orange-700/60" : ""
        } ${
          isDraggingThis
            ? "opacity-50"
            : isNestDropTarget
              ? "border-sky-400 bg-sky-50/80 ring-2 ring-sky-300/60 dark:border-sky-500 dark:bg-sky-950/30 dark:ring-sky-700/50"
              : isReorderTarget
                ? "border-orange-400 bg-orange-50/50 ring-2 ring-orange-300/50 dark:border-orange-600 dark:bg-orange-950/20 dark:ring-orange-700/40"
                : isMemberDropTarget
                  ? "border-orange-400 bg-orange-50/80 dark:border-orange-600 dark:bg-orange-950/30"
                  : "border-zinc-200 dark:border-zinc-800"
        }`}
        style={depth > 0 ? { marginLeft: `${Math.min(depth, 6) * 16}px` } : undefined}
      >
        {isReorderTarget && dropSectionBeforeId === section.id ? (
          <div className="h-1 rounded-t-xl bg-orange-500" aria-hidden />
        ) : null}
        <div
          ref={sectionDrag.registerColumn(section.id)}
          className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${
            isMain
              ? "bg-zinc-50/80 dark:bg-zinc-950/50"
              : "bg-white dark:bg-zinc-900/80"
          } ${
            isNestDropTarget ? "ring-2 ring-inset ring-sky-400/80 dark:ring-sky-500/60" : ""
          }`}
          onDragOver={(e) => {
            if (sectionDrag.draggingItemId) return;
            if (dragSectionId) {
              const dragged = sectionById.get(dragSectionId);
              if (!dragged || dragged.id === section.id) return;
              if ((dragged.parentId ?? null) !== (siblingParentId ?? null)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setDropSectionBeforeId(section.id);
              return;
            }
            if (!dragNodeId) return;
            e.preventDefault();
            e.stopPropagation();
            setDropSectionId(section.id);
          }}
          onDragLeave={() => {
            if (dropSectionId === section.id) setDropSectionId(null);
            if (dropSectionBeforeId === section.id) setDropSectionBeforeId(null);
          }}
          onDrop={(e) => {
            if (sectionDrag.draggingItemId) return;
            e.preventDefault();
            e.stopPropagation();
            const sectionDragId =
              e.dataTransfer.getData("text/org-section-id") || dragSectionId;
            if (sectionDragId) {
              const dragged = sectionById.get(sectionDragId);
              if (
                dragged &&
                dragged.id !== section.id &&
                (dragged.parentId ?? null) === (siblingParentId ?? null)
              ) {
                void reorderSiblingDepartments(
                  siblingParentId ?? null,
                  sectionDragId,
                  section.id,
                );
              }
              setDragSectionId(null);
              setDropSectionBeforeId(null);
              return;
            }
            const id = e.dataTransfer.getData("text/org-node-id") || dragNodeId;
            if (id) void assignNodes(section.id, [id]);
          }}
        >
          <span
            {...gripProps}
            title="Drag to reorder among siblings, or drop onto a different department to nest"
            aria-label={`Drag ${section.name}`}
            className={`inline-flex h-8 w-8 shrink-0 touch-none select-none items-center justify-center rounded-lg border border-zinc-300/80 text-zinc-500 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-orange-600 dark:hover:bg-orange-950/40 dark:hover:text-orange-200 ${
              busy ? "cursor-default opacity-40" : "cursor-grab active:cursor-grabbing"
            }`}
          >
            <GripVertical className="pointer-events-none h-4 w-4" aria-hidden />
          </span>
          <button
            type="button"
            onClick={() => toggleCollapsed(section.id)}
            className="inline-flex items-center gap-1.5 text-left"
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            )}
            <span
              className={`${
                isMain ? "text-sm font-semibold" : "text-sm font-medium"
              } text-zinc-900 dark:text-zinc-100`}
            >
              {section.name}
            </span>
          </button>
          {!isMain ? (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800 dark:bg-orange-950/50 dark:text-orange-200">
              Level {depth + 1}
            </span>
          ) : null}
          <span className="rounded-full bg-zinc-200/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {subsections.length > 0
              ? `${totalInTree} · ${members.length} here`
              : members.length}
          </span>
          {subsections.length > 0 ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {nestedCount} nested
            </span>
          ) : null}
          {section.companyName ? (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
              {section.companyName}
            </span>
          ) : null}
          {section.headName ? (
            <span
              className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              title={[section.headName, section.headRole, section.headCompanyName]
                .filter(Boolean)
                .join(" · ")}
            >
              <Crown className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">Head: {section.headName}</span>
            </span>
          ) : null}
          {section.reportsToName ? (
            <span
              className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-900 dark:bg-sky-950/50 dark:text-sky-200"
              title={section.reportsToName}
            >
              <span className="truncate">
                Reports to: {section.reportsToName}
              </span>
            </span>
          ) : null}
          {section.description ? (
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
              {section.description}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {!isMain ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg px-2 text-xs"
                disabled={busy}
                title={
                  grandparentName
                    ? `Move out of “${parentName}” under “${grandparentName}”`
                    : `Move out of “${parentName}” to main level`
                }
                onClick={() => moveSectionUpOneLevel(section.id)}
              >
                <ArrowUpFromLine className="mr-1 h-3.5 w-3.5" />
                Move up
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg px-2 text-xs"
                disabled={busy}
                title="Promote this subsection to a top-level main section"
                onClick={() => void moveSection(section.id, null)}
              >
                <Ungroup className="mr-1 h-3.5 w-3.5" />
                Make main
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-lg px-2 text-xs"
            disabled={busy}
            onClick={() => startCreateSubsection(section)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add child
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-lg px-2 text-xs"
            disabled={busy || chartSelectedIds.length === 0}
            title={
              chartSelectedIds.length === 0
                ? "Select chart members first"
                : `Add ${chartSelectedIds.length} selected`
            }
            onClick={() => void assignNodes(section.id, chartSelectedIds)}
          >
            <Users className="mr-1 h-3.5 w-3.5" />
            Add selected
          </Button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Edit ${section.name}`}
            onClick={() => startEdit(section)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Delete ${section.name}`}
            onClick={() => void deleteSection(section)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-300/70 text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {!isCollapsed ? (
          <div className="space-y-2 border-t border-zinc-100 p-2 dark:border-zinc-800">
            {showMoveOutDrop ? (
              <div
                ref={sectionDrag.registerColumn(moveUpDropId(section.id))}
                className={`rounded-lg border-2 border-dashed px-3 py-3 text-center text-xs transition ${
                  isMoveOutDropTarget
                    ? "border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-100"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                }`}
              >
                Drop here to move{" "}
                <span className="font-semibold">out of “{section.name}”</span>
                <span className="mt-0.5 block opacity-80">
                  {section.parentId
                    ? `→ under “${sectionById.get(section.parentId)?.name ?? "parent"}”`
                    : "→ becomes a main section"}
                </span>
              </div>
            ) : null}
            {renderMemberList(
              section,
              "No members yet — use Add or remove member (with a department), or Add selected from the chart.",
            )}
            {subsections.length > 0 ? (
              <div className="space-y-2 pt-1">
                {subsections.map((child) => (
                  <div key={child.id} className="space-y-2">
                    {renderReorderBeforeDrop(child, depth + 1)}
                    {renderSectionBlock(child, depth + 1)}
                  </div>
                ))}
                {renderSiblingEndDrop(section.id, depth + 1)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white/95 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Departments
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {roots.length} main
              {sections.length > roots.length
                ? ` · ${sections.length - roots.length} sub`
                : ""}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {readOnly
              ? "Browse your department and sub-department members. Portal roles are managed by SuperAdmin."
              : (
                <>
                  Drag the <span className="font-medium">grip</span> to rearrange departments at the same
                  level, or drop onto a different department to nest it. Use{" "}
                  <span className="font-medium">Move up</span> /{" "}
                  <span className="font-medium">Make main</span> to change nesting. Add people from{" "}
                  <span className="font-medium">Add or remove member</span> (choose a department), or use{" "}
                  <span className="font-medium">Add selected</span> for chart members. Pick a head and
                  optional custom roles after members are in place. SuperAdmin can elevate Personnel /
                  Admin / HighAdmin on each member.
                </>
              )}
          </p>
        </div>
        {!readOnly ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-xl"
            disabled={busy}
            onClick={startCreateMain}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New department
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <div className="mt-4 space-y-3 rounded-xl border border-orange-200/80 bg-orange-50/50 p-4 dark:border-orange-900/40 dark:bg-orange-950/20">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {editId
                ? "Edit department"
                : isSubsectionForm
                  ? `New department under “${formParent?.name ?? "department"}”`
                  : "Create department"}
            </p>
            <button
              type="button"
              aria-label="Close form"
              onClick={resetForm}
              className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder={
                  isSubsectionForm ? "e.g. Field Ops" : "e.g. Operations"
                }
                className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Company scope (optional)
              </span>
              <select
                value={companyTeamId}
                onChange={(e) => setCompanyTeamId(e.target.value)}
                className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">— All companies —</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Reports to
              </span>
              <select
                value={reportsToTarget}
                onChange={(e) => {
                  const next = e.target.value;
                  setReportsToTarget(next);
                  if (next.startsWith("dept:")) {
                    setParentIdForCreate(next.slice("dept:".length));
                  } else {
                    setParentIdForCreate(null);
                  }
                }}
                className="h-10 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">— Top-level (no parent) —</option>
                <optgroup label="Department">
                  {sectionsForReportsToPicker.map((s) => (
                    <option key={`dept-${s.id}`} value={`dept:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Person on org chart">
                  {peopleForReportsToPicker.map((n) => (
                    <option key={`person-${n.id}`} value={`person:${n.id}`}>
                      {n.personName}
                    </option>
                  ))}
                </optgroup>
              </select>
              <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Choose another department or an individual. Person and department parents are
                mutually exclusive.
              </p>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                Description (optional)
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Short note about this group"
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500/60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-9 rounded-xl" disabled={busy} onClick={saveSection}>
              {editId ? "Save changes" : "Create department"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl"
              disabled={busy}
              onClick={resetForm}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {roots.length === 0 && unassigned.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No departments yet. Create one to group people on the chart.
          </p>
        ) : null}

        <div
          onDragOver={(e) => {
            if (!dragNodeId) return;
            e.preventDefault();
            setDropSectionId("__unassigned__");
          }}
          onDragLeave={() => {
            if (dropSectionId === "__unassigned__") setDropSectionId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/org-node-id") || dragNodeId;
            if (id) void assignNodes(null, [id]);
          }}
          className={`sticky top-0 z-10 overflow-hidden rounded-xl border border-dashed bg-white/95 shadow-sm backdrop-blur-sm transition dark:bg-zinc-900/95 ${
            dropSectionId === "__unassigned__"
              ? "border-orange-400 bg-orange-50/80 dark:border-orange-600 dark:bg-orange-950/30"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <button
              type="button"
              onClick={() => toggleCollapsed("__unassigned__")}
              className="inline-flex items-center gap-1.5"
              aria-expanded={collapsed.__unassigned__ !== true}
            >
              {collapsed.__unassigned__ === true ? (
                <ChevronRight className="h-4 w-4 text-zinc-500" />
              ) : (
                <ChevronDown className="h-4 w-4 text-zinc-500" />
              )}
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                Unassigned
              </span>
            </button>
            <span className="rounded-full bg-zinc-200/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {unassigned.length}
            </span>
            <span className="min-w-0 flex-1 text-xs text-zinc-500">
              Shift-click to select a range · Ctrl/⌘-click to toggle · then Remove
            </span>
            {unassignedSelectedIds.length > 0 && onRemoveSelected ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg border-rose-300 px-2 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                disabled={busy}
                onClick={() => onRemoveSelected(unassignedSelectedIds)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {unassignedSelectedIds.length > 1
                  ? `Remove ${unassignedSelectedIds.length}`
                  : "Remove"}
              </Button>
            ) : null}
            {chartSelectedIds.length > 0 && unassignedSelectedIds.length === 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg px-2 text-xs"
                disabled={busy}
                onClick={() => void assignNodes(null, chartSelectedIds)}
              >
                Unassign selected
              </Button>
            ) : null}
          </div>
          {collapsed.__unassigned__ !== true ? (
            unassigned.length > 0 ? (
              <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                {unassigned.map((n) => {
                  const selected = chartSelectedIds.includes(n.id);
                  return (
                    <li
                      key={n.id}
                      draggable={!busy}
                      onClick={(e) => selectUnassignedMember(e, n)}
                      onDragStart={(e) => {
                        setDragNodeId(n.id);
                        e.dataTransfer.setData("text/org-node-id", n.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragNodeId(null);
                        setDropSectionId(null);
                      }}
                      className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
                        dragNodeId === n.id ? "opacity-50" : ""
                      } ${
                        selected
                          ? "bg-orange-50 ring-1 ring-inset ring-orange-300/80 dark:bg-orange-950/30 dark:ring-orange-700/50"
                          : ""
                      } ${
                        busy
                          ? "cursor-default"
                          : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {n.personName}
                      </span>
                      <span className="shrink-0 truncate text-xs text-zinc-500">
                        {[n.personRole, n.companyName].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800">
                No unassigned chart members. Add people without a department, or unassign them
                from a department, and they will show up here.
              </p>
            )
          ) : null}
        </div>

        <div
          ref={sectionDrag.registerColumn(MAIN_SECTION_DROP)}
          className={
            sectionDrag.draggingItemId
              ? `sticky top-0 z-20 rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm shadow-sm backdrop-blur-sm transition ${
                  sectionDrag.hoverColumn === MAIN_SECTION_DROP
                    ? "border-sky-400 bg-sky-50 text-sky-900 dark:border-sky-500 dark:bg-sky-950/60 dark:text-sky-100"
                    : "border-zinc-300 bg-white/95 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900/95 dark:text-zinc-300"
                }`
              : "pointer-events-none h-0 overflow-hidden opacity-0"
          }
        >
          Drop here to make a <span className="font-semibold">main section</span>
          <span className="mt-0.5 block text-xs opacity-80">
            Or drop on another group to nest · drop on a sibling to reorder
          </span>
        </div>

        {roots.map((section) => (
          <div key={section.id} className="space-y-2">
            {renderReorderBeforeDrop(section, 0)}
            {renderSectionBlock(section, 0)}
          </div>
        ))}
        {roots.length > 0 ? renderSiblingEndDrop(null, 0) : null}
      </div>
      <PointerDragGhostLayer ghost={sectionDrag.ghost} />
    </div>
  );
}
