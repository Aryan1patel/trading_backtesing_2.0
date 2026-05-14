/**
 * drawingTools.ts — Phase 8
 *
 * Lightweight-charts v5 ISeriesPrimitive implementations for all five
 * drawing tools: Trendline, HorizontalRay, Rectangle, Fibonacci, Text.
 *
 * Key v5 API facts:
 *  - draw(target: CanvasTarget2D) — use target.useBitmapCoordinateSpace()
 *    to obtain the CanvasRenderingContext2D and canvas pixel size.
 *  - hitTest(x, y) returns PrimitiveHoveredItem | null (not boolean).
 *  - paneViews() returns IPrimitivePaneView[] (not ISeriesPrimitivePaneView[]).
 *  - zOrder() lives on IPrimitivePaneView, not on the renderer.
 *
 * Persistence: per symbol+timeframe in localStorage.
 * Drawings reset when symbol changes — they are symbol-specific.
 */

import type {
  ISeriesApi,
  IChartApi,
  ISeriesPrimitiveBase,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  Time,
  SeriesAttachedParameter,
} from "lightweight-charts";

// CanvasRenderingTarget2D comes from 'fancy-canvas' which is a transitive dep
// of lightweight-charts — it may not be installed standalone, so we type it
// structurally rather than importing it.
interface CanvasTarget2D {
  useBitmapCoordinateSpace<T>(
    f: (scope: {
      context: CanvasRenderingContext2D;
      horizontalPixelRatio: number;
      verticalPixelRatio: number;
      mediaSize: { width: number; height: number };
    }) => T
  ): T;
}

// ── Tool key ──────────────────────────────────────────────────────────────

export type DrawingToolKey =
  | "select"
  | "trendline"
  | "hray"
  | "rectangle"
  | "fibonacci"
  | "text";

// ── Serialisable drawing data ─────────────────────────────────────────────

export interface TrendlineData {
  type: "trendline";
  id: string;
  p1: { time: number | string; price: number };
  p2: { time: number | string; price: number };
  color: string;
}

export interface HRayData {
  type: "hray";
  id: string;
  price: number;
  time: number | string;
  color: string;
}

export interface RectangleData {
  type: "rectangle";
  id: string;
  p1: { time: number | string; price: number };
  p2: { time: number | string; price: number };
  color: string;
  borderColor: string;
}

export interface FibData {
  type: "fibonacci";
  id: string;
  p1: { time: number | string; price: number };
  p2: { time: number | string; price: number };
  color: string;
}

export interface TextData {
  type: "text";
  id: string;
  anchor: { time: number | string; price: number };
  text: string;
  color: string;
}

export type DrawingObject =
  | TrendlineData
  | HRayData
  | RectangleData
  | FibData
  | TextData;

// ── Fibonacci levels ──────────────────────────────────────────────────────

export const FIB_LEVELS: { ratio: number; label: string; color: string }[] = [
  { ratio: 0,     label: "0",     color: "#787b86" },
  { ratio: 0.236, label: "0.236", color: "#f77c80" },
  { ratio: 0.382, label: "0.382", color: "#ffcd3c" },
  { ratio: 0.5,   label: "0.5",   color: "#67d5b5" },
  { ratio: 0.618, label: "0.618", color: "#22ab94" },
  { ratio: 0.786, label: "0.786", color: "#3d9be9" },
  { ratio: 1,     label: "1",     color: "#787b86" },
];

// ── Handle geometry ───────────────────────────────────────────────────────

export interface Handle {
  x: number;
  y: number;
  role:
    | "p1" | "p2"
    | "top-left" | "top-right" | "bot-left" | "bot-right"
    | "top-mid"  | "bot-mid"   | "left-mid"  | "right-mid";
}

const H_R = 5;   // handle radius (bitmap px)

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  fill: string,
  ratio: number          // devicePixelRatio — to stroke at 1 CSS px
) {
  ctx.beginPath();
  ctx.arc(x, y, H_R * ratio, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 * ratio;
  ctx.stroke();
}

// ── Coordinate helpers ────────────────────────────────────────────────────

function timeToX(api: SeriesAttachedParameter<Time>, t: number | string): number | null {
  const x = api.chart.timeScale().timeToCoordinate(t as Time);
  return x ?? null;
}

function priceToY(api: SeriesAttachedParameter<Time>, price: number): number | null {
  const y = api.series.priceToCoordinate(price);
  return y ?? null;
}

// ── Hover item factory ────────────────────────────────────────────────────

function hovered(id: string): PrimitiveHoveredItem {
  return { cursorStyle: "pointer", externalId: id, zOrder: "top" };
}

// ══════════════════════════════════════════════════════════════════════════
// Trendline
// ══════════════════════════════════════════════════════════════════════════

class TrendlineRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _d: TrendlineData,
    private _api: SeriesAttachedParameter<Time>,
    private _selected: boolean,
  ) {}

  draw(target: CanvasTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const ratio = hr;  // assume square pixels
      const x1c = timeToX(this._api, this._d.p1.time);
      const y1c = priceToY(this._api, this._d.p1.price);
      const x2c = timeToX(this._api, this._d.p2.time);
      const y2c = priceToY(this._api, this._d.p2.price);
      if (x1c === null || y1c === null || x2c === null || y2c === null) return;

      const x1 = x1c * hr; const y1 = y1c * vr;
      const x2 = x2c * hr; const y2 = y2c * vr;

      ctx.save();
      ctx.strokeStyle = this._d.color;
      ctx.lineWidth = (this._selected ? 2.5 : 1.5) * ratio;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (this._selected) {
        drawHandle(ctx, x1, y1, this._d.color, ratio);
        drawHandle(ctx, x2, y2, this._d.color, ratio);
      }
      ctx.restore();
    });
  }
}

export class TrendlinePrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  constructor(public data: TrendlineData, public selected = false) {}
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }

  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const renderer = new TrendlineRenderer(this.data, this._api, this.selected);
    return [{ renderer: () => renderer, zOrder: () => "top" as const }];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._api) return null;
    const x1 = timeToX(this._api, this.data.p1.time);
    const y1 = priceToY(this._api, this.data.p1.price);
    const x2 = timeToX(this._api, this.data.p2.time);
    const y2 = priceToY(this._api, this.data.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return distPointToSegment(x, y, x1, y1, x2, y2) < 8 ? hovered(this.data.id) : null;
  }

  getHandles(): Handle[] {
    if (!this._api) return [];
    const x1 = timeToX(this._api, this.data.p1.time);
    const y1 = priceToY(this._api, this.data.p1.price);
    const x2 = timeToX(this._api, this.data.p2.time);
    const y2 = priceToY(this._api, this.data.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return [];
    return [{ x: x1, y: y1, role: "p1" }, { x: x2, y: y2, role: "p2" }];
  }

  isHit(px: number, py: number): boolean {
    return this.hitTest(px, py) !== null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Horizontal Ray
// ══════════════════════════════════════════════════════════════════════════

class HRayRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _d: HRayData,
    private _api: SeriesAttachedParameter<Time>,
    private _selected: boolean,
  ) {}

  draw(target: CanvasTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const ratio = hr;
      const yc = priceToY(this._api, this._d.price);
      if (yc === null) return;
      const x0c = timeToX(this._api, this._d.time) ?? 0;
      const x0 = x0c * hr;
      const y  = yc * vr;
      const w  = mediaSize.width * hr;

      ctx.save();
      ctx.strokeStyle = this._d.color;
      ctx.lineWidth = (this._selected ? 2.5 : 1.5) * ratio;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = this._d.color;
      ctx.font = `${11 * ratio}px Inter, sans-serif`;
      ctx.fillText(this._d.price.toFixed(2), x0 + 6 * ratio, y - 4 * ratio);

      if (this._selected) drawHandle(ctx, x0, y, this._d.color, ratio);
      ctx.restore();
    });
  }
}

export class HRayPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  constructor(public data: HRayData, public selected = false) {}
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }

  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const renderer = new HRayRenderer(this.data, this._api, this.selected);
    return [{ renderer: () => renderer, zOrder: () => "top" as const }];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._api) return null;
    const yc = priceToY(this._api, this.data.price);
    if (yc === null) return null;
    return Math.abs(y - yc) < 8 ? hovered(this.data.id) : null;
  }

  getHandles(): Handle[] {
    if (!this._api) return [];
    const x0 = timeToX(this._api, this.data.time) ?? 0;
    const y   = priceToY(this._api, this.data.price);
    if (y === null) return [];
    return [{ x: x0, y, role: "p1" }];
  }

  isHit(px: number, py: number): boolean { return this.hitTest(px, py) !== null; }
}

// ══════════════════════════════════════════════════════════════════════════
// Rectangle / Zone
// ══════════════════════════════════════════════════════════════════════════

class RectangleRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _d: RectangleData,
    private _api: SeriesAttachedParameter<Time>,
    private _selected: boolean,
  ) {}

  draw(target: CanvasTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const ratio = hr;
      const x1c = timeToX(this._api, this._d.p1.time);
      const y1c = priceToY(this._api, this._d.p1.price);
      const x2c = timeToX(this._api, this._d.p2.time);
      const y2c = priceToY(this._api, this._d.p2.price);
      if (y1c === null || y2c === null) return;

      // If a time coordinate falls outside the visible range (e.g. drawn into
      // empty space right of the last candle), clamp to canvas edges so the
      // rectangle still renders fully.
      const W  = mediaSize.width  * hr;
      const H  = mediaSize.height * vr;
      const x1 = (x1c !== null ? x1c : 0)   * hr;
      const x2 = (x2c !== null ? x2c : W / hr) * hr;
      const y1 = y1c * vr;
      const y2 = y2c * vr;

      const rx = Math.min(x1, x2); const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1); const rh = Math.abs(y2 - y1);
      const mx = rx + rw / 2; const my = ry + rh / 2;
      void H; // H available if needed for future clamping

      ctx.save();
      ctx.fillStyle = this._d.color;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = this._d.borderColor;
      ctx.lineWidth = (this._selected ? 2 : 1) * ratio;
      ctx.setLineDash([]);
      ctx.strokeRect(rx, ry, rw, rh);

      if (this._selected) {
        [
          [rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh],
          [mx, ry], [mx, ry + rh], [rx, my], [rx + rw, my],
        ].forEach(([hx, hy]) => drawHandle(ctx, hx, hy, this._d.borderColor, ratio));
      }
      ctx.restore();
    });
  }
}

export class RectanglePrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  constructor(public data: RectangleData, public selected = false) {}
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }

  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const renderer = new RectangleRenderer(this.data, this._api, this.selected);
    return [{ renderer: () => renderer, zOrder: () => "top" as const }];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._api) return null;
    const x1 = timeToX(this._api, this.data.p1.time);
    const y1 = priceToY(this._api, this.data.p1.price);
    const x2 = timeToX(this._api, this.data.p2.time);
    const y2 = priceToY(this._api, this.data.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    const rx = Math.min(x1, x2); const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1); const rh = Math.abs(y2 - y1);
    const hit = x >= rx - 6 && x <= rx + rw + 6 && y >= ry - 6 && y <= ry + rh + 6;
    return hit ? hovered(this.data.id) : null;
  }

  getHandles(): Handle[] {
    if (!this._api) return [];
    const x1c = timeToX(this._api, this.data.p1.time);
    const y1c = priceToY(this._api, this.data.p1.price);
    const x2c = timeToX(this._api, this.data.p2.time);
    const y2c = priceToY(this._api, this.data.p2.price);
    if (x1c === null || y1c === null || x2c === null || y2c === null) return [];
    const rx = Math.min(x1c, x2c); const ry = Math.min(y1c, y2c);
    const rw = Math.abs(x2c - x1c); const rh = Math.abs(y2c - y1c);
    const mx = rx + rw / 2; const my = ry + rh / 2;
    return [
      { x: rx,      y: ry,      role: "top-left"  },
      { x: rx + rw, y: ry,      role: "top-right" },
      { x: rx,      y: ry + rh, role: "bot-left"  },
      { x: rx + rw, y: ry + rh, role: "bot-right" },
      { x: mx,      y: ry,      role: "top-mid"   },
      { x: mx,      y: ry + rh, role: "bot-mid"   },
      { x: rx,      y: my,      role: "left-mid"  },
      { x: rx + rw, y: my,      role: "right-mid" },
    ];
  }

  isHit(px: number, py: number): boolean { return this.hitTest(px, py) !== null; }
}

// ══════════════════════════════════════════════════════════════════════════
// Fibonacci Retracement
// ══════════════════════════════════════════════════════════════════════════

class FibRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _d: FibData,
    private _api: SeriesAttachedParameter<Time>,
    private _selected: boolean,
  ) {}

  draw(target: CanvasTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const ratio = hr;
      const x1c = timeToX(this._api, this._d.p1.time);
      const x2c = timeToX(this._api, this._d.p2.time);
      if (x1c === null || x2c === null) return;

      // Lines span only between the two clicked time points
      const left  = Math.min(x1c, x2c) * hr;
      const right = Math.max(x1c, x2c) * hr;

      // p1 = user's first click (could be high or low), p2 = second click
      // Standard fib: 0 at p2, 1 at p1
      const priceHigh = this._d.p1.price;
      const priceLow  = this._d.p2.price;
      const range = priceHigh - priceLow;

      ctx.save();

      // ── Step 1: compute Y for every level ─────────────────────────────
      const levels: { label: string; color: string; price: number; y: number }[] = [];
      for (const { ratio: r, label, color } of FIB_LEVELS) {
        const price = priceLow + range * (1 - r); // 0=low, 1=high
        const yc = priceToY(this._api, price);
        if (yc === null) continue;
        levels.push({ label, color, price, y: yc * vr });
      }

      if (levels.length < 2) { ctx.restore(); return; }

      // ── Step 2: fill bands between adjacent levels ────────────────────
      for (let i = 0; i < levels.length - 1; i++) {
        const top    = Math.min(levels[i].y, levels[i + 1].y);
        const bottom = Math.max(levels[i].y, levels[i + 1].y);
        const h = bottom - top;
        if (h <= 0) continue;

        // Parse the level color to get a semi-transparent fill
        ctx.fillStyle = hexToRgba(levels[i].color, 0.12);
        ctx.fillRect(left, top, right - left, h);
      }

      // ── Step 3: draw dashed lines + labels ────────────────────────────
      ctx.font = `bold ${11 * ratio}px Inter, sans-serif`;

      for (const { label, color, price, y } of levels) {
        // Dashed line full width
        ctx.strokeStyle = color;
        ctx.lineWidth   = (this._selected ? 2 : 1.5) * ratio;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();

        // Label on the left: "ratio  price"
        const text = `${label}  ${price.toFixed(2)}`;
        const tw   = ctx.measureText(text).width;
        const pad  = 5 * ratio;
        const lh   = 14 * ratio;

        // Subtle dark background behind label
        ctx.fillStyle = "rgba(10,12,18,0.65)";
        ctx.fillRect(pad - 2 * ratio, y - lh * 0.75, tw + 4 * ratio, lh);

        ctx.fillStyle = color;
        ctx.fillText(text, pad, y - 2 * ratio);
      }

      // ── Step 4: selection handles at p1 and p2 ────────────────────────
      if (this._selected) {
        const y1c = priceToY(this._api, priceHigh);
        const y2c = priceToY(this._api, priceLow);
        const xAnchor = x2c * hr;  // right anchor at second click time
        if (y1c !== null) drawHandle(ctx, xAnchor, y1c * vr, levels[0]?.color ?? "#fff", ratio);
        if (y2c !== null) drawHandle(ctx, xAnchor, y2c * vr, levels[levels.length - 1]?.color ?? "#fff", ratio);
      }

      ctx.restore();
    });
  }
}

export class FibPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  constructor(public data: FibData, public selected = false) {}
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }

  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const renderer = new FibRenderer(this.data, this._api, this.selected);
    return [{ renderer: () => renderer, zOrder: () => "top" as const }];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._api) return null;
    const high = this.data.p1.price; const low = this.data.p2.price;
    const range = high - low;
    for (const { ratio: r } of FIB_LEVELS) {
      const price = low + range * (1 - r);
      const yc = priceToY(this._api, price);
      if (yc !== null && Math.abs(y - yc) < 8) return hovered(this.data.id);
    }
    return null;
  }

  getHandles(): Handle[] {
    if (!this._api) return [];
    const x1 = timeToX(this._api, this.data.p1.time);
    const y1 = priceToY(this._api, this.data.p1.price);
    const x2 = timeToX(this._api, this.data.p2.time);
    const y2 = priceToY(this._api, this.data.p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return [];
    return [{ x: x1, y: y1, role: "p1" }, { x: x2, y: y2, role: "p2" }];
  }

  isHit(px: number, py: number): boolean { return this.hitTest(px, py) !== null; }
}

// ══════════════════════════════════════════════════════════════════════════
// Text Label
// ══════════════════════════════════════════════════════════════════════════

class TextRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _d: TextData,
    private _api: SeriesAttachedParameter<Time>,
    private _selected: boolean,
  ) {}

  draw(target: CanvasTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const ratio = hr;
      const xc = timeToX(this._api, this._d.anchor.time);
      const yc = priceToY(this._api, this._d.anchor.price);
      if (xc === null || yc === null) return;
      const x = xc * hr; const y = yc * vr;

      ctx.save();
      const fs = 12 * ratio;
      ctx.font = `bold ${fs}px Inter, sans-serif`;
      const w = ctx.measureText(this._d.text).width;
      const pad = 4 * ratio; const h = 18 * ratio;

      ctx.fillStyle = "rgba(15,17,23,0.82)";
      ctx.beginPath();
      ctx.roundRect(x - pad, y - h + 4 * ratio, w + pad * 2, h, 3 * ratio);
      ctx.fill();

      if (this._selected) {
        ctx.strokeStyle = this._d.color;
        ctx.lineWidth = ratio;
        ctx.stroke();
      }

      ctx.fillStyle = this._d.color;
      ctx.fillText(this._d.text, x, y);
      ctx.restore();
    });
  }
}

export class TextPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  constructor(public data: TextData, public selected = false) {}
  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }

  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const renderer = new TextRenderer(this.data, this._api, this.selected);
    return [{ renderer: () => renderer, zOrder: () => "top" as const }];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (!this._api) return null;
    const xc = timeToX(this._api, this.data.anchor.time);
    const yc = priceToY(this._api, this.data.anchor.price);
    if (xc === null || yc === null) return null;
    return (Math.abs(x - xc) < 60 && Math.abs(y - yc) < 14) ? hovered(this.data.id) : null;
  }

  getHandles(): Handle[] { return []; }
  isHit(px: number, py: number): boolean { return this.hitTest(px, py) !== null; }
}

// ══════════════════════════════════════════════════════════════════════════
// Factory
// ══════════════════════════════════════════════════════════════════════════

export type AnyPrimitive =
  | TrendlinePrimitive
  | HRayPrimitive
  | RectanglePrimitive
  | FibPrimitive
  | TextPrimitive;

export function makePrimitive(d: DrawingObject): AnyPrimitive {
  switch (d.type) {
    case "trendline":  return new TrendlinePrimitive(d);
    case "hray":       return new HRayPrimitive(d);
    case "rectangle":  return new RectanglePrimitive(d);
    case "fibonacci":  return new FibPrimitive(d);
    case "text":       return new TextPrimitive(d);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Persistence
// ══════════════════════════════════════════════════════════════════════════

function lsKey(symbol: string, timeframe: string) {
  return `chartlens_drawings_v1_${symbol}_${timeframe}`;
}

export function loadDrawings(symbol: string, timeframe: string): DrawingObject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(lsKey(symbol, timeframe));
    return raw ? (JSON.parse(raw) as DrawingObject[]) : [];
  } catch { return []; }
}

export function saveDrawings(symbol: string, timeframe: string, drawings: DrawingObject[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(lsKey(symbol, timeframe), JSON.stringify(drawings)); } catch { /* quota */ }
}

// ══════════════════════════════════════════════════════════════════════════
// Geometry helpers
// ══════════════════════════════════════════════════════════════════════════

export function distPointToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1; const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function genId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** Safe time extractor: drops BusinessDay objects, keeps unix seconds and YYYY-MM-DD strings */
export function safeTime(t: unknown): number | string | null {
  if (typeof t === "number" || typeof t === "string") return t;
  return null;
}

// ── Colour helper ─────────────────────────────────────────────────────────
// Converts "#rrggbb" or "rgb(...)" colour strings to rgba() with given alpha.
function hexToRgba(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // already rgb/rgba — just wrap at given alpha
  if (color.startsWith("rgb")) return color.replace(/[\d.]+\)$/, `${alpha})`);
  return color;
}

// ══════════════════════════════════════════════════════════════════════════
// Ghost / Preview Primitive// Renders a dashed preview from p1 → current cursor while the user is
// placing the second point of a two-point tool.
// ══════════════════════════════════════════════════════════════════════════

interface GhostData {
  tool: "trendline" | "rectangle" | "fibonacci";
  p1: { time: number | string; price: number };
  p2: { time: number | string; price: number }; // cursor position, updated live
}

class GhostRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _d: GhostData,
    private _api: SeriesAttachedParameter<Time>,
  ) {}

  draw(target: CanvasTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, mediaSize }) => {
      const ratio = hr;
      const x1c = timeToX(this._api, this._d.p1.time);
      const y1c = priceToY(this._api, this._d.p1.price);
      const x2c = timeToX(this._api, this._d.p2.time);
      const y2c = priceToY(this._api, this._d.p2.price);
      if (y1c === null || y2c === null) return;

      const W  = mediaSize.width * hr;
      // Clamp x coords to canvas edges when time falls outside the data range
      const x1 = (x1c !== null ? x1c : 0)       * hr;
      const x2 = (x2c !== null ? x2c : W / hr)   * hr;
      const y1 = y1c * vr;
      const y2 = y2c * vr;

      ctx.save();
      ctx.setLineDash([5 * ratio, 4 * ratio]);
      ctx.lineWidth = 1.5 * ratio;
      ctx.globalAlpha = 0.7;

      if (this._d.tool === "trendline") {
        ctx.strokeStyle = "#2962ff";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // p1 dot
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x1, y1, 4 * ratio, 0, Math.PI * 2);
        ctx.fillStyle = "#2962ff";
        ctx.fill();
      } else if (this._d.tool === "rectangle") {
        ctx.strokeStyle = "#2962ff";
        ctx.fillStyle = "rgba(41,98,255,0.08)";
        const rx = Math.min(x1, x2); const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1); const rh = Math.abs(y2 - y1);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      } else if (this._d.tool === "fibonacci") {
        const high = Math.max(this._d.p1.price, this._d.p2.price);
        const low  = Math.min(this._d.p1.price, this._d.p2.price);
        const range = high - low;
        const right = Math.max(x1, x2);
        const left  = Math.min(x1, x2);        ctx.font = `bold ${10 * ratio}px Inter, sans-serif`;

        // Compute Y positions
        const levels: { label: string; color: string; price: number; y: number }[] = [];
        for (const { ratio: r, label, color } of FIB_LEVELS) {
          const price = low + range * (1 - r);
          const yc = priceToY(this._api, price);
          if (yc !== null) levels.push({ label, color, price, y: yc * vr });
        }

        // Fill bands
        for (let i = 0; i < levels.length - 1; i++) {
          const top    = Math.min(levels[i].y, levels[i + 1].y);
          const bottom = Math.max(levels[i].y, levels[i + 1].y);
          ctx.fillStyle = hexToRgba(levels[i].color, 0.08);
          ctx.fillRect(left, top, right - left, bottom - top);
        }

        // Lines + labels
        for (const { label, color, price, y } of levels) {
          ctx.strokeStyle = color;
          ctx.lineWidth = ratio;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillText(`${label}  ${price.toFixed(2)}`, 5 * ratio, y - 2 * ratio);
        }
      }

      ctx.restore();
    });
  }
}

export class GhostPrimitive implements ISeriesPrimitiveBase {
  private _api: SeriesAttachedParameter<Time> | null = null;
  public data: GhostData;

  constructor(
    tool: "trendline" | "rectangle" | "fibonacci",
    p1: { time: number | string; price: number },
    p2: { time: number | string; price: number },
  ) {
    this.data = { tool, p1, p2 };
  }

  attached(api: SeriesAttachedParameter<Time>) { this._api = api; }
  detached() { this._api = null; }

  /** Update cursor position and force a repaint */
  updateCursor(p2: { time: number | string; price: number }) {
    this.data.p2 = p2;
    this._api?.requestUpdate();   // ← tells chart to repaint this primitive
  }

  paneViews(): IPrimitivePaneView[] {
    if (!this._api) return [];
    const renderer = new GhostRenderer(this.data, this._api);
    return [{ renderer: () => renderer, zOrder: () => "top" as const }];
  }

  hitTest(): PrimitiveHoveredItem | null { return null; }
}
