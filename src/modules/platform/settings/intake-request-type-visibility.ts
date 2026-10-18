/**
 * Client-safe helpers for intake request type visibility.
 * DB access lives in intake-request-type-visibility-db.ts.
 */

import {
  DEFAULT_REQUEST_TYPE,
  isRequestTypeId,
  REQUEST_TYPES,
  type RequestTypeId,
} from "@/modules/requests/request-types";

export const INTAKE_REQUEST_TYPE_VISIBILITY_KEY = "intake_request_type_visibility";

export type IntakeRequestTypeVisibility = {
  /** Request types hidden from the create-request type picker. */
  hiddenTypeIds: RequestTypeId[];
};

export function parseIntakeRequestTypeVisibility(raw: unknown): IntakeRequestTypeVisibility {
  const ids = new Set<RequestTypeId>();
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { hiddenTypeIds?: unknown }).hiddenTypeIds)
  ) {
    for (const id of (raw as { hiddenTypeIds: unknown[] }).hiddenTypeIds) {
      if (isRequestTypeId(id)) ids.add(id);
    }
  }
  return { hiddenTypeIds: [...ids] };
}

export function isRequestTypeHiddenFromIntake(
  id: string | null | undefined,
  hiddenIds: ReadonlySet<RequestTypeId> | readonly RequestTypeId[],
): boolean {
  const typeId = (id ?? "").trim();
  if (!typeId) return false;
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(hiddenIds);
  return hidden.has(typeId as RequestTypeId);
}

export function visibleIntakeRequestTypes(hiddenIds: readonly RequestTypeId[]) {
  const hidden = new Set(hiddenIds);
  return REQUEST_TYPES.filter((type) => !hidden.has(type.id));
}

export function firstVisibleIntakeRequestType(
  hiddenIds: readonly RequestTypeId[],
): RequestTypeId {
  return visibleIntakeRequestTypes(hiddenIds)[0]?.id ?? DEFAULT_REQUEST_TYPE;
}
