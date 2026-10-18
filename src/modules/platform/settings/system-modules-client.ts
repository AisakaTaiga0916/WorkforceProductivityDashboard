"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SYSTEM_MODULE_VISIBILITY,
  parseSystemModuleVisibility,
  type SystemModuleVisibility,
} from "@/modules/platform/settings/system-modules";

export const SYSTEM_MODULES_CHANGED_EVENT = "system-modules-changed";

let cached: SystemModuleVisibility | null = null;
let inflight: Promise<SystemModuleVisibility> | null = null;

async function fetchModules(): Promise<SystemModuleVisibility> {
  try {
    const res = await fetch("/api/system-settings/modules", { cache: "no-store" });
    if (!res.ok) return cached ?? DEFAULT_SYSTEM_MODULE_VISIBILITY;
    cached = parseSystemModuleVisibility(await res.json());
    return cached;
  } catch {
    return cached ?? DEFAULT_SYSTEM_MODULE_VISIBILITY;
  } finally {
    inflight = null;
  }
}

function loadModules(force = false): Promise<SystemModuleVisibility> {
  if (!force && cached) return Promise.resolve(cached);
  inflight ??= fetchModules();
  return inflight;
}

/** Tenant-wide module visibility for nav; everything shows until the first load resolves. */
export function useSystemModules(enabled = true): SystemModuleVisibility {
  const [modules, setModules] = useState<SystemModuleVisibility>(
    cached ?? DEFAULT_SYSTEM_MODULE_VISIBILITY,
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const apply = (next: SystemModuleVisibility) => {
      if (active) setModules(next);
    };
    void loadModules().then(apply);
    const onChange = () => void loadModules(true).then(apply);
    window.addEventListener(SYSTEM_MODULES_CHANGED_EVENT, onChange);
    return () => {
      active = false;
      window.removeEventListener(SYSTEM_MODULES_CHANGED_EVENT, onChange);
    };
  }, [enabled]);

  return modules;
}
