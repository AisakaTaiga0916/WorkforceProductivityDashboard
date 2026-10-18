import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_ACTIONS,
  PERMISSION_CATALOG,
  PERMISSION_RESOURCES,
  allPermissionKeys,
  permissionCatalogByResource,
  permissionKeyIsKnown,
} from "@/modules/platform/rbac/permission-catalog";

describe("permission catalog", () => {
  it("has unique permission keys", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ALL_PERMISSION_KEYS.length).toBe(keys.length);
  });

  it("uses well-formed <resource>.<action> keys", () => {
    for (const permission of PERMISSION_CATALOG) {
      expect(permission.key).toBe(`${permission.resource}.${permission.action}`);
      expect(PERMISSION_RESOURCES).toContain(permission.resource);
      expect(PERMISSION_ACTIONS).toContain(permission.action);
      expect(permissionKeyIsKnown(permission.key)).toBe(true);
    }
  });

  it("defines a non-empty description for every permission", () => {
    for (const permission of PERMISSION_CATALOG) {
      expect(permission.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown keys", () => {
    expect(permissionKeyIsKnown("tasks.bogus")).toBe(false);
    expect(permissionKeyIsKnown("")).toBe(false);
  });

  it("groups every permission by resource without loss", () => {
    const grouped = permissionCatalogByResource();
    const total = grouped.reduce((sum, g) => sum + g.permissions.length, 0);
    expect(total).toBe(PERMISSION_CATALOG.length);
    expect(grouped.map((g) => g.resource)).toEqual(
      PERMISSION_RESOURCES.filter((r) =>
        PERMISSION_CATALOG.some((p) => p.resource === r),
      ),
    );
  });

  it("returns a fresh copy from allPermissionKeys", () => {
    const first = allPermissionKeys();
    first.pop();
    expect(allPermissionKeys().length).toBe(PERMISSION_CATALOG.length);
  });
});
