/**
 * indicators.ts — Phase 3
 *
 * Pure calculation functions for all supported technical indicators.
 * No chart library imports — just math → time-aligned data arrays.
 *
 * Phase 4 (replay): call the same functions with bars.slice(0, replayIndex)
 * to recalculate indicators incrementally at any point in history.
 */

import { SMA, EMA, BollingerBands, RSI, MACD } from "technicalindicators";
import type { Time } from "lightweight-charts";
import type { OHLCBar } from "./dataService";

// ── Default periods ───────────────────────────────────────────────────────

export const SMA_PERIOD = 20;
export const EMA_PERIOD = 20;
export const BB_PERIOD = 20;
export const BB_STD_DEV = 2;
export const RSI_PERIOD = 14;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;

// ── Output types ──────────────────────────────────────────────────────────

export interface LinePoint {
  time: Time;
  value: number;
}

export interface BBPoint {
  time: Time;
  upper: number;
  middle: number;
  lower: number;
}

export interface MACDPoint {
  time: Time;
  macd: number;
  signal: number;
  histogram: number;
}

// ── Helper ────────────────────────────────────────────────────────────────

/**
 * Aligns a shorter output array to the tail of the input bars array.
 * All indicator libraries drop leading bars where there's not enough history.
 */
function alignTail<T>(bars: OHLCBar[], values: T[]): Array<T & { time: Time }> {
  const offset = bars.length - values.length;
  return values.map((v, i) => ({ ...v as object, time: bars[offset + i].time as Time })) as Array<T & { time: Time }>;
}

// ── Calculation functions ─────────────────────────────────────────────────

export function calcSMA(bars: OHLCBar[], period = SMA_PERIOD): LinePoint[] {
  if (bars.length < period) return [];
  const closes = bars.map((b) => b.close);
  const values = SMA.calculate({ period, values: closes });
  const offset = bars.length - values.length;
  return values.map((v, i) => ({ time: bars[offset + i].time as Time, value: v }));
}

export function calcEMA(bars: OHLCBar[], period = EMA_PERIOD): LinePoint[] {
  if (bars.length < period) return [];
  const closes = bars.map((b) => b.close);
  const values = EMA.calculate({ period, values: closes });
  const offset = bars.length - values.length;
  return values.map((v, i) => ({ time: bars[offset + i].time as Time, value: v }));
}

export function calcBB(
  bars: OHLCBar[],
  period = BB_PERIOD,
  stdDev = BB_STD_DEV
): BBPoint[] {
  if (bars.length < period) return [];
  const closes = bars.map((b) => b.close);
  const values = BollingerBands.calculate({ period, stdDev, values: closes });
  const offset = bars.length - values.length;
  return values.map((v, i) => ({
    time: bars[offset + i].time as Time,
    upper: v.upper,
    middle: v.middle,
    lower: v.lower,
  }));
}

export function calcRSI(bars: OHLCBar[], period = RSI_PERIOD): LinePoint[] {
  if (bars.length < period + 1) return [];
  const closes = bars.map((b) => b.close);
  const values = RSI.calculate({ period, values: closes });
  const offset = bars.length - values.length;
  return values.map((v, i) => ({ time: bars[offset + i].time as Time, value: v }));
}

export function calcMACD(
  bars: OHLCBar[],
  fast = MACD_FAST,
  slow = MACD_SLOW,
  signal = MACD_SIGNAL
): MACDPoint[] {
  if (bars.length < slow + signal) return [];
  const closes = bars.map((b) => b.close);

  const raw = MACD.calculate({
    fastPeriod: fast,
    slowPeriod: slow,
    signalPeriod: signal,
    values: closes,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const offset = bars.length - raw.length;

  return raw
    .map((v, i) => ({
      time: bars[offset + i].time as Time,
      macd: v.MACD,
      signal: v.signal,
      histogram: v.histogram,
    }))
    .filter(
      (v): v is MACDPoint =>
        v.macd !== undefined && v.signal !== undefined && v.histogram !== undefined
    );
}
