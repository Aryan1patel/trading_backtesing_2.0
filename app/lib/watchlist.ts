/**
 * watchlist.ts — Phase 5 / Phase 6b
 *
 * Pure data layer for the watchlist — no React, no chart imports.
 *
 * Phase 5: localStorage persistence, static mock prices.
 * Phase 6b: real OHLCV data comes from the backend for the chart.
 *           Watchlist row prices are still static mock values — Phase 7
 *           will add a /api/quotes endpoint that returns live prices
 *           for all watchlist symbols in one batch call.
 *
 * Phase 7 / accounts swap point:
 *   Replace loadWatchlist() / saveWatchlist() bodies with fetch() calls.
 *   Nothing else in the codebase needs to change.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface WatchlistItem {
  symbol: string;
  name: string;
  /** Last close — static mock for Phase 6b, real in Phase 7 */
  price: number;
  /** $ / ₹ change from previous close — static mock */
  change: number;
  /** % change — static mock */
  changePct: number;
  isUp: boolean;
}

// ── Mock quote data ───────────────────────────────────────────────────────
// Phase 7 replaces these with a live /api/quotes batch endpoint.
// US prices in USD, NSE prices in INR.

export const MOCK_QUOTES: Record<string, Omit<WatchlistItem, "symbol" | "isUp">> = {
  // ── US stocks (via yfinance) ────────────────────────────────────────────
  AAPL:  { name: "Apple Inc.",            price: 305.93,  change: +2.45,   changePct: +0.81  },
  MSFT:  { name: "Microsoft Corp.",       price: 495.40,  change: -3.17,   changePct: -0.64  },
  TSLA:  { name: "Tesla Inc.",            price: 247.15,  change: +8.92,   changePct: +3.75  },
  GOOGL: { name: "Alphabet Inc.",         price: 178.90,  change: +1.23,   changePct: +0.69  },
  NVDA:  { name: "NVIDIA Corp.",          price: 875.40,  change: -12.30,  changePct: -1.39  },
  AMZN:  { name: "Amazon.com Inc.",       price: 236.43,  change: +3.81,   changePct: +1.64  },
  META:  { name: "Meta Platforms",        price: 625.23,  change: -2.45,   changePct: -0.39  },
  NFLX:  { name: "Netflix Inc.",          price: 845.95,  change: +15.40,  changePct: +1.86  },

  // ── NSE stocks — prices in ₹ (via nsepython + yfinance .NS) ────────────
  RELIANCE:   { name: "Reliance Industries", price: 1317.00, change: +8.50,  changePct: +0.65 },
  TCS:        { name: "Tata Consultancy Svcs", price: 3825.00, change: -35.00, changePct: -0.91 },
  INFY:       { name: "Infosys Ltd.",         price: 1780.00, change: +12.25, changePct: +0.69 },
  WIPRO:      { name: "Wipro Ltd.",           price: 267.00,  change: -1.80,  changePct: -0.67 },
  HDFCBANK:   { name: "HDFC Bank Ltd.",       price: 1721.00, change: +15.20, changePct: +0.89 },
  ICICIBANK:  { name: "ICICI Bank Ltd.",      price: 1248.00, change: -6.40,  changePct: -0.51 },
  SBIN:       { name: "State Bank of India",  price: 812.00,  change: +5.60,  changePct: +0.69 },
  TATAMOTORS: { name: "Tata Motors Ltd.",     price: 935.00,  change: +22.40, changePct: +2.45 },
  BHARTIARTL: { name: "Bharti Airtel Ltd.",   price: 1735.00, change: -9.20,  changePct: -0.53 },
  ITC:        { name: "ITC Ltd.",             price: 472.00,  change: +1.85,  changePct: +0.39 },
};

/** All symbols available to add to watchlist */
export const ALL_SYMBOLS = Object.keys(MOCK_QUOTES);

/** Default watchlist — shows a mix of Indian and US symbols */
export const DEFAULT_WATCHLIST = ["AAPL", "RELIANCE", "MSFT", "TCS"];

// ── localStorage persistence ──────────────────────────────────────────────
// Phase 7 swap: replace these two functions with API fetch calls.

const LS_KEY = "chartlens_watchlist_v1";

/** Load watchlist symbol list — falls back to DEFAULT_WATCHLIST */
export function loadWatchlist(): string[] {
  if (typeof window === "undefined") return DEFAULT_WATCHLIST;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST;
    const valid = (parsed as unknown[]).filter(
      (s): s is string => typeof s === "string" && ALL_SYMBOLS.includes(s)
    );
    return valid.length > 0 ? valid : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

/** Persist watchlist symbol list */
export function saveWatchlist(symbols: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(symbols));
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

// ── Quote helpers ─────────────────────────────────────────────────────────

export function getQuote(symbol: string): WatchlistItem | null {
  const q = MOCK_QUOTES[symbol];
  if (!q) return null;
  return { symbol, ...q, isUp: q.change >= 0 };
}

export function getQuoteOrDefault(symbol: string): WatchlistItem {
  return (
    getQuote(symbol) ?? {
      symbol,
      name: symbol,
      price: 0,
      change: 0,
      changePct: 0,
      isUp: false,
    }
  );
}
