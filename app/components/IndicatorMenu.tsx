"use client";

import { useEffect, useRef, useState } from "react";
import {
  INDICATOR_DEFS,
  INDICATOR_PARAM_DEFS,
  IndicatorInstance,
  IndicatorKey,
  defaultParams,
  instanceLabel,
  pickColor,
} from "@/lib/indicatorTypes";
import type { UseIndicatorsReturn } from "@/hooks/useIndicators";

interface IndicatorMenuProps {
  hook: UseIndicatorsReturn;
}

// ── Views ─────────────────────────────────────────────────────────────────
type View = "list" | "pick-type" | "configure";

export default function IndicatorMenu({ hook }: IndicatorMenuProps) {
  const { instances, addInstance, removeInstance, updateInstance, toggleVisible } = hook;

  const [open, setOpen]       = useState(false);
  const [view, setView]       = useState<View>("list");
  const [editId, setEditId]   = useState<string | null>(null);  // instance being edited
  const [pickType, setPickType] = useState<IndicatorKey | null>(null); // type being configured
  const [draftParams, setDraftParams] = useState<Record<string, number>>({});

  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef   = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current  && !btnRef.current.contains(e.target as Node)
      ) {
        closePanel();
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  function closePanel() {
    setOpen(false);
    setView("list");
    setEditId(null);
    setPickType(null);
    setDraftParams({});
  }

  // ── Start adding a new indicator ──────────────────────────────────────
  function startAdd(key: IndicatorKey) {
    const paramDefs = INDICATOR_PARAM_DEFS[key];
    if (!paramDefs || paramDefs.length === 0) {
      // No params needed — add immediately
      addInstance(key);
      setView("list");
      return;
    }
    setPickType(key);
    setEditId(null);
    setDraftParams(defaultParams(key));
    setView("configure");
  }

  // ── Start editing an existing instance ────────────────────────────────
  function startEdit(inst: IndicatorInstance) {
    setPickType(inst.type);
    setEditId(inst.id);
    setDraftParams({ ...inst.params });
    setView("configure");
  }

  // ── Confirm add or edit ───────────────────────────────────────────────
  function confirmConfigure() {
    if (!pickType) return;
    if (editId) {
      updateInstance(editId, { params: draftParams });
    } else {
      addInstance(pickType, draftParams);
    }
    setView("list");
    setEditId(null);
    setPickType(null);
    setDraftParams({});
  }

  const activeCount = instances.filter((i) => i.visible).length;
  const configuring = view === "configure" && pickType;
  const paramDefs   = pickType ? (INDICATOR_PARAM_DEFS[pickType] ?? []) : [];

  return (
    <div className="ind-wrapper">
      {/* ── Trigger button ──────────────────────────────────────────── */}
      <button
        ref={btnRef}
        className={`indicator-menu-btn${open ? " open" : ""}${activeCount > 0 ? " has-active" : ""}`}
        onClick={() => { setOpen((v) => !v); if (!open) setView("list"); }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Indicators"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M1 10 L4 5 L7 8 L10 3 L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="4" cy="5" r="1" fill="currentColor"/>
          <circle cx="10" cy="3" r="1" fill="currentColor"/>
        </svg>
        Indicators
        {activeCount > 0 && (
          <span className="indicator-count-badge" aria-label={`${activeCount} active`}>
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} className="ind-panel" role="dialog" aria-label="Indicator panel">

          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="ind-panel-header">
            {view !== "list" && (
              <button className="ind-back-btn" onClick={() => setView(view === "configure" ? "pick-type" : "list")} aria-label="Back">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M7 1 L3 5 L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            <span className="ind-panel-title">
              {view === "list"      && "Indicators"}
              {view === "pick-type" && "Add Indicator"}
              {view === "configure" && (editId ? `Edit ${INDICATOR_DEFS.find(d=>d.key===pickType)?.label}` : `Add ${INDICATOR_DEFS.find(d=>d.key===pickType)?.label}`)}
            </span>
            {view === "list" && (
              <button
                className="ind-add-btn"
                onClick={() => setView("pick-type")}
                aria-label="Add indicator"
                title="Add indicator"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M5.5 1 L5.5 10 M1 5.5 L10 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                Add
              </button>
            )}
          </div>

          {/* ── VIEW: Instance list ──────────────────────────────────── */}
          {view === "list" && (
            <div className="ind-list">
              {instances.length === 0 && (
                <div className="ind-empty">
                  No indicators added yet.<br/>Click <strong>Add</strong> to get started.
                </div>
              )}
              {instances.map((inst) => {
                const def   = INDICATOR_DEFS.find((d) => d.key === inst.type)!;
                const color = inst.color ?? def.colors[0];
                const label = instanceLabel(inst.type, inst.params);
                return (
                  <div key={inst.id} className={`ind-row${inst.visible ? "" : " ind-row--off"}`}>
                    {/* Color swatch + visibility toggle */}
                    <button
                      className="ind-swatch"
                      style={{ background: color }}
                      title={inst.visible ? "Click to hide" : "Click to show"}
                      onClick={() => toggleVisible(inst.id)}
                      aria-label={inst.visible ? `Hide ${label}` : `Show ${label}`}
                    />
                    {/* Label */}
                    <span className="ind-row-label">{label}</span>
                    {/* Edit button (only for parameterised indicators) */}
                    {(INDICATOR_PARAM_DEFS[inst.type]?.length ?? 0) > 0 && (
                      <button
                        className="ind-row-action"
                        onClick={() => startEdit(inst)}
                        title="Edit parameters"
                        aria-label={`Edit ${label}`}
                      >
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                          <path d="M7.5 1.5 L9.5 3.5 L3.5 9.5 L1 10 L1.5 7.5 Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}
                    {/* Remove button */}
                    <button
                      className="ind-row-action ind-row-action--remove"
                      onClick={() => removeInstance(inst.id)}
                      title="Remove"
                      aria-label={`Remove ${label}`}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── VIEW: Pick type ──────────────────────────────────────── */}
          {view === "pick-type" && (
            <div className="ind-list">
              {INDICATOR_DEFS.map((def) => (
                <button
                  key={def.key}
                  className="ind-type-row"
                  onClick={() => startAdd(def.key)}
                >
                  <span className="ind-swatch ind-swatch--static" style={{ background: def.colors[0] }} aria-hidden="true" />
                  <span className="ind-type-info">
                    <span className="ind-row-label">{def.label}</span>
                    <span className="ind-type-desc">{def.description}</span>
                  </span>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true" className="ind-type-chevron">
                    <path d="M2 1 L6 4 L2 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </button>
              ))}
            </div>
          )}

          {/* ── VIEW: Configure params ───────────────────────────────── */}
          {configuring && (
            <div className="ind-configure">
              {paramDefs.length === 0 ? (
                <p className="ind-no-params">No configurable parameters.</p>
              ) : (
                paramDefs.map((pd) => (
                  <div key={pd.key} className="ind-param-row">
                    <label className="ind-param-label" htmlFor={`ind-param-${pd.key}`}>
                      {pd.label}
                    </label>
                    <input
                      id={`ind-param-${pd.key}`}
                      type="number"
                      className="ind-param-input"
                      value={draftParams[pd.key] ?? pd.default}
                      min={pd.min}
                      max={pd.max}
                      step={pd.step}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) setDraftParams((prev) => ({ ...prev, [pd.key]: v }));
                      }}
                    />
                  </div>
                ))
              )}
              <div className="ind-configure-actions">
                <button className="ind-btn ind-btn--ghost" onClick={() => setView("pick-type")}>
                  Cancel
                </button>
                <button className="ind-btn ind-btn--primary" onClick={confirmConfigure}>
                  {editId ? "Apply" : "Add"}
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
