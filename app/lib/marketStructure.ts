/**
 * marketStructure.ts — Phase 9
 *
 * Pure calculation functions for Market Structure Analysis.
 * Same pattern as lib/indicators.ts: input OHLCBar[], output structured data.
 * No chart library imports — just math.
 *
 * Three features:
 *   1. Pivot Points (Traditional method) — Standard daily/weekly/monthly S/R
 *   2. Supply & Demand Zones — Volume-profile based zone detection
 *   3. Order Blocks — Swing-based bullish/bearish order block detection
 *
 * Attribution:
 *   Supply & Demand zone logic is inspired by LuxAlgo's
 *   "Supply and Demand Visible Range" indicator.
 *   © LuxAlgo — licensed CC BY-NC-SA 4.0
 *   https://creativecommons.org/licenses/by-nc-sa/4.0/
 *   Original: https://www.tradingview.com/script/tVe3bpuQ/
 *
 *   Order Block logic is inspired by LuxAlgo's
 *   "Order Blocks & Breaker Blocks" indicator.
 *   © LuxAlgo — licensed CC BY-NC-SA 4.0
 *   https://creativecommons.org/licenses/by-nc-sa/4.0/
 *   Original: https://www.tradingview.com/script/p0RuLW6m/
 *
 *   This project is non-commercial (personal portfolio). Attribution is
 *   preserved as required by the CC BY-NC-SA 4.0 license.
 */

import type { OHLCBar } from "./dataService";

// ══════════════════════════════════════════════════════════════════════════
// 1. PIVOT POINTS — Traditional method
// ══════════════════════════════════════════════════════════════════════════

export type PivotAnchor = "D" | "W" | "M";

export interface PivotLevel {
  label: string;                      // "P", "R1", "S1", …
  price: number;
  type: "pivot" | "resistance" | "support";
  color: string;
  /** The time of the period start (for rendering the line's left anchor) */
  periodStart: number | string;
  /** The time of the period end (right anchor — may be open-ended) */
  periodEnd:   number | string;
}

export interface PivotPeriod {
  levels: PivotLevel[];
  /** ISO-like string describing the period, e.g. "2024-W01" */
  label: string;
}

/** Return the "period key" for a bar's time, grouped by anchor. */
function periodKey(bar: OHLCBar, anchor: PivotAnchor): string {
  const d = toDate(bar.time);
  if (anchor === "D") {
    return d.toISOString().slice(0, 10);                    // YYYY-MM-DD
  }
  if (anchor === "W") {
    const day = d.getUTCDay();                              // 0=Sun
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() - ((day + 6) % 7));      // Monday
    return mon.toISOString().slice(0, 10);
  }
  // Monthly
  return d.toISOString().slice(0, 7);                       // YYYY-MM
}

function toDate(t: number | string): Date {
  if (typeof t === "number") return new Date(t * 1000);
  return new Date(t);
}

/**
 * Traditional pivot point formula:
 *   P  = (H + L + C) / 3
 *   R1 = 2P - L        R2 = P + (H - L)        R3 = H + 2(P - L)
 *   S1 = 2P - H        S2 = P - (H - L)        S3 = L - 2(H - P)
 */
function traditionalLevels(
  high: number, low: number, close: number,
  periodStart: number | string, periodEnd: number | string
): PivotLevel[] {
  const P  = (high + low + close) / 3;
  const R1 = 2 * P - low;
  const R2 = P + (high - low);
  const R3 = high + 2 * (P - low);
  const S1 = 2 * P - high;
  const S2 = P - (high - low);
  const S3 = low - 2 * (high - P);

  const PIVOT_COLOR = "#fb8c00";
  const RES_COLOR   = "#ef5350";
  const SUP_COLOR   = "#26a69a";

  return [
    { label: "P",  price: P,  type: "pivot",      color: PIVOT_COLOR, periodStart, periodEnd },
    { label: "R1", price: R1, type: "resistance",  color: RES_COLOR,   periodStart, periodEnd },
    { label: "S1", price: S1, type: "support",     color: SUP_COLOR,   periodStart, periodEnd },
    { label: "R2", price: R2, type: "resistance",  color: RES_COLOR,   periodStart, periodEnd },
    { label: "S2", price: S2, type: "support",     color: SUP_COLOR,   periodStart, periodEnd },
    { label: "R3", price: R3, type: "resistance",  color: RES_COLOR,   periodStart, periodEnd },
    { label: "S3", price: S3, type: "support",     color: SUP_COLOR,   periodStart, periodEnd },
  ];
}

/**
 * Calculate Traditional Pivot Points from OHLC bars.
 *
 * Groups bars by `anchor` period, uses the previous period's H/L/C to
 * compute P, R1-R3, S1-S3 for the current period.
 *
 * Returns the most recent `maxPeriods` pivot sets (default 3).
 */
export function calcPivotPoints(
  bars: OHLCBar[],
  anchor: PivotAnchor = "D",
  maxPeriods = 3
): PivotPeriod[] {
  if (bars.length < 2) return [];

  // Group bars by period
  const periodMap = new Map<string, OHLCBar[]>();
  for (const bar of bars) {
    const key = periodKey(bar, anchor);
    if (!periodMap.has(key)) periodMap.set(key, []);
    periodMap.get(key)!.push(bar);
  }

  const sortedKeys = [...periodMap.keys()].sort();
  if (sortedKeys.length < 2) return [];

  const results: PivotPeriod[] = [];

  // We need at least one previous period to compute pivots
  for (let i = 1; i < sortedKeys.length; i++) {
    const prevBars = periodMap.get(sortedKeys[i - 1])!;
    const currBars = periodMap.get(sortedKeys[i])!;

    const high  = Math.max(...prevBars.map(b => b.high));
    const low   = Math.min(...prevBars.map(b => b.low));
    const close = prevBars[prevBars.length - 1].close;

    const periodStart = currBars[0].time;
    // Period end: next period start or last bar time
    const nextKey = sortedKeys[i + 1];
    const nextBars = nextKey ? periodMap.get(nextKey) : null;
    const periodEnd = nextBars ? nextBars[0].time : currBars[currBars.length - 1].time;

    results.push({
      label: sortedKeys[i],
      levels: traditionalLevels(high, low, close, periodStart, periodEnd),
    });
  }

  // Return only most recent N periods
  return results.slice(-maxPeriods);
}

// ══════════════════════════════════════════════════════════════════════════
// 2. SUPPLY & DEMAND ZONES
// ══════════════════════════════════════════════════════════════════════════
//
// Attribution: Logic inspired by LuxAlgo "Supply and Demand Visible Range"
// © LuxAlgo, CC BY-NC-SA 4.0. Non-commercial portfolio project.
// Original Pine Script uses intrabar volume from request.security_lower_tf.
// This port approximates with bar-level OHLCV using a volume-profile approach:
// each bar's volume is distributed proportionally across the price range it covers.

export interface SupplyDemandZone {
  type: "supply" | "demand";
  top: number;
  bottom: number;
  avgPrice: number;         // volume-weighted average within zone
  startTime: number | string;
  endTime:   number | string;
  /** 0–1 strength (fraction of total volume in this zone) */
  strength: number;
}

/**
 * Find supply and demand zones from OHLC bars using a volume-profile approach.
 *
 * Finds the price cluster with the highest concentrated volume in the upper
 * half (supply) and lower half (demand) of the visible range.
 *
 * @param bars      OHLC data
 * @param bins      Number of price buckets (resolution)
 * @param threshold Minimum % of total volume to qualify (0–100)
 * @param clusterW  Number of adjacent bins to merge into a zone (default 3)
 */
export function calcSupplyDemandZones(
  bars: OHLCBar[],
  bins = 24,
  threshold = 2,
  clusterW = 5
): SupplyDemandZone[] {
  if (bars.length < 5) return [];

  const high = Math.max(...bars.map(b => b.high));
  const low  = Math.min(...bars.map(b => b.low));
  if (high === low) return [];

  const rangeSize = (high - low) / bins;
  const totalVol  = bars.reduce((s, b) => s + b.volume, 0);
  if (totalVol === 0) return [];

  // Build volume profile
  const volBins  = new Float64Array(bins).fill(0);
  const wvolBins = new Float64Array(bins).fill(0);

  for (const bar of bars) {
    const bLow  = Math.min(bar.open, bar.close, bar.low);
    const bHigh = Math.max(bar.open, bar.close, bar.high);
    const first = Math.max(0,        Math.floor((bLow  - low) / rangeSize));
    const last  = Math.min(bins - 1, Math.floor((bHigh - low) / rangeSize));
    const count = last - first + 1;
    const vpb   = bar.volume / Math.max(1, count);
    for (let bi = first; bi <= last; bi++) {
      const mid    = low + (bi + 0.5) * rangeSize;
      volBins[bi]  += vpb;
      wvolBins[bi] += mid * vpb;
    }
  }

  // Search for best cluster in upper third (supply) and lower third (demand)
  // Using thirds gives more realistic zone placement vs strict 50% split
  const upperStart = Math.floor(bins * 0.55);   // top 45% → supply
  const lowerEnd   = Math.floor(bins * 0.45);   // bottom 45% → demand
  const threshVol  = totalVol * (threshold / 100);

  const bestCluster = (fromBin: number, toBin: number) => {
    let bestVol = 0; let bestStart = fromBin;
    const maxStart = Math.max(fromBin, toBin - clusterW + 1);
    for (let bi = fromBin; bi <= maxStart; bi++) {
      let v = 0;
      for (let k = 0; k < clusterW && bi + k < bins; k++) v += volBins[bi + k];
      if (v > bestVol) { bestVol = v; bestStart = bi; }
    }
    return { start: bestStart, vol: bestVol };
  };

  const zones: SupplyDemandZone[] = [];
  const startTime = bars[0].time;
  const endTime   = bars[bars.length - 1].time;

  // Supply zone — upper portion of range
  const supply = bestCluster(upperStart, bins - 1);
  if (supply.vol >= threshVol) {
    const actualW = Math.min(clusterW, bins - supply.start);
    const bottom = low + supply.start * rangeSize;
    const top    = low + (supply.start + actualW) * rangeSize;
    let wsum = 0; let wvol = 0;
    for (let k = 0; k < actualW; k++) {
      wsum += wvolBins[supply.start + k];
      wvol += volBins[supply.start + k];
    }
    const wavg = wvol > 0 ? wsum / wvol : (top + bottom) / 2;
    zones.push({ type: "supply", top, bottom, avgPrice: wavg, startTime, endTime, strength: supply.vol / totalVol });
  }

  // Demand zone — lower portion of range
  const demand = bestCluster(0, lowerEnd - 1);
  if (demand.vol >= threshVol) {
    const actualW = Math.min(clusterW, bins - demand.start);
    const bottom = low + demand.start * rangeSize;
    const top    = low + (demand.start + actualW) * rangeSize;
    let wsum = 0; let wvol = 0;
    for (let k = 0; k < actualW; k++) {
      wsum += wvolBins[demand.start + k];
      wvol += volBins[demand.start + k];
    }
    const wavg = wvol > 0 ? wsum / wvol : (top + bottom) / 2;
    zones.push({ type: "demand", top, bottom, avgPrice: wavg, startTime, endTime, strength: demand.vol / totalVol });
  }

  return zones;
}

// ══════════════════════════════════════════════════════════════════════════
// 3a. ORDER BLOCKS — LuxAlgo style (simple swing-based)
// ══════════════════════════════════════════════════════════════════════════
//
// Attribution: Logic inspired by LuxAlgo "Order Blocks & Breaker Blocks"
// © LuxAlgo — licensed CC BY-NC-SA 4.0 (non-commercial portfolio project)
// https://www.tradingview.com/script/p0RuLW6m/

export interface OrderBlock {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  startTime: number | string;
  isBreaker: boolean;
  breakTime: number | string | null;
  obVolume: number;
  obHighVolume: number;
  obLowVolume: number;
  bbVolume: number;
  combined: boolean;
}

export function calcOrderBlocksLuxAlgo(
  bars: OHLCBar[],
  swingLen = 10,
  showBull = 3,
  showBear = 3,
  useBody = false
): OrderBlock[] {
  if (bars.length < swingLen * 2 + 1) return [];
  const n = bars.length;
  const hi = (i: number) => useBody ? Math.max(bars[i].open, bars[i].close) : bars[i].high;
  const lo = (i: number) => useBody ? Math.min(bars[i].open, bars[i].close) : bars[i].low;

  const swingHigh = new Float64Array(n).fill(NaN);
  const swingLow  = new Float64Array(n).fill(NaN);
  for (let i = swingLen; i < n - swingLen; i++) {
    let isHigh = true; let isLow = true;
    for (let j = i - swingLen; j <= i + swingLen; j++) {
      if (j === i) continue;
      if (hi(j) >= hi(i)) isHigh = false;
      if (lo(j) <= lo(i)) isLow  = false;
    }
    if (isHigh) swingHigh[i] = hi(i);
    if (isLow)  swingLow[i]  = lo(i);
  }

  const bullOBs: OrderBlock[] = [];
  const bearOBs: OrderBlock[] = [];
  let lastHighIdx = -1; let lastLowIdx = -1;

  for (let i = 0; i < n; i++) {
    if (!isNaN(swingHigh[i])) lastHighIdx = i;
    if (!isNaN(swingLow[i]))  lastLowIdx  = i;
    const bar = bars[i];

    if (lastHighIdx >= 0 && i > lastHighIdx && bar.close > swingHigh[lastHighIdx]) {
      const from = Math.max(0, i - swingLen);
      let minLo = Infinity; let obIdx = from;
      for (let j = from; j <= lastHighIdx; j++) { if (lo(j) < minLo) { minLo = lo(j); obIdx = j; } }
      bullOBs.unshift({ type: "bullish", top: hi(obIdx), bottom: lo(obIdx), startTime: bars[obIdx].time,
        isBreaker: false, breakTime: null, obVolume: 0, obHighVolume: 0, obLowVolume: 0, bbVolume: 0, combined: false });
      lastHighIdx = -1;
    }
    if (lastLowIdx >= 0 && i > lastLowIdx && bar.close < swingLow[lastLowIdx]) {
      const from = Math.max(0, i - swingLen);
      let maxHi = -Infinity; let obIdx = from;
      for (let j = from; j <= lastLowIdx; j++) { if (hi(j) > maxHi) { maxHi = hi(j); obIdx = j; } }
      bearOBs.unshift({ type: "bearish", top: hi(obIdx), bottom: lo(obIdx), startTime: bars[obIdx].time,
        isBreaker: false, breakTime: null, obVolume: 0, obHighVolume: 0, obLowVolume: 0, bbVolume: 0, combined: false });
      lastLowIdx = -1;
    }
  }

  const checkBreakers = (obs: OrderBlock[], dir: "bullish" | "bearish"): OrderBlock[] => {
    return obs.reduce<OrderBlock[]>((acc, ob) => {
      const si = bars.findIndex(b => b.time === ob.startTime);
      if (si < 0) return acc;
      let broken = false; let breaker = false; let breakTime: number | string | null = null;
      for (let i = si + 1; i < n; i++) {
        const b = bars[i];
        if (dir === "bullish") {
          if (!breaker && Math.min(b.close, b.open) < ob.bottom) { breaker = true; breakTime = b.time; }
          if (breaker && b.close > ob.top) { broken = true; break; }
        } else {
          if (!breaker && Math.max(b.close, b.open) > ob.top) { breaker = true; breakTime = b.time; }
          if (breaker && b.close < ob.bottom) { broken = true; break; }
        }
      }
      if (!broken) acc.push({ ...ob, isBreaker: breaker, breakTime });
      return acc;
    }, []);
  };

  return [
    ...checkBreakers(bullOBs, "bullish").slice(0, showBull),
    ...checkBreakers(bearOBs, "bearish").slice(0, showBear),
  ];
}

// ══════════════════════════════════════════════════════════════════════════
// 3b. ORDER BLOCKS — Flux Charts "Volumized Order Blocks" style
// ══════════════════════════════════════════════════════════════════════════
//
// Attribution: Logic ported from Flux Charts "Volumized Order Blocks"
// (non-commercial portfolio project). Original Pine Script by Flux Charts.

function calcATR(bars: OHLCBar[], period = 10): number[] {
  const n = bars.length;
  const atr = new Array<number>(n).fill(0);
  if (n < 2) return atr;
  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prev = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
  });
  atr[period - 1] = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}

function mergeOBs(a: OrderBlock, b: OrderBlock): OrderBlock {
  const breakT = (a.breakTime !== null && b.breakTime !== null)
    ? (String(a.breakTime) > String(b.breakTime) ? a.breakTime : b.breakTime)
    : (a.breakTime ?? b.breakTime);
  return {
    type: a.type,
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
    startTime: String(a.startTime) < String(b.startTime) ? a.startTime : b.startTime,
    isBreaker: a.isBreaker || b.isBreaker,
    breakTime: breakT,
    obVolume: a.obVolume + b.obVolume,
    obHighVolume: a.obHighVolume + b.obHighVolume,
    obLowVolume: a.obLowVolume + b.obLowVolume,
    bbVolume: a.bbVolume + b.bbVolume,
    combined: true,
  };
}

function combineOverlapping(obs: OrderBlock[]): OrderBlock[] {
  let changed = true;
  while (changed) {
    changed = false;
    const out: OrderBlock[] = [];
    const used = new Set<number>();
    for (let i = 0; i < obs.length; i++) {
      if (used.has(i)) continue;
      let cur = obs[i];
      for (let j = i + 1; j < obs.length; j++) {
        if (used.has(j)) continue;
        if (cur.top > obs[j].bottom && obs[j].top > cur.bottom) {
          cur = mergeOBs(cur, obs[j]); used.add(j); changed = true;
        }
      }
      out.push(cur);
    }
    obs = out;
  }
  return obs;
}

export function calcOrderBlocksFlux(
  bars: OHLCBar[],
  swingLen = 10,
  showBull = 3,
  showBear = 3,
  maxATRMult = 3.5,
  invalidationMethod: "Wick" | "Close" = "Wick"
): OrderBlock[] {
  const n = bars.length;
  if (n < swingLen * 2 + 2) return [];
  const atr = calcATR(bars, 10);

  const highest = new Float64Array(n);
  const lowest  = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let hi = -Infinity; let lo = Infinity;
    for (let j = Math.max(0, i - swingLen + 1); j <= i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low  < lo) lo = bars[j].low;
    }
    highest[i] = hi; lowest[i] = lo;
  }

  let swingState = 0;
  const topX = { x: -1, y: 0, crossed: false };
  const btmX = { x: -1, y: 0, crossed: false };
  const rawBull: OrderBlock[] = [];
  const rawBear: OrderBlock[] = [];

  for (let i = swingLen; i < n; i++) {
    if (bars[i - swingLen].high > highest[i]) { swingState = 0; topX.x = i - swingLen; topX.y = bars[i - swingLen].high; topX.crossed = false; }
    else if (bars[i - swingLen].low < lowest[i]) { swingState = 1; btmX.x = i - swingLen; btmX.y = bars[i - swingLen].low; btmX.crossed = false; }

    if (!topX.crossed && topX.x >= 0 && bars[i].close > topX.y) {
      topX.crossed = true;
      let minLo = Infinity; let obIdx = Math.max(0, i - swingLen);
      for (let j = Math.max(0, i - swingLen); j <= topX.x; j++) { if (bars[j].low < minLo) { minLo = bars[j].low; obIdx = j; } }
      const obSize = bars[obIdx].high - bars[obIdx].low;
      if (obSize <= (atr[i] || 1) * maxATRMult && obSize > 0) {
        const v0 = bars[Math.max(0, obIdx-1)]?.volume ?? 0;
        const v1 = bars[obIdx].volume;
        const v2 = bars[Math.min(n-1, obIdx+1)]?.volume ?? 0;
        rawBull.unshift({ type:"bullish", top:bars[obIdx].high, bottom:bars[obIdx].low, startTime:bars[obIdx].time,
          isBreaker:false, breakTime:null, obVolume:v0+v1+v2,
          obHighVolume: v2 + v1*(bars[obIdx].close>=bars[obIdx].open?1:0),
          obLowVolume: v0, bbVolume:0, combined:false });
        if (rawBull.length > 30) rawBull.pop();
      }
    }

    if (!btmX.crossed && btmX.x >= 0 && bars[i].close < btmX.y) {
      btmX.crossed = true;
      let maxHi = -Infinity; let obIdx = Math.max(0, i - swingLen);
      for (let j = Math.max(0, i - swingLen); j <= btmX.x; j++) { if (bars[j].high > maxHi) { maxHi = bars[j].high; obIdx = j; } }
      const obSize = bars[obIdx].high - bars[obIdx].low;
      if (obSize <= (atr[i] || 1) * maxATRMult && obSize > 0) {
        const v0 = bars[Math.max(0, obIdx-1)]?.volume ?? 0;
        const v1 = bars[obIdx].volume;
        const v2 = bars[Math.min(n-1, obIdx+1)]?.volume ?? 0;
        rawBear.unshift({ type:"bearish", top:bars[obIdx].high, bottom:bars[obIdx].low, startTime:bars[obIdx].time,
          isBreaker:false, breakTime:null, obVolume:v0+v1+v2,
          obHighVolume: v2, obLowVolume: v0+v1, bbVolume:0, combined:false });
        if (rawBear.length > 30) rawBear.pop();
      }
    }
  }

  const processOBs = (obs: OrderBlock[], dir: "bullish" | "bearish"): OrderBlock[] =>
    obs.reduce<OrderBlock[]>((acc, ob) => {
      const si = bars.findIndex(b => b.time === ob.startTime);
      if (si < 0) return acc;
      let breaker = false; let breakTime: number | string | null = null; let bbVol = 0; let discard = false;
      for (let i = si + 1; i < n; i++) {
        const b = bars[i];
        if (dir === "bullish") {
          const hit = invalidationMethod === "Wick" ? b.low : Math.min(b.open, b.close);
          if (!breaker && hit < ob.bottom) { breaker = true; breakTime = b.time; bbVol = b.volume; }
          if (breaker && b.close > ob.top) { discard = true; break; }
        } else {
          const hit = invalidationMethod === "Wick" ? b.high : Math.max(b.open, b.close);
          if (!breaker && hit > ob.top) { breaker = true; breakTime = b.time; bbVol = b.volume; }
          if (breaker && b.close < ob.bottom) { discard = true; break; }
        }
      }
      if (!discard) acc.push({ ...ob, isBreaker: breaker, breakTime, bbVolume: bbVol });
      return acc;
    }, []);

  const bull = combineOverlapping(processOBs(rawBull, "bullish").slice(0, showBull));
  const bear = combineOverlapping(processOBs(rawBear, "bearish").slice(0, showBear));
  return [...bull, ...bear];
}

// ══════════════════════════════════════════════════════════════════════════
// 4. TRADING SESSIONS
// ══════════════════════════════════════════════════════════════════════════
//
// Ported from TradingView's built-in "Trading Sessions" indicator.
// Draws colored boxes for Tokyo, London, and New York sessions.
// Only meaningful on intraday timeframes (1m–1h).

export interface TradingSession {
  name: string;
  /** Session open time (first bar's time) */
  startTime: number | string;
  /** Session close time (last bar's time) */
  endTime: number | string;
  sessionHigh: number;
  sessionLow: number;
  sessionOpen: number;
  sessionClose: number;
  sessionAvg: number;
  color: string;        // fill color (with alpha)
  borderColor: string;  // opaque version for lines/labels
}

// ── Session definitions ────────────────────────────────────────────────────
// Each session is defined by UTC hour range (start inclusive, end exclusive).
// Times match the Pine Script defaults (Tokyo 00–06 UTC, London 07–16 UTC, NY 13–21 UTC).

export interface SessionDef {
  name: string;
  /** UTC hour start (0–23, inclusive) */
  utcStart: number;
  /** UTC hour end (0–23, exclusive) */
  utcEnd: number;
  color: string;
  borderColor: string;
}

export const DEFAULT_SESSIONS: SessionDef[] = [
  { name: "Tokyo",    utcStart: 0,  utcEnd: 6,  color: "rgba(41,98,255,0.12)",   borderColor: "#2962FF" },
  { name: "London",   utcStart: 7,  utcEnd: 16, color: "rgba(255,152,0,0.12)",   borderColor: "#FF9800" },
  { name: "New York", utcStart: 13, utcEnd: 21, color: "rgba(8,153,129,0.12)",   borderColor: "#089981" },
];

/** Get UTC hour for a bar's timestamp */
function barUTCHour(time: number | string): number {
  const d = typeof time === "number" ? new Date(time * 1000) : new Date(time);
  return d.getUTCHours();
}

/**
 * Calculate Trading Session boxes from intraday OHLC bars.
 *
 * Groups consecutive bars belonging to the same session window into one
 * TradingSession object per session-day occurrence.
 * Returns an empty array when called with daily bars.
 *
 * @param bars      Intraday OHLC bars (time must be unix seconds)
 * @param sessions  Session definitions (defaults to Tokyo/London/New York)
 * @param maxBoxes  Maximum number of session boxes to return (most recent first)
 */
export function calcTradingSessions(
  bars: OHLCBar[],
  sessions: SessionDef[] = DEFAULT_SESSIONS,
  maxBoxes = 20
): TradingSession[] {
  if (bars.length === 0) return [];

  // Guard: if time values are strings (YYYY-MM-DD), this is a daily chart
  if (typeof bars[0].time === "string") return [];

  const results: TradingSession[] = [];

  // For each session definition, scan all bars
  for (const sess of sessions) {
    let current: TradingSession | null = null;
    let sumClose = 0;
    let count    = 0;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const h = barUTCHour(bar.time);

      const inSession = sess.utcStart < sess.utcEnd
        ? h >= sess.utcStart && h < sess.utcEnd
        : h >= sess.utcStart || h < sess.utcEnd;

      if (inSession) {
        if (current === null) {
          sumClose = bar.close;
          count    = 1;
          current = {
            name: sess.name,
            startTime: bar.time,
            endTime: bar.time,
            sessionHigh: bar.high,
            sessionLow: bar.low,
            sessionOpen: bar.open,
            sessionClose: bar.close,
            sessionAvg: bar.close,
            color: sess.color,
            borderColor: sess.borderColor,
          };
        } else {
          sumClose += bar.close;
          count    += 1;
          current.endTime      = bar.time;
          current.sessionHigh  = Math.max(current.sessionHigh, bar.high);
          current.sessionLow   = Math.min(current.sessionLow,  bar.low);
          current.sessionClose = bar.close;
          current.sessionAvg   = sumClose / count;
        }
      } else if (current !== null) {
        results.push(current);
        current  = null;
        sumClose = 0;
        count    = 0;
      }
    }
    if (current !== null) results.push(current);
  }

  results.sort((a, b) => {
    const at = typeof a.startTime === "number" ? a.startTime : new Date(a.startTime).getTime() / 1000;
    const bt = typeof b.startTime === "number" ? b.startTime : new Date(b.startTime).getTime() / 1000;
    return at - bt;
  });

  return results.slice(-maxBoxes);
}
