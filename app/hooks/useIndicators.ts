/**
 * useIndicators.ts
 *
 * Manages the list of active IndicatorInstance objects with:
 *  - add / remove / update / toggleVisible operations
 *  - automatic localStorage persistence (key: "chartlens_indicators_v2")
 *  - helpers to query active instances by type
 */

import { useCallback, useEffect, useState } from "react";
import {
  defaultParams,
  IndicatorInstance,
  IndicatorKey,
  pickColor,
} from "@/lib/indicatorTypes";

const LS_KEY = "chartlens_indicators_v2";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
}

function loadFromStorage(): IndicatorInstance[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IndicatorInstance[];
    // Validate shape — discard if malformed
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) =>
        x && typeof x.id === "string" && typeof x.type === "string" &&
        typeof x.params === "object" && typeof x.visible === "boolean"
    );
  } catch {
    return [];
  }
}

function saveToStorage(instances: IndicatorInstance[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(instances));
  } catch { /* storage full — silent */ }
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useIndicators() {
  const [instances, setInstances] = useState<IndicatorInstance[]>(() => loadFromStorage());

  // Persist to localStorage on every change
  useEffect(() => {
    saveToStorage(instances);
  }, [instances]);

  /** Add a new instance with given type and (optional) param overrides */
  const addInstance = useCallback((
    type: IndicatorKey,
    paramOverrides?: Record<string, number>,
  ): IndicatorInstance => {
    const params = { ...defaultParams(type), ...paramOverrides };
    const countOfType = instances.filter((i) => i.type === type).length;
    const color = pickColor(type, countOfType);
    const inst: IndicatorInstance = {
      id: makeId(),
      type,
      params,
      color,
      visible: true,
    };
    setInstances((prev) => [...prev, inst]);
    return inst;
  }, [instances]);

  /** Remove an instance by ID */
  const removeInstance = useCallback((id: string) => {
    setInstances((prev) => prev.filter((i) => i.id !== id));
  }, []);

  /** Update params of an existing instance */
  const updateInstance = useCallback((id: string, patch: Partial<Pick<IndicatorInstance, "params" | "color" | "visible">>) => {
    setInstances((prev) =>
      prev.map((i) => i.id === id ? { ...i, ...patch } : i)
    );
  }, []);

  /** Toggle visibility without removing */
  const toggleVisible = useCallback((id: string) => {
    setInstances((prev) =>
      prev.map((i) => i.id === id ? { ...i, visible: !i.visible } : i)
    );
  }, []);

  /** Remove all instances of a given type */
  const removeByType = useCallback((type: IndicatorKey) => {
    setInstances((prev) => prev.filter((i) => i.type !== type));
  }, []);

  /** Get all visible instances */
  const visibleInstances = instances.filter((i) => i.visible);

  /** Get active (visible) instances of a specific type */
  const byType = useCallback((type: IndicatorKey) =>
    instances.filter((i) => i.type === type && i.visible),
  [instances]);

  /** True when at least one visible instance of type exists */
  const isActive = useCallback((type: IndicatorKey) =>
    instances.some((i) => i.type === type && i.visible),
  [instances]);

  return {
    instances,
    visibleInstances,
    addInstance,
    removeInstance,
    updateInstance,
    toggleVisible,
    removeByType,
    byType,
    isActive,
  };
}

export type UseIndicatorsReturn = ReturnType<typeof useIndicators>;
