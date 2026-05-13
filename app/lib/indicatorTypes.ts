/**
 * indicatorTypes.ts
 * Shared types and configuration for all technical indicators.
 * Kept separate so lib/indicators.ts (math) and components (UI) both import from here.
 */

// ── Indicator keys ────────────────────────────────────────────────────────

export type IndicatorKey =
  | "SMA" | "EMA" | "BB" | "RSI" | "MACD"
  | "PIVOTS" | "SUPPLY_DEMAND" | "ORDER_BLOCKS" | "ORDER_BLOCKS_FLUX" | "SESSIONS";

export type IndicatorPaneType = "overlay" | "pane";

// ── Static definition per indicator type ──────────────────────────────────

export interface IndicatorDef {
  key: IndicatorKey;
  label: string;
  description: string;
  paneType: IndicatorPaneType;
  /** Base color palette — instances can override */
  colors: string[];
}

export const INDICATOR_DEFS: IndicatorDef[] = [
  { key: "SMA",               label: "SMA",      description: "Simple Moving Average",           paneType: "overlay", colors: ["#f39c12"] },
  { key: "EMA",               label: "EMA",      description: "Exponential Moving Average",      paneType: "overlay", colors: ["#3498db"] },
  { key: "BB",                label: "BB",       description: "Bollinger Bands",                  paneType: "overlay", colors: ["#9b59b6"] },
  { key: "RSI",               label: "RSI",      description: "Relative Strength Index",          paneType: "pane",    colors: ["#7E57C2"] },
  { key: "MACD",              label: "MACD",     description: "MACD",                             paneType: "pane",    colors: ["#3498db", "#e74c3c"] },
  { key: "PIVOTS",            label: "Pivots",   description: "Pivot Points — Daily S/R",         paneType: "overlay", colors: ["#fb8c00"] },
  { key: "SUPPLY_DEMAND",     label: "S&D",      description: "Supply & Demand Zones",            paneType: "overlay", colors: ["#2157f3", "#ff5d00"] },
  { key: "ORDER_BLOCKS",      label: "OB",       description: "Order Blocks (LuxAlgo style)",     paneType: "overlay", colors: ["#2157f3", "#ff5d00"] },
  { key: "ORDER_BLOCKS_FLUX", label: "OB+",      description: "Volumized Order Blocks",           paneType: "overlay", colors: ["#089981", "#f23645"] },
  { key: "SESSIONS",          label: "Sessions", description: "Trading Sessions",                 paneType: "overlay", colors: ["#2962FF", "#FF9800", "#089981"] },
];

// ── Parameter definitions per indicator type ──────────────────────────────

export type ParamType = "number";

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  default: number;
  min: number;
  max: number;
  step: number;
}

export const INDICATOR_PARAM_DEFS: Partial<Record<IndicatorKey, ParamDef[]>> = {
  SMA:  [{ key: "period", label: "Period", type: "number", default: 20,  min: 2,   max: 500, step: 1 }],
  EMA:  [{ key: "period", label: "Period", type: "number", default: 20,  min: 2,   max: 500, step: 1 }],
  BB:   [
    { key: "period", label: "Period",    type: "number", default: 20, min: 2,  max: 500,  step: 1   },
    { key: "stdDev", label: "Std Dev",   type: "number", default: 2,  min: 0.5, max: 10,  step: 0.5 },
  ],
  RSI:  [{ key: "period", label: "Period", type: "number", default: 14,  min: 2,   max: 200, step: 1 }],
  MACD: [
    { key: "fast",   label: "Fast",   type: "number", default: 12, min: 2,  max: 100, step: 1 },
    { key: "slow",   label: "Slow",   type: "number", default: 26, min: 2,  max: 200, step: 1 },
    { key: "signal", label: "Signal", type: "number", default: 9,  min: 2,  max: 100, step: 1 },
  ],
  // Phase-9 indicators have no user-configurable parameters
};

/** Build a default params object for a given indicator type */
export function defaultParams(key: IndicatorKey): Record<string, number> {
  const defs = INDICATOR_PARAM_DEFS[key] ?? [];
  const out: Record<string, number> = {};
  for (const p of defs) out[p.key] = p.default;
  return out;
}

/** Build a human-readable label like "RSI (21)" or "MACD (12/26/9)" */
export function instanceLabel(key: IndicatorKey, params: Record<string, number>): string {
  const base = INDICATOR_DEFS.find((d) => d.key === key)?.label ?? key;
  const defs = INDICATOR_PARAM_DEFS[key];
  if (!defs || defs.length === 0) return base;
  const vals = defs.map((d) => params[d.key] ?? d.default);
  if (vals.length === 1) return `${base} (${vals[0]})`;
  return `${base} (${vals.join("/")})`;
}

// ── Instance type — what gets stored and passed around ────────────────────

export interface IndicatorInstance {
  /** Unique ID — nanoid or crypto.randomUUID() */
  id: string;
  type: IndicatorKey;
  /** User-configurable parameters, keyed by ParamDef.key */
  params: Record<string, number>;
  /** Custom color override — undefined = use INDICATOR_DEFS default */
  color?: string;
  visible: boolean;
}

// ── Palette for auto-assigning colors to new instances ───────────────────

export const INSTANCE_COLORS = [
  "#f39c12", "#3498db", "#e74c3c", "#2ecc71", "#9b59b6",
  "#1abc9c", "#e67e22", "#e91e63", "#00bcd4", "#8bc34a",
];

/** Pick a color for the nth instance of a given type */
export function pickColor(type: IndicatorKey, existingCount: number): string {
  const base = INDICATOR_DEFS.find((d) => d.key === type)?.colors ?? ["#758696"];
  // First instance uses the type's base color; subsequent ones rotate the palette
  if (existingCount === 0) return base[0];
  const idx = existingCount % INSTANCE_COLORS.length;
  return INSTANCE_COLORS[idx];
}
