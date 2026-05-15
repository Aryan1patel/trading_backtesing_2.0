"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ISeriesPrimitiveBase,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  IPriceLine,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
  MouseEventParams,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import type { OHLCBar } from "@/lib/dataService";
import type { IndicatorInstance } from "@/lib/indicatorTypes";
import type { ReplayState } from "@/lib/replayEngine";
import type { Position } from "@/lib/paperTrading";
import {
  calcSMA,
  calcEMA,
  calcBB,
  calcRSI,
  calcMACD,
} from "@/lib/indicators";
import {
  calcPivotPoints,
  calcSupplyDemandZones,
  calcOrderBlocksLuxAlgo,
  calcOrderBlocksFlux,
  calcTradingSessions,
} from "@/lib/marketStructure";
import type { PivotLevel, SupplyDemandZone, OrderBlock, TradingSession } from "@/lib/marketStructure";
import { instanceLabel } from "@/lib/indicatorTypes";

// ── Types ─────────────────────────────────────────────────────────────────

interface HoveredBar {
  time: string;
  open: number; high: number; low: number; close: number;
  volume: number; isUp: boolean;
}

export interface CandlestickChartProps {
  symbol: string;
  timeframeLabel: string;
  bars: OHLCBar[];
  isLoading: boolean;
  /** New: list of indicator instances with per-instance params */
  indicatorInstances: IndicatorInstance[];
  replayState: ReplayState | null;
  onReplayPick: (index: number) => void;
  openPositions?: Position[];
  livePrice?: number | null;
  tpslMode?: "tp" | "sl" | null;
  onChartPriceClick?: (price: number) => void;
  onTPDrag?: (price: number) => void;
  onSLDrag?: (price: number) => void;
  onChartReady?: (chart: IChartApi, series: ISeriesApi<"Candlestick">) => void;
  drawingLayerChildren?: React.ReactNode;
}

// ── RSI background primitive ──────────────────────────────────────────────

class RsiBgRenderer {
  constructor(private _api: SeriesAttachedParameter<Time>) {}
  draw(target: { useBitmapCoordinateSpace: (f: (s: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number; mediaSize: { width: number; height: number } }) => void) => void }): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const w  = mediaSize.width * hr;
      const h  = mediaSize.height * vr;
      const y70 = (this._api.series.priceToCoordinate(70) ?? 0)      * vr;
      const y30 = (this._api.series.priceToCoordinate(30) ?? h)      * vr;
      ctx.save();
      ctx.fillStyle = "rgba(126,87,194,0.08)";
      ctx.fillRect(0, y70, w, y30 - y70);
      const gradOB = ctx.createLinearGradient(0, y70, 0, 0);
      gradOB.addColorStop(0, "rgba(0,180,120,0.35)"); gradOB.addColorStop(1, "rgba(0,180,120,0)");
      ctx.fillStyle = gradOB; ctx.fillRect(0, 0, w, y70);
      const gradOS = ctx.createLinearGradient(0, y30, 0, h);
      gradOS.addColorStop(0, "rgba(220,50,50,0.35)"); gradOS.addColorStop(1, "rgba(220,50,50,0)");
      ctx.fillStyle = gradOS; ctx.fillRect(0, y30, w, h - y30);
      ctx.restore();
    });
  }
}

class RsiBgPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }
  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const renderer = new RsiBgRenderer(this._api);
    return [{ renderer: () => renderer, zOrder: () => "normal" as const }];
  }
}

// ── Market Structure Primitives (Phase 9) ────────────────────────────────

interface _CanvasTarget {
  useBitmapCoordinateSpace<T>(f: (s: {
    context: CanvasRenderingContext2D;
    horizontalPixelRatio: number;
    verticalPixelRatio: number;
    mediaSize: { width: number; height: number };
  }) => T): T;
}

class PivotsPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  public levels: PivotLevel[] = [];
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }
  updateData(levels: PivotLevel[]) { this.levels = levels; this._api?.requestUpdate(); }
  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const self = this; const api = this._api;
    return [{ zOrder: () => "normal" as const, renderer: () => ({
      draw(target: _CanvasTarget) {
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
          const w = mediaSize.width * hr;
          ctx.save(); ctx.font = `bold ${10 * hr}px Inter, sans-serif`;
          for (const lvl of self.levels) {
            const yc = api.series.priceToCoordinate(lvl.price); if (yc === null) continue;
            const y  = yc * vr;
            const x1 = Math.max(0, (api.chart.timeScale().timeToCoordinate(lvl.periodStart as Time) ?? 0) * hr);
            const x2 = Math.min(w, (api.chart.timeScale().timeToCoordinate(lvl.periodEnd as Time) ?? w / hr) * hr);
            ctx.strokeStyle = lvl.color; ctx.lineWidth = hr; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
            ctx.fillStyle = lvl.color;
            ctx.fillText(`${lvl.label} ${lvl.price.toFixed(2)}`, x1 + 3 * hr, y - 3 * hr);
          }
          ctx.restore();
        });
      },
    })}];
  }
}

class SupplyDemandPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  public zones: SupplyDemandZone[] = [];
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }
  updateData(zones: SupplyDemandZone[]) { this.zones = zones; this._api?.requestUpdate(); }
  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const self = this; const api = this._api;
    return [{ zOrder: () => "normal" as const, renderer: () => ({
      draw(target: _CanvasTarget) {
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
          const w = mediaSize.width * hr;
          ctx.save(); ctx.font = `bold ${10 * hr}px Inter, sans-serif`;
          for (const z of self.zones) {
            const ytc = api.series.priceToCoordinate(z.top); const ybc = api.series.priceToCoordinate(z.bottom);
            if (ytc === null || ybc === null) continue;
            const yt = Math.min(ytc, ybc) * vr; const yb = Math.max(ytc, ybc) * vr; const h = yb - yt;
            const isSupply = z.type === "supply";
            const fill = isSupply ? "rgba(33,87,243,0.22)" : "rgba(255,93,0,0.22)";
            const border = isSupply ? "#2157f3" : "#ff5d00";
            ctx.fillStyle = fill; ctx.fillRect(0, yt, w, h);
            ctx.strokeStyle = border; ctx.lineWidth = hr; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(0, yt); ctx.lineTo(w, yt); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, yt + h); ctx.lineTo(w, yt + h); ctx.stroke();
            ctx.fillStyle = border;
            ctx.fillText(`${isSupply ? "Supply" : "Demand"}  ${z.avgPrice.toFixed(2)}`, 6 * hr, yt + 12 * hr);
            const yac = api.series.priceToCoordinate(z.avgPrice);
            if (yac !== null) {
              ctx.strokeStyle = border; ctx.lineWidth = 0.8 * hr; ctx.setLineDash([4 * hr, 3 * hr]);
              ctx.beginPath(); ctx.moveTo(0, yac * vr); ctx.lineTo(w, yac * vr); ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          ctx.restore();
        });
      },
    })}];
  }
}

class OrderBlocksPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  public blocks: OrderBlock[] = [];
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }
  updateData(blocks: OrderBlock[]) { this.blocks = blocks; this._api?.requestUpdate(); }
  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const self = this; const api = this._api;
    return [{ zOrder: () => "normal" as const, renderer: () => ({
      draw(target: _CanvasTarget) {
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
          const w = mediaSize.width * hr;
          ctx.save(); ctx.font = `bold ${9 * hr}px Inter, sans-serif`;
          for (const ob of self.blocks) {
            const ytc = api.series.priceToCoordinate(ob.top); const ybc = api.series.priceToCoordinate(ob.bottom);
            if (ytc === null || ybc === null) continue;
            const yt = Math.min(ytc, ybc) * vr; const yb = Math.max(ytc, ybc) * vr; const h = yb - yt;
            const isBull = ob.type === "bullish";
            const fill   = ob.isBreaker ? (isBull ? "rgba(255,17,0,0.15)"  : "rgba(12,181,26,0.15)") : (isBull ? "rgba(33,87,243,0.15)" : "rgba(255,93,0,0.15)");
            const border = ob.isBreaker ? (isBull ? "#ff1100"              : "#0cb51a")               : (isBull ? "#2157f3"               : "#ff5d00");
            const lbl    = ob.isBreaker ? (isBull ? "Bull Breaker"         : "Bear Breaker")          : (isBull ? "Bull OB"               : "Bear OB");
            const x1raw  = api.chart.timeScale().timeToCoordinate(ob.startTime as Time);
            const x1     = x1raw !== null ? Math.max(0, x1raw * hr) : 0;
            let x2ob = w; let x1br = w;
            if (ob.isBreaker && ob.breakTime !== null) {
              const xbr = api.chart.timeScale().timeToCoordinate(ob.breakTime as Time);
              if (xbr !== null) { x2ob = Math.max(x1, xbr * hr); x1br = x2ob; }
            }
            ctx.fillStyle = fill; ctx.fillRect(x1, yt, x2ob - x1, h);
            ctx.strokeStyle = border; ctx.lineWidth = hr; ctx.setLineDash([]);
            ctx.strokeRect(x1, yt, x2ob - x1, h);
            if (ob.isBreaker && x1br < w) {
              ctx.fillStyle = fill.replace(/[\d.]+\)$/, "0.08)"); ctx.fillRect(x1br, yt, w - x1br, h);
              ctx.setLineDash([4 * hr, 3 * hr]);
              ctx.beginPath(); ctx.moveTo(x1br, yt); ctx.lineTo(w, yt); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(x1br, yt + h); ctx.lineTo(w, yt + h); ctx.stroke();
              ctx.setLineDash([]);
            }
            ctx.fillStyle = border; ctx.fillText(lbl, x1 + 3 * hr, yt + 11 * hr);
          }
          ctx.restore();
        });
      },
    })}];
  }
}

class SessionsPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  public sessions: TradingSession[] = [];
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }
  updateData(sessions: TradingSession[]) { this.sessions = sessions; this._api?.requestUpdate(); }
  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const self = this; const api = this._api;
    return [{ zOrder: () => "normal" as const, renderer: () => ({
      draw(target: _CanvasTarget) {
        target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
          ctx.save(); ctx.font = `bold ${10 * hr}px Inter, sans-serif`;
          for (const s of self.sessions) {
            const x1raw = api.chart.timeScale().timeToCoordinate(s.startTime as Time);
            const x2raw = api.chart.timeScale().timeToCoordinate(s.endTime as Time);
            if (x1raw === null || x2raw === null) continue;
            const x1 = x1raw * hr; const x2 = x2raw * hr;
            const ytop = api.series.priceToCoordinate(s.sessionHigh);
            const ybot = api.series.priceToCoordinate(s.sessionLow);
            if (ytop === null || ybot === null) continue;
            const yt = ytop * vr; const yb = ybot * vr; const h = yb - yt;
            ctx.fillStyle = s.color; ctx.fillRect(x1, yt, x2 - x1, h);
            ctx.strokeStyle = s.borderColor; ctx.lineWidth = 1.5 * hr; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(x1, yt); ctx.lineTo(x1, yb); ctx.stroke();
            ctx.lineWidth = hr;
            ctx.beginPath(); ctx.moveTo(x1, yt); ctx.lineTo(x2, yt); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x1, yb); ctx.lineTo(x2, yb); ctx.stroke();
            const yopen = api.series.priceToCoordinate(s.sessionOpen);
            if (yopen !== null) {
              ctx.setLineDash([4 * hr, 3 * hr]); ctx.lineWidth = hr;
              ctx.beginPath(); ctx.moveTo(x1, yopen * vr); ctx.lineTo(x2, yopen * vr); ctx.stroke();
              ctx.setLineDash([]);
            }
            const yavg = api.series.priceToCoordinate(s.sessionAvg);
            if (yavg !== null) {
              ctx.setLineDash([2 * hr, 3 * hr]); ctx.lineWidth = 1.5 * hr;
              ctx.beginPath(); ctx.moveTo(x1, yavg * vr); ctx.lineTo(x2, yavg * vr); ctx.stroke();
              ctx.setLineDash([]);
            }
            ctx.fillStyle = s.borderColor;
            ctx.fillText(s.name, x1 + 4 * hr, yt + 12 * hr);
            const range = s.sessionHigh - s.sessionLow;
            const rangeText = range.toFixed(2);
            const tw = ctx.measureText(rangeText).width;
            ctx.globalAlpha = 0.7;
            ctx.fillText(rangeText, x2 - tw - 4 * hr, yb - 4 * hr);
            ctx.globalAlpha = 1;
          }
          ctx.restore();
        });
      },
    })}];
  }
}

// ── Chart constants ───────────────────────────────────────────────────────

const CHART_LAYOUT = { background: { color: "#0f1117" }, textColor: "#d1d4dc", fontFamily: "'Inter', sans-serif", fontSize: 11 };
const CHART_GRID   = { vertLines: { color: "#1e2130" }, horzLines: { color: "#1e2130" } };
const PRICE_SCALE  = { borderColor: "#1e2130", textColor: "#758696" };
const TS_BASE      = { borderColor: "#1e2130", timeVisible: true, secondsVisible: false };

// ── Per-instance series bundle ────────────────────────────────────────────

interface OverlayBundle {
  type: "SMA" | "EMA";
  line: ISeriesApi<"Line">;
}
interface BBBundle {
  type: "BB";
  upper: ISeriesApi<"Line">;
  mid:   ISeriesApi<"Line">;
  lower: ISeriesApi<"Line">;
}
interface RSIBundle {
  type: "RSI";
  line: ISeriesApi<"Line">;
}
interface MACDBundle {
  type: "MACD";
  hist:   ISeriesApi<"Histogram">;
  line:   ISeriesApi<"Line">;
  signal: ISeriesApi<"Line">;
}
type InstanceBundle = OverlayBundle | BBBundle | RSIBundle | MACDBundle;

// ── Component ─────────────────────────────────────────────────────────────

export default function CandlestickChart({
  symbol,
  timeframeLabel,
  bars,
  isLoading,
  indicatorInstances,
  replayState,
  onReplayPick,
  openPositions = [],
  livePrice = null,
  tpslMode = null,
  onChartPriceClick,
  onTPDrag,
  onSLDrag,
  onChartReady,
  drawingLayerChildren,
}: CandlestickChartProps) {

  // ── DOM containers ────────────────────────────────────────────────────
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef  = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);

  // ── Chart instances ───────────────────────────────────────────────────
  const chartRef     = useRef<IChartApi | null>(null);
  const rsiChartRef  = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  // ── Permanent series ──────────────────────────────────────────────────
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram">   | null>(null);

  // ── Dynamic per-instance series bundles ──────────────────────────────
  // Map<instanceId, InstanceBundle>  — created/removed as instances are added/removed
  const instanceBundlesRef = useRef<Map<string, InstanceBundle>>(new Map());

  // ── Phase 9: Market Structure primitives ─────────────────────────────
  const pivotsPrimRef    = useRef<PivotsPrimitive      | null>(null);
  const sdPrimRef        = useRef<SupplyDemandPrimitive | null>(null);
  const obPrimRef        = useRef<OrderBlocksPrimitive  | null>(null);
  const obFluxPrimRef    = useRef<OrderBlocksPrimitive  | null>(null);
  const sessionsPrimRef  = useRef<SessionsPrimitive     | null>(null);

  // ── Stable refs ───────────────────────────────────────────────────────
  const barsRef                  = useRef<OHLCBar[]>([]);
  const indicatorInstancesRef    = useRef<IndicatorInstance[]>(indicatorInstances);
  const onReplayPickRef          = useRef(onReplayPick);
  const onChartReadyRef          = useRef(onChartReady);
  const onChartPriceClickRef     = useRef(onChartPriceClick);
  const onTPDragRef              = useRef(onTPDrag);
  const onSLDragRef              = useRef(onSLDrag);
  const tpslModeRef              = useRef(tpslMode);
  const tpslPricesRef            = useRef<{ tp: number | null; sl: number | null }>({ tp: null, sl: null });
  const draggingRef              = useRef<"tp" | "sl" | null>(null);
  const priceLineRefs            = useRef<Record<string, { entry: IPriceLine | null; tp: IPriceLine | null; sl: IPriceLine | null }>>({});

  useEffect(() => { indicatorInstancesRef.current = indicatorInstances; }, [indicatorInstances]);
  useEffect(() => { onReplayPickRef.current       = onReplayPick; },       [onReplayPick]);
  useEffect(() => { onChartReadyRef.current       = onChartReady; },       [onChartReady]);
  useEffect(() => { onChartPriceClickRef.current  = onChartPriceClick; },  [onChartPriceClick]);
  useEffect(() => { onTPDragRef.current           = onTPDrag; },           [onTPDrag]);
  useEffect(() => { onSLDragRef.current           = onSLDrag; },           [onSLDrag]);
  useEffect(() => { tpslModeRef.current           = tpslMode; },           [tpslMode]);

  // ── State ─────────────────────────────────────────────────────────────
  const [hovered,     setHovered]     = useState<HoveredBar | null>(null);
  const [lastBar,     setLastBar]     = useState<HoveredBar | null>(null);
  const [rsiVisible,  setRsiVisible]  = useState(false);
  const [macdVisible, setMacdVisible] = useState(false);
  // Labels for the pane headers (built from active instances)
  const [rsiLabels,   setRsiLabels]   = useState<string[]>([]);
  const [macdLabels,  setMacdLabels]  = useState<string[]>([]);

  // ── Series creation helpers ───────────────────────────────────────────

  function createOverlaySeries(
    type: "SMA" | "EMA",
    color: string,
    title: string,
  ): ISeriesApi<"Line"> {
    const chart = chartRef.current!;
    return chart.addSeries(LineSeries, {
      color, lineWidth: 1, title,
      priceLineVisible: false, lastValueVisible: false, visible: true,
    });
  }

  function createBBSeries(color: string, title: string): BBBundle {
    const chart = chartRef.current!;
    const base = { priceLineVisible: false as const, lastValueVisible: false as const, visible: true };
    return {
      type: "BB" as const,
      upper: chart.addSeries(LineSeries, { ...base, color, lineWidth: 1, title: `${title} Upper` }),
      mid:   chart.addSeries(LineSeries, { ...base, color, lineWidth: 1, lineStyle: 2, title: `${title} Mid` }),
      lower: chart.addSeries(LineSeries, { ...base, color, lineWidth: 1, title: `${title} Lower` }),
    };
  }

  function createRSISeries(color: string, title: string): ISeriesApi<"Line"> {
    const rsiChart = rsiChartRef.current!;
    const series = rsiChart.addSeries(LineSeries, {
      color, lineWidth: 2, title,
      priceLineVisible: false, lastValueVisible: true, visible: true,
    });
    // Band lines — only add once (first RSI instance or always — duplicates are fine as they overlay)
    series.createPriceLine({ price: 70, color: "#787B86", lineWidth: 1, lineStyle: 0, axisLabelVisible: true,  title: "" });
    series.createPriceLine({ price: 50, color: "rgba(120,123,134,0.4)", lineWidth: 1, lineStyle: 0, axisLabelVisible: false, title: "" });
    series.createPriceLine({ price: 30, color: "#787B86", lineWidth: 1, lineStyle: 0, axisLabelVisible: true,  title: "" });
    series.attachPrimitive(new RsiBgPrimitive() as never);
    return series;
  }

  function createMACDBundle(color: string, title: string): MACDBundle {
    const macdChart = macdChartRef.current!;
    return {
      type: "MACD" as const,
      hist:   macdChart.addSeries(HistogramSeries, { priceFormat: { type: "price", precision: 4 }, priceLineVisible: false, lastValueVisible: false, visible: true }),
      line:   macdChart.addSeries(LineSeries, { color, lineWidth: 1, title, priceLineVisible: false, lastValueVisible: false, visible: true }),
      signal: macdChart.addSeries(LineSeries, { color: "#e74c3c", lineWidth: 1, title: "Signal", priceLineVisible: false, lastValueVisible: false, visible: true }),
    };
  }

  // ── Remove a bundle's series from its chart ───────────────────────────
  function removeBundle(bundle: InstanceBundle) {
    try {
      if (bundle.type === "SMA" || bundle.type === "EMA") {
        chartRef.current?.removeSeries(bundle.line);
      } else if (bundle.type === "BB") {
        chartRef.current?.removeSeries(bundle.upper);
        chartRef.current?.removeSeries(bundle.mid);
        chartRef.current?.removeSeries(bundle.lower);
      } else if (bundle.type === "RSI") {
        rsiChartRef.current?.removeSeries(bundle.line);
      } else if (bundle.type === "MACD") {
        macdChartRef.current?.removeSeries(bundle.hist);
        macdChartRef.current?.removeSeries(bundle.line);
        macdChartRef.current?.removeSeries(bundle.signal);
      }
    } catch { /* chart may have already been destroyed */ }
  }

  // ── Populate data for a single instance bundle ────────────────────────
  function populateBundleData(inst: IndicatorInstance, bundle: InstanceBundle, data: OHLCBar[]) {
    if (!data.length) return;

    // Trim to last real bar — this prevents any future drawing
    const trimmed = data;

    if (bundle.type === "SMA") {
      const d = calcSMA(trimmed, inst.params.period ?? 20);
      if (d.length) bundle.line.setData(d as LineData<Time>[]);
    } else if (bundle.type === "EMA") {
      const d = calcEMA(trimmed, inst.params.period ?? 20);
      if (d.length) bundle.line.setData(d as LineData<Time>[]);
    } else if (bundle.type === "BB") {
      const bb = calcBB(trimmed, inst.params.period ?? 20, inst.params.stdDev ?? 2);
      if (bb.length) {
        bundle.upper.setData(bb.map((p) => ({ time: p.time, value: p.upper  })));
        bundle.mid.setData(  bb.map((p) => ({ time: p.time, value: p.middle })));
        bundle.lower.setData(bb.map((p) => ({ time: p.time, value: p.lower  })));
      }
    } else if (bundle.type === "RSI") {
      const d = calcRSI(trimmed, inst.params.period ?? 14);
      if (d.length) bundle.line.setData(d as LineData<Time>[]);
    } else if (bundle.type === "MACD") {
      const d = calcMACD(trimmed, inst.params.fast ?? 12, inst.params.slow ?? 26, inst.params.signal ?? 9);
      if (d.length) {
        bundle.hist.setData(  d.map((p) => ({ time: p.time, value: p.histogram, color: p.histogram >= 0 ? "#26a69a99" : "#ef535099" })));
        bundle.line.setData(  d.map((p) => ({ time: p.time, value: p.macd })));
        bundle.signal.setData(d.map((p) => ({ time: p.time, value: p.signal })));
      }
    }
  }

  // ── Sync all instance series with current bars ────────────────────────
  function populateAllInstances(data: OHLCBar[]) {
    const insts = indicatorInstancesRef.current;
    for (const inst of insts) {
      const bundle = instanceBundlesRef.current.get(inst.id);
      if (!bundle) continue;
      // Show/hide based on visible flag
      setInstanceVisible(bundle, inst.visible);
      if (inst.visible) populateBundleData(inst, bundle, data);
    }

    // Phase-9 (no per-instance params — just type-level on/off)
    const activeTypes = new Set(insts.filter((i) => i.visible).map((i) => i.type));
    if (pivotsPrimRef.current)  {
      if (activeTypes.has("PIVOTS"))       pivotsPrimRef.current.updateData(calcPivotPoints(data, "D", 3).flatMap(p => p.levels));
      else                                  pivotsPrimRef.current.updateData([]);
    }
    if (sdPrimRef.current) {
      if (activeTypes.has("SUPPLY_DEMAND")) sdPrimRef.current.updateData(calcSupplyDemandZones(data));
      else                                  sdPrimRef.current.updateData([]);
    }
    if (obPrimRef.current) {
      if (activeTypes.has("ORDER_BLOCKS"))  obPrimRef.current.updateData(calcOrderBlocksLuxAlgo(data));
      else                                  obPrimRef.current.updateData([]);
    }
    if (obFluxPrimRef.current) {
      if (activeTypes.has("ORDER_BLOCKS_FLUX")) obFluxPrimRef.current.updateData(calcOrderBlocksFlux(data));
      else                                       obFluxPrimRef.current.updateData([]);
    }
    if (sessionsPrimRef.current) {
      if (activeTypes.has("SESSIONS"))      sessionsPrimRef.current.updateData(calcTradingSessions(data));
      else                                  sessionsPrimRef.current.updateData([]);
    }
  }

  function setInstanceVisible(bundle: InstanceBundle, visible: boolean) {
    if (bundle.type === "SMA" || bundle.type === "EMA") {
      bundle.line.applyOptions({ visible });
    } else if (bundle.type === "BB") {
      bundle.upper.applyOptions({ visible }); bundle.mid.applyOptions({ visible }); bundle.lower.applyOptions({ visible });
    } else if (bundle.type === "RSI") {
      bundle.line.applyOptions({ visible });
    } else if (bundle.type === "MACD") {
      bundle.hist.applyOptions({ visible }); bundle.line.applyOptions({ visible }); bundle.signal.applyOptions({ visible });
    }
  }

  // ── Full chart data update (candles + indicators) ─────────────────────
  function setAllChartData(data: OHLCBar[]) {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    if (!cs || !vs) return;
    cs.setData(data.map((d) => ({ time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close })));
    vs.setData(data.map((d) => ({ time: d.time as Time, value: d.volume, color: d.close >= d.open ? "#26a69a33" : "#ef535033" })));
    populateAllInstances(data);
  }

  function barToHovered(b: OHLCBar): HoveredBar {
    return { time: String(b.time), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, isUp: b.close >= b.open };
  }

  // ── Effect 1: Create charts on mount ─────────────────────────────────
  useEffect(() => {
    if (!mainContainerRef.current || !rsiContainerRef.current || !macdContainerRef.current) return;

    const makeChart = (el: HTMLDivElement, showTimeScale: boolean): IChartApi =>
      createChart(el, {
        width: el.clientWidth, height: el.clientHeight,
        layout: CHART_LAYOUT, grid: CHART_GRID,
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#758696", width: 1, style: 1, labelBackgroundColor: "#1e2130" }, horzLine: { color: "#758696", width: 1, style: 1, labelBackgroundColor: "#1e2130" } },
        rightPriceScale: PRICE_SCALE,
        timeScale: { ...TS_BASE, visible: showTimeScale },
        handleScale: { axisPressedMouseMove: { time: true, price: true } },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
      });

    const mainChart = makeChart(mainContainerRef.current, true);
    const rsiChart  = makeChart(rsiContainerRef.current,  false);
    const macdChart = makeChart(macdContainerRef.current, true);
    chartRef.current = mainChart; rsiChartRef.current = rsiChart; macdChartRef.current = macdChart;

    // Candlestick
    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: "#26a69a", downColor: "#ef5350",
      borderUpColor: "#26a69a", borderDownColor: "#ef5350",
      wickUpColor: "#26a69a", wickDownColor: "#ef5350",
      priceLineVisible: true, priceLineColor: "#758696", priceLineWidth: 1,
    });
    candleSeriesRef.current = candleSeries;
    onChartReadyRef.current?.(mainChart, candleSeries);

    // Phase-9 primitives
    const pivotsPrim = new PivotsPrimitive(); const sdPrim = new SupplyDemandPrimitive();
    const obPrim = new OrderBlocksPrimitive(); const obFluxPrim = new OrderBlocksPrimitive();
    const sessPrim = new SessionsPrimitive();
    candleSeries.attachPrimitive(pivotsPrim as never); candleSeries.attachPrimitive(sdPrim as never);
    candleSeries.attachPrimitive(obPrim as never);     candleSeries.attachPrimitive(obFluxPrim as never);
    candleSeries.attachPrimitive(sessPrim as never);
    pivotsPrimRef.current = pivotsPrim; sdPrimRef.current = sdPrim;
    obPrimRef.current = obPrim; obFluxPrimRef.current = obFluxPrim; sessionsPrimRef.current = sessPrim;

    // Volume
    const volSeries = mainChart.addSeries(HistogramSeries, { color: "#26a69a", priceFormat: { type: "volume" }, priceScaleId: "volume" });
    mainChart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    volumeSeriesRef.current = volSeries;

    // RSI + MACD pane scale options
    rsiChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    macdChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.15, bottom: 0.1 } });

    // Time scale sync across all 3 charts
    let syncing = false;
    const allCharts = [mainChart, rsiChart, macdChart];
    allCharts.forEach((src, si) => {
      src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true;
        allCharts.forEach((dst, di) => { if (di !== si) dst.timeScale().setVisibleLogicalRange(range); });
        syncing = false;
      });
    });

    // OHLC tooltip
    mainChart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (!param.time) { setHovered(null); return; }
      const bar = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
      const vol = param.seriesData.get(volSeries) as HistogramData<Time> | undefined;
      if (bar) setHovered({ time: String(param.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: vol?.value ?? 0, isUp: bar.close >= bar.open });
      else setHovered(null);
    });

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (e.target === mainContainerRef.current) mainChart.applyOptions({ width, height });
        else if (e.target === rsiContainerRef.current)  rsiChart.applyOptions({ width, height });
        else if (e.target === macdContainerRef.current) macdChart.applyOptions({ width, height });
      }
    });
    ro.observe(mainContainerRef.current); ro.observe(rsiContainerRef.current); ro.observe(macdContainerRef.current);

    return () => {
      ro.disconnect();
      // Clean up all dynamic series
      instanceBundlesRef.current.forEach((bundle) => removeBundle(bundle));
      instanceBundlesRef.current.clear();
      mainChart.remove(); rsiChart.remove(); macdChart.remove();
      chartRef.current = rsiChartRef.current = macdChartRef.current = null;
      candleSeriesRef.current = volumeSeriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: Sync indicator instances — add/remove/update series ─────
  useEffect(() => {
    if (!chartRef.current) return;

    const bundles = instanceBundlesRef.current;
    const insts   = indicatorInstances;
    const instIds = new Set(insts.map((i) => i.id));

    // Remove bundles for instances that no longer exist
    bundles.forEach((bundle, id) => {
      if (!instIds.has(id)) {
        removeBundle(bundle);
        bundles.delete(id);
      }
    });

    // Add bundles for new instances + update visibility/data for existing ones
    for (const inst of insts) {
      const existing = bundles.get(inst.id);

      if (!existing) {
        // Create new series bundle
        const label = instanceLabel(inst.type, inst.params);
        const color = inst.color ?? "#758696";
        let bundle: InstanceBundle | null = null;

        if (inst.type === "SMA") {
          bundle = { type: "SMA", line: createOverlaySeries("SMA", color, label) };
        } else if (inst.type === "EMA") {
          bundle = { type: "EMA", line: createOverlaySeries("EMA", color, label) };
        } else if (inst.type === "BB") {
          bundle = createBBSeries(color, label);
        } else if (inst.type === "RSI") {
          bundle = { type: "RSI", line: createRSISeries(color, label) };
        } else if (inst.type === "MACD") {
          bundle = createMACDBundle(color, label);
        }

        if (bundle) {
          bundles.set(inst.id, bundle);
          setInstanceVisible(bundle, inst.visible);
          if (inst.visible && barsRef.current.length > 0) {
            populateBundleData(inst, bundle, barsRef.current);
          }
        }
      } else {
        // Update visibility + repopulate data (handles param edits)
        setInstanceVisible(existing, inst.visible);
        if (inst.visible && barsRef.current.length > 0) {
          populateBundleData(inst, existing, barsRef.current);
        }
      }
    }

    // Derive pane visibility from active RSI/MACD instances
    const rsiInsts  = insts.filter((i) => i.type === "RSI"  && i.visible);
    const macdInsts = insts.filter((i) => i.type === "MACD" && i.visible);
    const rsiOn  = rsiInsts.length > 0;
    const macdOn = macdInsts.length > 0;

    setRsiVisible(rsiOn);
    setMacdVisible(macdOn);
    setRsiLabels(rsiInsts.map((i)  => instanceLabel(i.type, i.params)));
    setMacdLabels(macdInsts.map((i) => instanceLabel(i.type, i.params)));

    // Time scale: only one chart shows the axis at a time
    const ch = chartRef.current; const rch = rsiChartRef.current; const mch = macdChartRef.current;
    if (ch && rch && mch) {
      ch.applyOptions(  { timeScale: { ...TS_BASE, visible: !rsiOn && !macdOn } });
      rch.applyOptions( { timeScale: { ...TS_BASE, visible:  rsiOn && !macdOn } });
      mch.applyOptions( { timeScale: { ...TS_BASE, visible:  macdOn } });
    }

    // Repopulate Phase-9 primitives
    if (barsRef.current.length > 0) {
      const activeTypes = new Set(insts.filter((i) => i.visible).map((i) => i.type));
      if (pivotsPrimRef.current)    pivotsPrimRef.current.updateData(   activeTypes.has("PIVOTS")            ? calcPivotPoints(barsRef.current, "D", 3).flatMap(p => p.levels) : []);
      if (sdPrimRef.current)        sdPrimRef.current.updateData(        activeTypes.has("SUPPLY_DEMAND")     ? calcSupplyDemandZones(barsRef.current) : []);
      if (obPrimRef.current)        obPrimRef.current.updateData(        activeTypes.has("ORDER_BLOCKS")      ? calcOrderBlocksLuxAlgo(barsRef.current) : []);
      if (obFluxPrimRef.current)    obFluxPrimRef.current.updateData(    activeTypes.has("ORDER_BLOCKS_FLUX") ? calcOrderBlocksFlux(barsRef.current) : []);
      if (sessionsPrimRef.current)  sessionsPrimRef.current.updateData(  activeTypes.has("SESSIONS")          ? calcTradingSessions(barsRef.current) : []);
    }
  }, [indicatorInstances]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 3: Render new bars ─────────────────────────────────────────
  useEffect(() => {
    const wasEmpty = barsRef.current.length === 0;
    barsRef.current = bars;
    if (bars.length === 0) return;
    if (replayState && replayState.status !== "idle") return;
    setAllChartData(bars);
    if (wasEmpty) chartRef.current?.timeScale().fitContent();
    setLastBar(barToHovered(bars[bars.length - 1]));
  }, [bars]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 4: Paper trading price lines ───────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const openSymbols = new Set(openPositions.map((p) => p.symbol));
    Object.keys(priceLineRefs.current).forEach((sym) => {
      if (!openSymbols.has(sym)) {
        const refs = priceLineRefs.current[sym];
        try { if (refs.entry) series.removePriceLine(refs.entry); } catch { /* ignore */ }
        try { if (refs.tp)    series.removePriceLine(refs.tp);    } catch { /* ignore */ }
        try { if (refs.sl)    series.removePriceLine(refs.sl);    } catch { /* ignore */ }
        delete priceLineRefs.current[sym];
      }
    });
    if (openPositions.length === 0) tpslPricesRef.current = { tp: null, sl: null };
    openPositions.forEach((pos) => {
      if (!priceLineRefs.current[pos.symbol]) priceLineRefs.current[pos.symbol] = { entry: null, tp: null, sl: null };
      const refs = priceLineRefs.current[pos.symbol];
      tpslPricesRef.current = { tp: pos.tp, sl: pos.sl };
      const upnl = livePrice != null ? (livePrice - pos.entryPrice) * pos.qty : 0;
      const entryTitle = `Entry ₹${pos.entryPrice.toFixed(2)}  ${upnl >= 0 ? "+" : ""}₹${Math.abs(upnl).toFixed(0)}`;
      if (refs.entry) refs.entry.applyOptions({ title: entryTitle });
      else refs.entry = series.createPriceLine({ price: pos.entryPrice, color: "rgba(255,255,255,0.55)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: entryTitle });
      if (pos.tp !== null) {
        if (refs.tp) refs.tp.applyOptions({ price: pos.tp, title: `TP ${pos.tp.toFixed(2)}` });
        else refs.tp = series.createPriceLine({ price: pos.tp, color: "#26a69a", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `TP ${pos.tp.toFixed(2)}` });
      } else if (refs.tp) { try { series.removePriceLine(refs.tp); } catch { /* ignore */ } refs.tp = null; }
      if (pos.sl !== null) {
        if (refs.sl) refs.sl.applyOptions({ price: pos.sl, title: `SL ${pos.sl.toFixed(2)}` });
        else refs.sl = series.createPriceLine({ price: pos.sl, color: "#ef5350", lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `SL ${pos.sl.toFixed(2)}` });
      } else if (refs.sl) { try { series.removePriceLine(refs.sl); } catch { /* ignore */ } refs.sl = null; }
    });
  }, [openPositions, livePrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 5: Replay state ────────────────────────────────────────────
  useEffect(() => {
    const allBars = barsRef.current;
    if (allBars.length === 0) return;
    if (!replayState || replayState.status === "idle" || replayState.status === "picking") {
      setAllChartData(allBars);
      chartRef.current?.timeScale().fitContent();
      setLastBar(barToHovered(allBars[allBars.length - 1]));
      return;
    }
    const { currentIndex } = replayState;
    if (currentIndex === 0) return;
    const sliced = allBars.slice(0, currentIndex);
    setAllChartData(sliced);
    setLastBar(barToHovered(sliced[sliced.length - 1]));
  }, [replayState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 6: Replay pick click ───────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !replayState || replayState.status !== "picking") return;
    const handleClick = (param: MouseEventParams<Time>) => {
      if (!param.time) return;
      const idx = barsRef.current.findIndex((b) => String(b.time) === String(param.time));
      if (idx >= 0) onReplayPickRef.current(idx + 1);
    };
    chart.subscribeClick(handleClick);
    return () => chart.unsubscribeClick(handleClick);
  }, [replayState?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 7: TP/SL placement click ──────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || !tpslMode) return;
    const handle = (param: MouseEventParams<Time>) => {
      if (!param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price === null || price <= 0) return;
      onChartPriceClickRef.current?.(Math.round(price * 100) / 100);
    };
    chart.subscribeClick(handle);
    return () => chart.unsubscribeClick(handle);
  }, [tpslMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 8: TP/SL drag ──────────────────────────────────────────────
  useEffect(() => {
    const container = mainContainerRef.current;
    const series    = candleSeriesRef.current;
    if (!container || !series) return;
    const SNAP = 8;
    const priceToY = (p: number) => series.priceToCoordinate(p) ?? null;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || tpslModeRef.current) return;
      const rect = container.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const { tp, sl } = tpslPricesRef.current;
      let closest: "tp" | "sl" | null = null; let closestDist = Infinity;
      if (tp !== null) { const y = priceToY(tp); if (y !== null) { const d = Math.abs(mouseY - y); if (d <= SNAP && d < closestDist) { closest = "tp"; closestDist = d; } } }
      if (sl !== null) { const y = priceToY(sl); if (y !== null) { const d = Math.abs(mouseY - y); if (d <= SNAP && d < closestDist) { closest = "sl"; } } }
      if (closest) { draggingRef.current = closest; e.preventDefault(); e.stopPropagation(); container.style.cursor = "ns-resize"; }
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) {
        const rect = container.getBoundingClientRect(); const mouseY = e.clientY - rect.top;
        const { tp, sl } = tpslPricesRef.current;
        let near = false;
        if (tp !== null) { const y = priceToY(tp); if (y !== null && Math.abs(mouseY - y) <= SNAP) near = true; }
        if (sl !== null) { const y = priceToY(sl); if (y !== null && Math.abs(mouseY - y) <= SNAP) near = true; }
        container.style.cursor = near ? "ns-resize" : "";
        return;
      }
      const rect = container.getBoundingClientRect();
      const price = series.coordinateToPrice(e.clientY - rect.top);
      if (price === null || price <= 0) return;
      const rounded = Math.round(price * 100) / 100;
      if (draggingRef.current === "tp") onTPDragRef.current?.(rounded);
      else onSLDragRef.current?.(rounded);
    };
    const onMouseUp = () => { if (draggingRef.current) { draggingRef.current = null; container.style.cursor = ""; } };
    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.style.cursor = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────
  const displayBar     = hovered ?? lastBar;
  const fmt    = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtVol = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + "M" : n >= 1_000 ? (n / 1_000).toFixed(1) + "K" : String(n);
  const isPicking      = replayState?.status === "picking";
  const isReplayActive = replayState && replayState.status !== "idle";

  return (
    <div className={`chart-wrapper${tpslMode ? " chart-wrapper--tpsl-mode" : ""}`}>
      {tpslMode && (
        <div className={`tpsl-placement-hint tpsl-placement-hint--${tpslMode}`} aria-live="polite">
          <span className="tpsl-ph-icon">{tpslMode === "tp" ? "🎯" : "🛑"}</span>
          Click anywhere on the chart to set your <strong>{tpslMode === "tp" ? "Take Profit" : "Stop Loss"}</strong> price.
          <span className="tpsl-ph-esc">Press Esc to cancel</span>
        </div>
      )}

      {/* OHLC bar */}
      <div className="ohlc-bar">
        <span className="ohlc-symbol">{symbol}</span>
        <span className="ohlc-timeframe">{timeframeLabel}</span>
        {isLoading && <span className="ohlc-loading-dot" aria-label="Loading" />}
        {isReplayActive && <span className="replay-badge" aria-label="Replay mode active">REPLAY</span>}
        {displayBar && (
          <span className="ohlc-values">
            <span className="ohlc-label">O</span><span className={displayBar.isUp ? "val-up" : "val-down"}>{fmt(displayBar.open)}</span>
            <span className="ohlc-label">H</span><span className={displayBar.isUp ? "val-up" : "val-down"}>{fmt(displayBar.high)}</span>
            <span className="ohlc-label">L</span><span className={displayBar.isUp ? "val-up" : "val-down"}>{fmt(displayBar.low)}</span>
            <span className="ohlc-label">C</span><span className={displayBar.isUp ? "val-up" : "val-down"}>{fmt(displayBar.close)}</span>
            {displayBar.volume > 0 && (<><span className="ohlc-label">Vol</span><span className="val-vol">{fmtVol(displayBar.volume)}</span></>)}
          </span>
        )}
      </div>

      {/* Chart panes */}
      <div className="chart-panes">
        <div className={`price-pane${isLoading ? " chart-canvas--loading" : ""}${isPicking ? " price-pane--picking" : ""}`} ref={mainContainerRef}>
          {isPicking && (
            <div className="replay-pick-overlay" aria-live="polite" aria-atomic="true">
              <div className="replay-pick-message">
                <span className="replay-pick-icon" aria-hidden="true">🎯</span>
                Click a candle to set replay start point
              </div>
            </div>
          )}
          {drawingLayerChildren}
        </div>

        {rsiVisible && <div className="pane-divider" aria-hidden="true" />}
        <div ref={rsiContainerRef} className={`indicator-pane${rsiVisible ? " pane-visible" : ""}`} aria-label="RSI pane">
          {rsiVisible && (
            <span className="pane-label" aria-hidden="true">
              {rsiLabels.join(" · ")}
            </span>
          )}
        </div>

        {macdVisible && <div className="pane-divider" aria-hidden="true" />}
        <div ref={macdContainerRef} className={`indicator-pane${macdVisible ? " pane-visible" : ""}`} aria-label="MACD pane">
          {macdVisible && (
            <span className="pane-label" aria-hidden="true">
              {macdLabels.join(" · ")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
