/**
 * paperTrading.ts — Phase 7
 *
 * Pure data layer for paper trading. No React, no chart imports.
 *
 * Currency model (Option A):
 *   - NSE symbols  → INR balance (₹1,00,000 starting)
 *   - US symbols   → USD balance ($10,000 starting)
 *   Each trade deducts from / credits back to the correct currency bucket.
 *   getCurrency(symbol) is the single source of truth for classification.
 *
 * Price sources (the only two — do not add others):
 *   Live mode:   bars[bars.length - 1].close   (from ChartLoader's barsRef)
 *   Replay mode: engine.getCurrentBar().close   (from ReplayEngine)
 */

// ── Currency classification ────────────────────────────────────────────────

export type Currency = "INR" | "USD";

/**
 * Known NSE symbols that trade in INR.
 * Populated at startup via setNseSymbols() — fetched from the backend's
 * /api/symbols endpoint (the single source of truth).
 * Falls back to a small seed list if setNseSymbols() hasn't been called yet.
 */
let _nseSymbols = new Set([
  "RELIANCE", "TCS", "INFY", "WIPRO", "HDFCBANK",
  "ICICIBANK", "SBIN", "TATAMOTORS", "BHARTIARTL", "ITC",
]);

/**
 * Replace the NSE symbol set with the authoritative list from the backend.
 * Call once at app startup (in usePaperTrading hook).
 */
export function setNseSymbols(symbols: string[]): void {
  _nseSymbols = new Set(symbols.map((s) => s.toUpperCase()));
}

export function getCurrency(symbol: string): Currency {
  return _nseSymbols.has(symbol.toUpperCase()) ? "INR" : "USD";
}

export function currencySymbol(c: Currency): string {
  return c === "INR" ? "₹" : "$";
}

// ── Constants ─────────────────────────────────────────────────────────────

export const STARTING_BALANCE_INR = 100_000;  // ₹1,00,000
export const STARTING_BALANCE_USD = 10_000;   // $10,000
export const LS_KEY = "chartlens_paper_trading_v1";

// ── Types ─────────────────────────────────────────────────────────────────

export interface CashBalance {
  INR: number;
  USD: number;
}

export interface Position {
  symbol: string;
  qty: number;
  entryPrice: number;
  entryTime: string;
  mode: "live" | "replay";
  /** LONG = profit when price rises. SHORT = profit when price falls. */
  direction: "long" | "short";
  /** Currency this position is denominated in — set from getCurrency(symbol) at open time. */
  currency: Currency;
  tp: number | null;
  sl: number | null;
}

export interface Trade {
  id: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  realizedPnL: number;
  mode: "live" | "replay";
  direction: "long" | "short";
  currency: Currency;
}

export interface TradingState {
  /** Separate cash buckets — INR for NSE, USD for US stocks */
  cashBalance: CashBalance;
  /** One position per symbol max */
  positions: Record<string, Position>;
  /** Chronological list of closed trades */
  history: Trade[];
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createInitialState(): TradingState {
  return {
    cashBalance: { INR: STARTING_BALANCE_INR, USD: STARTING_BALANCE_USD },
    positions: {},
    history: [],
  };
}

// ── Persistence ───────────────────────────────────────────────────────────

export function loadTradingState(): TradingState {
  if (typeof window === "undefined") return createInitialState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as Partial<TradingState>;

    // Handle migration from old single-number cashBalance
    let cashBalance: CashBalance;
    if (
      parsed.cashBalance &&
      typeof parsed.cashBalance === "object" &&
      "INR" in parsed.cashBalance &&
      "USD" in parsed.cashBalance
    ) {
      cashBalance = parsed.cashBalance as CashBalance;
    } else {
      // Old format — reset both buckets to starting values
      cashBalance = { INR: STARTING_BALANCE_INR, USD: STARTING_BALANCE_USD };
    }

    return {
      cashBalance,
      positions: parsed.positions ?? {},
      history: parsed.history ?? [],
    };
  } catch {
    return createInitialState();
  }
}

export function saveTradingState(state: TradingState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // Storage quota — silently ignore
  }
}

// ── Pure state transitions ────────────────────────────────────────────────

export type OrderResult =
  | { ok: true; state: TradingState }
  | { ok: false; error: string };

export function openPosition(
  state: TradingState,
  symbol: string,
  price: number,
  qty: number,
  barTime: string | number,
  mode: "live" | "replay",
  direction: "long" | "short" = "long",
): OrderResult {
  if (qty <= 0) return { ok: false, error: "Quantity must be > 0" };
  if (price <= 0) return { ok: false, error: "Invalid price" };
  if (state.positions[symbol]) {
    return { ok: false, error: `Already holding ${symbol} — close first` };
  }

  const currency = getCurrency(symbol);
  const cs = currencySymbol(currency);
  const cost = price * qty;
  const available = state.cashBalance[currency];

  if (cost > available) {
    return {
      ok: false,
      error: `Insufficient ${currency} balance (need ${cs}${fmtNum(cost, currency)}, have ${cs}${fmtNum(available, currency)})`,
    };
  }

  const position: Position = {
    symbol,
    qty,
    entryPrice: price,
    entryTime: String(barTime),
    mode,
    direction,
    currency,
    tp: null,
    sl: null,
  };

  return {
    ok: true,
    state: {
      ...state,
      cashBalance: {
        ...state.cashBalance,
        [currency]: available - cost,
      },
      positions: { ...state.positions, [symbol]: position },
    },
  };
}

export function closePosition(
  state: TradingState,
  symbol: string,
  exitPrice: number,
  barTime: string | number,
  mode: "live" | "replay"
): OrderResult {
  const pos = state.positions[symbol];
  if (!pos) return { ok: false, error: `No open position in ${symbol}` };
  if (exitPrice <= 0) return { ok: false, error: "Invalid exit price" };

  const isLong = pos.direction !== "short";
  const proceeds = isLong
    ? exitPrice * pos.qty
    : (2 * pos.entryPrice - exitPrice) * pos.qty;
  const realizedPnL = isLong
    ? (exitPrice - pos.entryPrice) * pos.qty
    : (pos.entryPrice - exitPrice) * pos.qty;

  const trade: Trade = {
    id: `${symbol}-${Date.now()}`,
    symbol,
    qty: pos.qty,
    entryPrice: pos.entryPrice,
    exitPrice,
    entryTime: pos.entryTime,
    exitTime: String(barTime),
    realizedPnL,
    mode,
    direction: pos.direction,
    currency: pos.currency,
  };

  const { [symbol]: _removed, ...remainingPositions } = state.positions;

  return {
    ok: true,
    state: {
      ...state,
      cashBalance: {
        ...state.cashBalance,
        [pos.currency]: state.cashBalance[pos.currency] + proceeds,
      },
      positions: remainingPositions,
      history: [trade, ...state.history],
    },
  };
}

// ── TP / SL setters ──────────────────────────────────────────────────────

export function setPositionTP(
  state: TradingState,
  symbol: string,
  price: number | null,
): TradingState {
  const pos = state.positions[symbol];
  if (!pos) return state;
  return {
    ...state,
    positions: { ...state.positions, [symbol]: { ...pos, tp: price } },
  };
}

export function setPositionSL(
  state: TradingState,
  symbol: string,
  price: number | null,
): TradingState {
  const pos = state.positions[symbol];
  if (!pos) return state;
  return {
    ...state,
    positions: { ...state.positions, [symbol]: { ...pos, sl: price } },
  };
}

// ── Pure calculations ─────────────────────────────────────────────────────

export function calcUnrealizedPnL(position: Position, currentPrice: number): number {
  return position.direction === "short"
    ? (position.entryPrice - currentPrice) * position.qty
    : (currentPrice - position.entryPrice) * position.qty;
}

/**
 * Total equity per currency bucket.
 * Returns { INR: number, USD: number } — each includes unrealized PnL
 * for open positions in that currency.
 */
export function calcTotalEquity(
  state: TradingState,
  currentPrices: Record<string, number>
): CashBalance {
  const unrealizedByCurrency = Object.values(state.positions).reduce(
    (acc, pos) => {
      const price = currentPrices[pos.symbol] ?? pos.entryPrice;
      acc[pos.currency] = (acc[pos.currency] ?? 0) + calcUnrealizedPnL(pos, price);
      return acc;
    },
    {} as Record<Currency, number>
  );

  return {
    INR: state.cashBalance.INR + (unrealizedByCurrency.INR ?? 0),
    USD: state.cashBalance.USD + (unrealizedByCurrency.USD ?? 0),
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────

/** Format a raw number with locale-appropriate separators (no currency symbol) */
function fmtNum(n: number, currency: Currency = "INR", decimals = 2): string {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return Math.abs(n).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format number with currency symbol, e.g. ₹1,23,456.78 or $12,345.67 */
export function fmt(n: number, currency: Currency = "INR", decimals = 2): string {
  return currencySymbol(currency) + fmtNum(n, currency, decimals);
}

/** Format a PnL value with sign and CSS color class hint */
export function fmtPnL(n: number, currency: Currency = "INR"): { text: string; cls: string } {
  const sign = n >= 0 ? "+" : "-";
  return {
    text: `${sign}${fmt(Math.abs(n), currency)}`,
    cls: n > 0 ? "pnl-green" : n < 0 ? "pnl-red" : "pnl-zero",
  };
}

/** Format a bar time (unix seconds or YYYY-MM-DD) to short readable string */
export function fmtBarTime(t: string | number): string {
  if (typeof t === "number") {
    return new Date(t * 1000).toLocaleString("en-IN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return t; // already YYYY-MM-DD
}
