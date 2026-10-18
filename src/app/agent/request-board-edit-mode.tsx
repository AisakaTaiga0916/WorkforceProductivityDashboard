"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PanelsTopLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RequestBoardColumnDto } from "@/modules/requests/request-board-columns-shared";
import { RequestBoardColumnManager } from "./request-board-column-manager";

type RequestBoardEditModeContextValue = {
  canManage: boolean;
  editing: boolean;
  setEditing: (next: boolean) => void;
  toggleEditing: () => void;
};

const RequestBoardEditModeContext = createContext<RequestBoardEditModeContextValue | null>(
  null,
);

export function RequestBoardEditModeProvider({
  canManage,
  children,
}: {
  canManage: boolean;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!canManage) setEditing(false);
  }, [canManage]);

  const toggleEditing = useCallback(() => {
    setEditing((prev) => !prev);
  }, []);

  const value = useMemo(
    () => ({
      canManage,
      editing: canManage && editing,
      setEditing,
      toggleEditing,
    }),
    [canManage, editing, toggleEditing],
  );

  return (
    <RequestBoardEditModeContext.Provider value={value}>
      {children}
    </RequestBoardEditModeContext.Provider>
  );
}

export function useRequestBoardEditMode() {
  return useContext(RequestBoardEditModeContext);
}

/** Effective column-manage flag for the kanban (edit mode must be on). */
export function useCanManageRequestBoardColumns() {
  const ctx = useRequestBoardEditMode();
  if (!ctx) return false;
  return ctx.canManage && ctx.editing;
}

/** Toggle + Add board — only shown when the user can manage their personal board. */
export function RequestBoardManageToolbar({
  columns,
  onColumnsChange,
}: {
  columns: RequestBoardColumnDto[];
  onColumnsChange?: (columns: RequestBoardColumnDto[]) => void;
}) {
  const ctx = useRequestBoardEditMode();
  if (!ctx?.canManage) return null;

  const { editing, toggleEditing } = ctx;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={toggleEditing}
        aria-pressed={editing}
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border transition",
          editing
            ? "border-orange-500 bg-orange-600 text-white hover:bg-orange-500"
            : "border-zinc-300 bg-white text-zinc-700 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-orange-500/60 dark:hover:bg-orange-950/40 dark:hover:text-orange-200",
        )}
        aria-label={editing ? "Done editing boards" : "Edit boards"}
        title={
          editing
            ? "Done — hide drag, edit, and add board"
            : "Edit boards — drag, rename, and add boards"
        }
      >
        <PanelsTopLeft className="size-5" strokeWidth={2.25} aria-hidden />
      </button>

      {editing ? (
        <RequestBoardColumnManager
          columns={columns}
          canManage
          onColumnsChange={onColumnsChange}
        />
      ) : null}
    </div>
  );
}
