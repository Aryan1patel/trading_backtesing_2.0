"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import {
  DrawingToolKey, DrawingObject, AnyPrimitive, GhostPrimitive,
  makePrimitive, loadDrawings, saveDrawings, genId, Handle,
  TrendlineData, HRayData, RectangleData, FibData, TextData,
} from "@/lib/drawingTools";

// ── Types ─────────────────────────────────────────────────────────────────

interface DrawingLayerProps {
  symbol: string;
  timeframe: string;
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  locked?: boolean;
}

interface ManagedDrawing { data: DrawingObject; primitive: AnyPrimitive; }

// ── Constants ─────────────────────────────────────────────────────────────

const TOOL_COLORS: Record<DrawingToolKey, string> = {
  select: "#ffffff", trendline: "#2962ff", hray: "#ff9800",
  rectangle: "rgba(41,98,255,0.15)", fibonacci: "#43aa8b", text: "#d1d4dc",
};
const RECT_BORDER = "#2962ff";

const TOOLS: { key: DrawingToolKey; title: string; icon: React.ReactNode }[] = [
  { key: "select", title: "Select / Move",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2 L2 10 L5 7.5 L7 12 L8.5 11.3 L6.5 6.5 L10 6.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/></svg> },
  { key: "trendline", title: "Trendline",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="2" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="2" r="1.5" fill="currentColor"/></svg> },
  { key: "hray", title: "Horizontal Ray",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2"/><circle cx="2" cy="7" r="1.5" fill="currentColor"/></svg> },
  { key: "rectangle", title: "Rectangle / Zone",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="10" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" fill="rgba(41,98,255,0.2)"/></svg> },
  { key: "fibonacci", title: "Fibonacci Retracement",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="3" x2="12" y2="3" stroke="#ef5350" strokeWidth="1"/><line x1="2" y1="5.5" x2="12" y2="5.5" stroke="#ff9800" strokeWidth="1"/><line x1="2" y1="7" x2="12" y2="7" stroke="#90be6d" strokeWidth="1.3"/><line x1="2" y1="8.5" x2="12" y2="8.5" stroke="#43aa8b" strokeWidth="1"/><line x1="2" y1="11" x2="12" y2="11" stroke="#577590" strokeWidth="1"/></svg> },
  { key: "text", title: "Text Label",
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><text x="2" y="11" fontSize="11" fontWeight="bold" fill="currentColor" fontFamily="Inter,sans-serif">T</text></svg> },
];

// ═════════════════════════════════════════════════════════════════════════
// Component
// ═════════════════════════════════════════════════════════════════════════

export default function DrawingLayer({ symbol, timeframe, chart, series, locked = false }: DrawingLayerProps) {

  const [activeTool, setActiveTool] = useState<DrawingToolKey>("select");
  const [drawings, setDrawings]     = useState<ManagedDrawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [textInput, setTextInput]   = useState<{ x: number; y: number; price: number; time: number | string } | null>(null);
  const [textValue, setTextValue]   = useState("");

  const pendingRef = useRef<{ p1: { time: number | string; price: number } } | null>(null);
  const ghostRef   = useRef<GhostPrimitive | null>(null);
  const dragRef    = useRef<{
    drawingId: string; handle: Handle | null;
    startX: number; startY: number; origData: DrawingObject;
  } | null>(null);

  // ── clearGhost — declared first so effects below can reference it ─────
  const clearGhost = useCallback(() => {
    if (ghostRef.current && series) {
      try { series.detachPrimitive(ghostRef.current as never); } catch { /* ignore */ }
      ghostRef.current = null;
    }
  }, [series]);

  // ── addDrawing / removeDrawing / updateDrawing / selectDrawing ─────────
  const addDrawing = useCallback((obj: DrawingObject) => {
    if (!series) return;
    const prim = makePrimitive(obj);
    series.attachPrimitive(prim as never);
    setDrawings(prev => [...prev, { data: obj, primitive: prim }]);
  }, [series]);

  const removeDrawing = useCallback((id: string) => {
    if (!series) return;
    setDrawings(prev => {
      const found = prev.find(d => d.data.id === id);
      if (found) { try { series.detachPrimitive(found.primitive as never); } catch { /* ignore */ } }
      return prev.filter(d => d.data.id !== id);
    });
    setSelectedId(null);
  }, [series]);

  const updateDrawing = useCallback((id: string, newData: DrawingObject) => {
    setDrawings(prev => prev.map(d => {
      if (d.data.id !== id) return d;
      (d.primitive as { data: DrawingObject }).data = newData;
      return { data: newData, primitive: d.primitive };
    }));
  }, []);

  const selectDrawing = useCallback((id: string | null) => {
    setSelectedId(prev => {
      setDrawings(ds => ds.map(d => {
        if (d.data.id === prev || d.data.id === id) {
          (d.primitive as { selected: boolean }).selected = d.data.id === id;
        }
        return d;
      }));
      return id;
    });
  }, []);

  // ── Load drawings on symbol/timeframe change ──────────────────────────
  useEffect(() => {
    if (!series) return;
    drawings.forEach(d => { try { series.detachPrimitive(d.primitive as never); } catch { /* ignore */ } });
    clearGhost();
    pendingRef.current = null;
    const loaded = loadDrawings(symbol, timeframe);
    const managed = loaded.map(obj => {
      const prim = makePrimitive(obj);
      series.attachPrimitive(prim as never);
      return { data: obj, primitive: prim };
    });
    setDrawings(managed);
    setSelectedId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, series]);

  // ── Persist on change ─────────────────────────────────────────────────
  useEffect(() => {
    saveDrawings(symbol, timeframe, drawings.map(d => d.data));
  }, [drawings, symbol, timeframe]);

  // ── Lock resets tool ──────────────────────────────────────────────────
  useEffect(() => {
    if (locked) { setActiveTool("select"); pendingRef.current = null; clearGhost(); }
  }, [locked, clearGhost]);

  // ── Keyboard: Esc / Delete ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pendingRef.current = null;
        clearGhost();
        setTextInput(null);
        setSelectedId(null);
        setActiveTool("select");
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !textInput) {
        removeDrawing(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, textInput, clearGhost, removeDrawing]);

  // ── Coordinate helpers ────────────────────────────────────────────────
  const pixelToPrice = useCallback((y: number) => {
    if (!series) return null;
    return series.coordinateToPrice(y) ?? null;
  }, [series]);

  const pixelToTime = useCallback((x: number): number | string | null => {
    if (!chart) return null;
    const t = chart.timeScale().coordinateToTime(x);

    // Happy path — cursor is over an existing candle
    if (t !== null && t !== undefined) {
      if (typeof t === "object") {
        const b = t as { year: number; month: number; day: number };
        return `${b.year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
      }
      return t as number | string;
    }

    // Cursor is in empty space right of the last candle.
    // Extrapolate: find the pixel position of the last known bar, compute
    // the per-pixel time rate from the two rightmost bars, then project forward.
    try {
      const ts = chart.timeScale();
      // Get visible range to find rightmost logical index
      const logRange = ts.getVisibleLogicalRange();
      if (!logRange) return null;

      // Walk backward from rightmost visible position to find two consecutive
      // timestamps we can use to compute bar width in seconds-per-pixel.
      // We use coordinateToTime at known pixel offsets to estimate the rate.
      const rightEdgePx = x; // the pixel we want
      // Sample two points on the visible range to get px/time ratio
      const sampleX1 = Math.max(0, x - 200);
      const sampleX2 = Math.max(0, x - 100);
      const t1 = chart.timeScale().coordinateToTime(sampleX1);
      const t2 = chart.timeScale().coordinateToTime(sampleX2);
      if (t1 === null || t2 === null) return null;

      const ts1 = typeof t1 === "number" ? t1 : new Date(t1 as string).getTime() / 1000;
      const ts2 = typeof t2 === "number" ? t2 : new Date(t2 as string).getTime() / 1000;
      if (ts1 === ts2) return null;

      const secondsPerPixel = (ts2 - ts1) / (sampleX2 - sampleX1);
      // Find rightmost sample point (t2 at sampleX2) and extrapolate to rightEdgePx
      const extrapolated = Math.round(ts2 + secondsPerPixel * (rightEdgePx - sampleX2));
      return extrapolated;
    } catch {
      return null;
    }
  }, [chart]);

  // ── Hit testing ───────────────────────────────────────────────────────
  const hitTestAt = useCallback((px: number, py: number): ManagedDrawing | null => {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      if ((d.primitive as { isHit: (x: number, y: number) => boolean }).isHit(px, py)) return d;
    }
    return null;
  }, [drawings]);

  const handleAtPoint = useCallback((drawing: ManagedDrawing, px: number, py: number): Handle | null => {
    const handles = (drawing.primitive as { getHandles: () => Handle[] }).getHandles();
    for (const h of handles) { if (Math.hypot(px - h.x, py - h.y) <= 8) return h; }
    return null;
  }, []);

  // ── Selection via chart subscribeClick ────────────────────────────────
  useEffect(() => {
    if (!chart || activeTool !== "select" || locked) return;
    const handler = (param: import("lightweight-charts").MouseEventParams<Time>) => {
      if (!param.point) return;
      const hit = hitTestAt(param.point.x, param.point.y);
      if (hit) selectDrawing(hit.data.id); else selectDrawing(null);
    };
    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [chart, activeTool, locked, hitTestAt, selectDrawing]);

  // ── Drag via chart container mousedown ────────────────────────────────
  useEffect(() => {
    if (!chart || !series || locked) return;
    const container = chart.chartElement();
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || activeTool !== "select" || !selectedId) return;
      const hit = drawings.find(d => d.data.id === selectedId);
      if (!hit) return;
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (!(hit.primitive as { isHit: (x: number, y: number) => boolean }).isHit(px, py)) return;
      const handle = handleAtPoint(hit, px, py);
      dragRef.current = { drawingId: selectedId, handle, startX: px, startY: py, origData: JSON.parse(JSON.stringify(hit.data)) };
      setIsDragging(true);
      // Freeze chart pan/zoom while dragging a drawing
      chart.applyOptions({ handleScroll: false, handleScale: false });
      e.preventDefault(); e.stopPropagation();
    };
    container.addEventListener("mousedown", onDown);
    return () => container.removeEventListener("mousedown", onDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, series, locked, activeTool, selectedId, drawings]);

  // ── Global drag move + mouseup ────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !chart || !series) return;
      const container = chart.chartElement();
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { drawingId, handle, startX, startY, origData } = dragRef.current;
      const newData = JSON.parse(JSON.stringify(origData)) as DrawingObject;
      if (handle) {
        const price = series.coordinateToPrice(py) ?? null;
        const rawT  = chart.timeScale().coordinateToTime(px);
        const time: number | string | null = rawT === null || rawT === undefined ? null
          : typeof rawT === "object"
            ? (() => { const b = rawT as {year:number;month:number;day:number}; return `${b.year}-${String(b.month).padStart(2,"0")}-${String(b.day).padStart(2,"0")}`; })()
            : rawT as number | string;
        if (price !== null && time !== null) applyHandleMove(newData, handle, time, price);
      } else {
        applyBodyMove(newData, px - startX, py - startY, chart, series);
      }
      updateDrawing(drawingId, newData);
    };
    const onUp = () => {
      if (dragRef.current) {
        // Restore chart pan/zoom after drag ends
        chart?.applyOptions({ handleScroll: true, handleScale: true });
      }
      dragRef.current = null;
      setIsDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Safety: restore chart interaction if unmounted mid-drag
      if (dragRef.current) chart?.applyOptions({ handleScroll: true, handleScale: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, series, updateDrawing]);

  // ── Overlay: mousedown (place drawing point) ──────────────────────────
  const handleOverlayMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!chart || !series || locked || activeTool === "select") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const price = pixelToPrice(e.clientY - rect.top);
    const time  = pixelToTime(e.clientX - rect.left);
    if (price === null || time === null) return;

    if (activeTool === "hray") {
      addDrawing({ type: "hray", id: genId(), price, time, color: TOOL_COLORS.hray });
      setActiveTool("select");
      return;
    }
    if (activeTool === "text") {
      setTextInput({ x: e.clientX - rect.left, y: e.clientY - rect.top, price, time });
      setTextValue("");
      return;
    }

    // Two-point tools
    if (!pendingRef.current) {
      pendingRef.current = { p1: { time, price } };
      // Attach ghost for live preview
      if (activeTool === "trendline" || activeTool === "rectangle" || activeTool === "fibonacci") {
        clearGhost();
        const ghost = new GhostPrimitive(activeTool, { time, price }, { time, price });
        series.attachPrimitive(ghost as never);
        ghostRef.current = ghost;
      }
      return;
    }

    const p1 = pendingRef.current.p1;
    const p2 = { time, price };
    pendingRef.current = null;
    clearGhost();

    if (activeTool === "trendline") {
      addDrawing({ type: "trendline", id: genId(), p1, p2, color: TOOL_COLORS.trendline } as TrendlineData);
    } else if (activeTool === "rectangle") {
      addDrawing({ type: "rectangle", id: genId(), p1, p2, color: TOOL_COLORS.rectangle, borderColor: RECT_BORDER } as RectangleData);
    } else if (activeTool === "fibonacci") {
      addDrawing({ type: "fibonacci", id: genId(), p1, p2, color: TOOL_COLORS.fibonacci } as FibData);
    }
    setActiveTool("select");
  }, [chart, series, locked, activeTool, pixelToPrice, pixelToTime, addDrawing, clearGhost]);

  // ── Overlay: mousemove (update ghost preview) ─────────────────────────
  const handleOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!ghostRef.current || !pendingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const price = pixelToPrice(e.clientY - rect.top);
    const time  = pixelToTime(e.clientX - rect.left);
    if (price !== null && time !== null) ghostRef.current.updateCursor({ time, price });
  }, [pixelToPrice, pixelToTime]);

  // ── Text submit ───────────────────────────────────────────────────────
  const submitText = useCallback(() => {
    if (!textInput || !textValue.trim()) { setTextInput(null); return; }
    addDrawing({ type: "text", id: genId(), anchor: { time: textInput.time, price: textInput.price }, text: textValue.trim(), color: TOOL_COLORS.text } as TextData);
    setTextInput(null); setTextValue(""); setActiveTool("select");
  }, [textInput, textValue, addDrawing]);

  const overlayActive = !locked && activeTool !== "select";

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toolbar */}
      <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map(t => (
          <button
            key={t.key}
            className={`dt-btn${activeTool === t.key ? " active" : ""}${locked ? " dt-btn--disabled" : ""}`}
            onClick={() => { if (locked) return; setActiveTool(t.key); pendingRef.current = null; clearGhost(); }}
            title={t.title} aria-label={t.title} aria-pressed={activeTool === t.key} disabled={locked}
          >{t.icon}</button>
        ))}
        <div className="dt-separator" aria-hidden="true" />
        <button className="dt-btn dt-btn--delete" onClick={() => selectedId && removeDrawing(selectedId)}
          disabled={!selectedId} title="Delete selected (Delete key)" aria-label="Delete selected drawing">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 3.5 H11 M4.5 3.5 V2 H8.5 V3.5 M4 3.5 L4.5 11 H8.5 L9 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button className="dt-btn dt-btn--delete"
          onClick={() => { drawings.forEach(d => { try { series?.detachPrimitive(d.primitive as never); } catch { /* ignore */ } }); setDrawings([]); setSelectedId(null); }}
          disabled={drawings.length === 0} title="Clear all drawings" aria-label="Clear all drawings">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 2 L11 11 M11 2 L2 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Click/mousemove capture overlay — only active when a tool is selected */}
      <div
        className="drawing-overlay"
        style={{ pointerEvents: overlayActive ? "auto" : "none", cursor: overlayActive ? "crosshair" : "default" }}
        onMouseDown={handleOverlayMouseDown}
        onMouseMove={handleOverlayMouseMove}
        aria-hidden="true"
      />

      {/* First-point hint */}
      {pendingRef.current && (
        <div className="dt-pending-hint" aria-live="polite">
          Click second point to complete
        </div>
      )}

      {/* Text input */}
      {textInput && (
        <div className="dt-text-input-wrap" style={{ left: textInput.x, top: textInput.y - 32 }}>
          <input autoFocus className="dt-text-input" value={textValue}
            onChange={e => setTextValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitText(); } if (e.key === "Escape") { setTextInput(null); setActiveTool("select"); } }}
            onBlur={submitText} placeholder="Type label…" maxLength={80}
          />
        </div>
      )}
    </>
  );
}

// ── Pure helpers ──────────────────────────────────────────────────────────

function applyHandleMove(d: DrawingObject, handle: Handle, time: number | string, price: number): void {
  if (d.type === "trendline" || d.type === "fibonacci") {
    if (handle.role === "p1") d.p1 = { time, price };
    else if (handle.role === "p2") d.p2 = { time, price };
  } else if (d.type === "hray") {
    d.price = price; d.time = time;
  } else if (d.type === "rectangle") {
    const { p1, p2 } = d;
    switch (handle.role) {
      case "top-left":  d.p1 = { time, price }; break;
      case "bot-right": d.p2 = { time, price }; break;
      case "top-right": d.p1 = { time: p1.time, price }; d.p2 = { time, price: p2.price }; break;
      case "bot-left":  d.p1 = { time, price: p1.price }; d.p2 = { time: p2.time, price }; break;
      case "top-mid":   d.p1 = { time: p1.time, price }; break;
      case "bot-mid":   d.p2 = { time: p2.time, price }; break;
      case "left-mid":  d.p1 = { time, price: p1.price }; break;
      case "right-mid": d.p2 = { time, price: p2.price }; break;
    }
  }
}

function applyBodyMove(d: DrawingObject, dx: number, dy: number, chart: IChartApi, series: ISeriesApi<"Candlestick">): void {
  function sp(price: number): number {
    const y0 = series.priceToCoordinate(price);
    if (y0 === null) return price;
    return series.coordinateToPrice((y0 as number) + dy) ?? price;
  }
  function st(t: number | string): number | string {
    const x0 = chart.timeScale().timeToCoordinate(t as Time);
    if (x0 === null) return t;
    const nt = chart.timeScale().coordinateToTime((x0 as number) + dx);
    if (nt === null || nt === undefined) return t;
    if (typeof nt === "object") { const b = nt as {year:number;month:number;day:number}; return `${b.year}-${String(b.month).padStart(2,"0")}-${String(b.day).padStart(2,"0")}`; }
    return nt as number | string;
  }
  if (d.type === "trendline" || d.type === "fibonacci") {
    d.p1 = { time: st(d.p1.time), price: sp(d.p1.price) };
    d.p2 = { time: st(d.p2.time), price: sp(d.p2.price) };
  } else if (d.type === "hray") {
    d.price = sp(d.price); d.time = st(d.time);
  } else if (d.type === "rectangle") {
    d.p1 = { time: st(d.p1.time), price: sp(d.p1.price) };
    d.p2 = { time: st(d.p2.time), price: sp(d.p2.price) };
  } else if (d.type === "text") {
    d.anchor = { time: st(d.anchor.time), price: sp(d.anchor.price) };
  }
}
