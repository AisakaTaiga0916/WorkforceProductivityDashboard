"use client";

import { useEffect, useState } from "react";

export type ClientPermissionState = {
  /** False until the first fetch resolves; unknown is treated as "allow". */
  loaded: boolean;
  roleKey: string | null;
  roleName: string | null;
  permissions: ReadonlySet<string>;
};

const UNKNOWN_PERMISSIONS: ClientPermissionState = {
  loaded: false,
  roleKey: null,
  roleName: null,
  permissions: new Set(),
};

let cached: ClientPermissionState | null = null;
let inflight: Promise<ClientPermissionState> | null = null;

function parsePermissionState(body: unknown): ClientPermissionState {
  const record = (body ?? {}) as {
    role?: { key?: unknown; name?: unknown } | null;
    permissions?: unknown;
  };
  const permissions = new Set(
    Array.isArray(record.permissions)
      ? record.permissions.filter((key): key is string => typeof key === "string")
      : [],
  );
  return {
    loaded: true,
    roleKey: typeof record.role?.key === "string" ? record.role.key : null,
    roleName: typeof record.role?.name === "string" ? record.role.name : null,
    permissions,
  };
}

async function fetchPermissions(): Promise<ClientPermissionState> {
  try {
    const res = await fetch("/api/me/permissions", { cache: "no-store" });
    if (!res.ok) return cached ?? UNKNOWN_PERMISSIONS;
    cached = parsePermissionState(await res.json());
    return cached;
  } catch {
    return cached ?? UNKNOWN_PERMISSIONS;
  } finally {
    inflight = null;
  }
}

export function loadClientPermissions(force = false): Promise<ClientPermissionState> {
  if (!force && cached) return Promise.resolve(cached);
  inflight ??= fetchPermissions();
  return inflight;
}

/** Effective RBAC permissions for the signed-in user (cached after first load). */
export function usePermissions(): ClientPermissionState {
  const [state, setState] = useState<ClientPermissionState>(cached ?? UNKNOWN_PERMISSIONS);

  useEffect(() => {
    let active = true;
    void loadClientPermissions().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

/**
 * True when the state doesn't know any better yet (fail-open until loaded), or
 * the user holds the key. UI honesty only — APIs enforce permissions server-side.
 */
export function permissionAllows(state: ClientPermissionState, key: string): boolean {
  return !state.loaded || state.permissions.has(key);
}
