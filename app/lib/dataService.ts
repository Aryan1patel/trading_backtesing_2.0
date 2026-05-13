/**
 * dataService.ts — Phase 6b
 *
 * Single source of truth for all data fetching.
 *
 * Phase 6b (now): calls the FastAPI backend at NEXT_PUBLIC_BACKEND_URL.
 * Nothing else in the codebase changed — same signature, same return shape.
 *
 * To point at a different backend (e.g. production), set:
 *   NEXT_PUBLIC_BACKEND_URL=https://api.chartlens.com
 * in .env.local (dev) or the deployment environment variables.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1D";

export interface OHLCBar {
  /** Unix timestamp (seconds) for intraday bars; "YYYY-MM-DD" for daily bars */
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeframeConfig {
  key: Timeframe;
  label: string;
  secondsPerBar: number;
}

// ── Timeframe config ──────────────────────────────────────────────────────

export const TIMEFRAMES: TimeframeConfig[] = [
  { key: "1m",  label: "1m",  secondsPerBar: 60 },
  { key: "5m",  label: "5m",  secondsPerBar: 300 },
  { key: "15m", label: "15m", secondsPerBar: 900 },
  { key: "1h",  label: "1h",  secondsPerBar: 3600 },
  { key: "1D",  label: "1D",  secondsPerBar: 86400 },
];

// ── Backend URL ───────────────────────────────────────────────────────────

/**
 * NEXT_PUBLIC_ prefix exposes this to the browser bundle.
 * Falls back to localhost:8000 so dev works without a .env.local file.
 */
const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// ── Backend response shape ────────────────────────────────────────────────

interface BackendCandlesResponse {
  symbol: string;
  timeframe: string;
  exchange: string;
  cached: boolean;
  bar_count: number;
  bars: OHLCBar[];
}

// ── Data fetcher ──────────────────────────────────────────────────────────

/**
 * Fetches OHLC bars from the ChartLens FastAPI backend.
 *
 * The backend routes the request to the correct data source:
 *   - Indian NSE symbols (RELIANCE, TCS, …) → nsepython + yfinance .NS
 *   - US symbols (AAPL, MSFT, …) → yfinance
 *
 * Returns the same OHLCBar[] shape the frontend has always used —
 * no other component needed to change for Phase 6b.
 */
export interface SymbolsResponse {
  nse_symbols: string[];
}

/**
 * Fetches the authoritative NSE symbol list from the backend.
 * Call once at app startup — the result is used by paper trading
 * (currency classification) and the watchlist.
 */
export async function fetchSymbols(): Promise<string[]> {
  const res = await fetch(`${BACKEND_BASE}/api/symbols`);
  if (!res.ok) throw new Error(`Failed to fetch symbols: HTTP ${res.status}`);
  const data = (await res.json()) as SymbolsResponse;
  return data.nse_symbols;
}

export async function fetchCandles(
  symbol: string,
  tf: Timeframe,
  signal?: AbortSignal
): Promise<OHLCBar[]> {
  const url = `${BACKEND_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (networkErr: unknown) {
    // Network failure (backend down, CORS, no internet, etc.)
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const msg =
      networkErr instanceof TypeError && networkErr.message
        ? networkErr.message
        : "Cannot reach backend";
    throw new Error(
      `Backend unreachable — is FastAPI running on ${BACKEND_BASE}? (${msg})`
    );
  }

  if (!res.ok) {
    // Parse the FastAPI error detail if available
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore parse failure */
    }
    throw new Error(`${symbol}/${tf}: ${detail}`);
  }

  const data = (await res.json()) as BackendCandlesResponse;
  return data.bars;
}
