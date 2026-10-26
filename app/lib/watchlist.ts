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
  // ── US stocks ──────────────────────────────────────────────────────────
  AAPL:  { name: "Apple Inc.",            price: 305.93,  change: +2.45,   changePct: +0.81  },
  MSFT:  { name: "Microsoft Corp.",       price: 495.40,  change: -3.17,   changePct: -0.64  },
  TSLA:  { name: "Tesla Inc.",            price: 247.15,  change: +8.92,   changePct: +3.75  },
  GOOGL: { name: "Alphabet Inc.",         price: 178.90,  change: +1.23,   changePct: +0.69  },
  NVDA:  { name: "NVIDIA Corp.",          price: 875.40,  change: -12.30,  changePct: -1.39  },
  AMZN:  { name: "Amazon.com Inc.",       price: 236.43,  change: +3.81,   changePct: +1.64  },
  META:  { name: "Meta Platforms",        price: 625.23,  change: -2.45,   changePct: -0.39  },
  NFLX:  { name: "Netflix Inc.",          price: 845.95,  change: +15.40,  changePct: +1.86  },

  // ── NSE Indices ────────────────────────────────────────────────────────
  NIFTY50:      { name: "Nifty 50 Index",         price: 24500.00, change: +120.00, changePct: +0.49 },
  BANKNIFTY:    { name: "Bank Nifty Index",        price: 52800.00, change: -180.00, changePct: -0.34 },
  NIFTYIT:      { name: "Nifty IT Index",          price: 38500.00, change: +230.00, changePct: +0.60 },
  NIFTYMIDCAP50:{ name: "Nifty Midcap 50",         price: 15200.00, change: +85.00,  changePct: +0.56 },

  // ── Commodities (MCX) ──────────────────────────────────────────────────
  GOLD:    { name: "Gold (MCX Spot ₹/10g)",        price: 73500.00, change: +250.00, changePct: +0.34 },
  SILVER:  { name: "Silver (MCX Spot ₹/kg)",       price: 92000.00, change: -300.00, changePct: -0.33 },
  CRUDEOIL:{ name: "Crude Oil MCX (₹/bbl)",        price: 6850.00,  change: +45.00,  changePct: +0.66 },

  // ── Nifty 50 — complete list ───────────────────────────────────────────
  RELIANCE:    { name: "Reliance Industries",      price: 1317.00, change: +8.50,  changePct: +0.65 },
  TCS:         { name: "Tata Consultancy Svcs",    price: 3825.00, change: -35.00, changePct: -0.91 },
  INFY:        { name: "Infosys Ltd.",             price: 1780.00, change: +12.25, changePct: +0.69 },
  WIPRO:       { name: "Wipro Ltd.",               price: 267.00,  change: -1.80,  changePct: -0.67 },
  HDFCBANK:    { name: "HDFC Bank Ltd.",           price: 1721.00, change: +15.20, changePct: +0.89 },
  ICICIBANK:   { name: "ICICI Bank Ltd.",          price: 1248.00, change: -6.40,  changePct: -0.51 },
  SBIN:        { name: "State Bank of India",      price: 812.00,  change: +5.60,  changePct: +0.69 },
  TATAMOTORS:  { name: "Tata Motors Ltd.",         price: 935.00,  change: +22.40, changePct: +2.45 },
  BHARTIARTL:  { name: "Bharti Airtel Ltd.",       price: 1735.00, change: -9.20,  changePct: -0.53 },
  ITC:         { name: "ITC Ltd.",                 price: 472.00,  change: +1.85,  changePct: +0.39 },
  KOTAKBANK:   { name: "Kotak Mahindra Bank",      price: 1875.00, change: +12.50, changePct: +0.67 },
  BAJFINANCE:  { name: "Bajaj Finance Ltd.",       price: 6850.00, change: -45.00, changePct: -0.65 },
  ASIANPAINT:  { name: "Asian Paints Ltd.",        price: 2680.00, change: +18.00, changePct: +0.68 },
  MARUTI:      { name: "Maruti Suzuki India",      price: 12450.00,change: +95.00, changePct: +0.77 },
  HINDUNILVR:  { name: "Hindustan Unilever Ltd.",  price: 2430.00, change: -12.00, changePct: -0.49 },
  AXISBANK:    { name: "Axis Bank Ltd.",           price: 1148.00, change: +8.50,  changePct: +0.75 },
  ULTRACEMCO:  { name: "UltraTech Cement Ltd.",    price: 11200.00,change: +75.00, changePct: +0.67 },
  TITAN:       { name: "Titan Company Ltd.",       price: 3450.00, change: +28.00, changePct: +0.82 },
  SUNPHARMA:   { name: "Sun Pharmaceutical",       price: 1680.00, change: -9.50,  changePct: -0.56 },
  NESTLEIND:   { name: "Nestle India Ltd.",        price: 2320.00, change: +15.00, changePct: +0.65 },
  LT:          { name: "Larsen & Toubro Ltd.",     price: 3580.00, change: +22.00, changePct: +0.62 },
  ONGC:        { name: "Oil & Natural Gas Corp.",  price: 268.00,  change: +2.30,  changePct: +0.87 },
  NTPC:        { name: "NTPC Ltd.",               price: 358.00,  change: +1.80,  changePct: +0.51 },
  TECHM:       { name: "Tech Mahindra Ltd.",       price: 1520.00, change: +18.00, changePct: +1.20 },
  POWERGRID:   { name: "Power Grid Corp.",         price: 318.00,  change: +1.50,  changePct: +0.47 },
  BAJAJFINSV:  { name: "Bajaj Finserv Ltd.",       price: 1640.00, change: -8.50,  changePct: -0.52 },
  DIVISLAB:    { name: "Divi's Laboratories",      price: 5250.00, change: +35.00, changePct: +0.67 },
  DRREDDY:     { name: "Dr Reddy's Laboratories",  price: 6180.00, change: -28.00, changePct: -0.45 },
  CIPLA:       { name: "Cipla Ltd.",               price: 1480.00, change: +9.50,  changePct: +0.65 },
  COALINDIA:   { name: "Coal India Ltd.",          price: 398.00,  change: +2.20,  changePct: +0.56 },
  ADANIENT:    { name: "Adani Enterprises Ltd.",   price: 2780.00, change: +35.00, changePct: +1.27 },
  ADANIPORTS:  { name: "Adani Ports & SEZ",        price: 1290.00, change: +12.00, changePct: +0.94 },
  HINDALCO:    { name: "Hindalco Industries",      price: 632.00,  change: +5.50,  changePct: +0.88 },
  JSWSTEEL:    { name: "JSW Steel Ltd.",           price: 925.00,  change: -6.50,  changePct: -0.70 },
  TATASTEEL:   { name: "Tata Steel Ltd.",          price: 165.00,  change: +1.20,  changePct: +0.73 },
  BPCL:        { name: "Bharat Petroleum Corp.",   price: 295.00,  change: +2.80,  changePct: +0.96 },
  EICHERMOT:   { name: "Eicher Motors Ltd.",       price: 4850.00, change: +38.00, changePct: +0.79 },
  APOLLOHOSP:  { name: "Apollo Hospitals",         price: 6920.00, change: +45.00, changePct: +0.65 },
  GRASIM:      { name: "Grasim Industries Ltd.",   price: 2680.00, change: +18.50, changePct: +0.70 },
  HCLTECH:     { name: "HCL Technologies Ltd.",    price: 1620.00, change: +12.00, changePct: +0.75 },
  HEROMOTOCO:  { name: "Hero MotoCorp Ltd.",       price: 4680.00, change: -22.00, changePct: -0.47 },
  BRITANNIA:   { name: "Britannia Industries",     price: 5120.00, change: +28.00, changePct: +0.55 },
  SBILIFE:     { name: "SBI Life Insurance",       price: 1580.00, change: +9.50,  changePct: +0.60 },
  HDFCLIFE:    { name: "HDFC Life Insurance",      price: 720.00,  change: -3.80,  changePct: -0.53 },
  UPL:         { name: "UPL Ltd.",                 price: 548.00,  change: +4.20,  changePct: +0.77 },
  VEDL:        { name: "Vedanta Ltd.",             price: 445.00,  change: +3.80,  changePct: +0.86 },
  INDUSINDBK:  { name: "IndusInd Bank Ltd.",       price: 1020.00, change: -8.50,  changePct: -0.83 },
  "M&M":       { name: "Mahindra & Mahindra",      price: 2980.00, change: +25.00, changePct: +0.85 },

  // ── Nifty Next 50 / popular mid-caps ──────────────────────────────────
  ZOMATO:      { name: "Zomato Ltd.",              price: 245.00,  change: +4.50,  changePct: +1.87 },
  PAYTM:       { name: "One 97 Communications",    price: 680.00,  change: -12.50, changePct: -1.81 },
  NYKAA:       { name: "FSN E-Commerce (Nykaa)",   price: 185.00,  change: +2.80,  changePct: +1.54 },
  DMART:       { name: "Avenue Supermarts (DMart)", price: 4250.00,change: +35.00, changePct: +0.83 },
  PIIND:       { name: "PI Industries Ltd.",       price: 4180.00, change: +28.00, changePct: +0.67 },
  PERSISTENT:  { name: "Persistent Systems",       price: 5480.00, change: +42.00, changePct: +0.77 },
  LTIM:        { name: "LTIMindtree Ltd.",         price: 5820.00, change: -35.00, changePct: -0.60 },
  MUTHOOTFIN:  { name: "Muthoot Finance Ltd.",     price: 1920.00, change: +18.00, changePct: +0.95 },
  ABCAPITAL:   { name: "Aditya Birla Capital",     price: 195.00,  change: +1.80,  changePct: +0.93 },
  BANDHANBNK:  { name: "Bandhan Bank Ltd.",        price: 168.00,  change: -1.50,  changePct: -0.88 },
  CANBK:       { name: "Canara Bank Ltd.",         price: 98.00,   change: +0.80,  changePct: +0.82 },
  PNB:         { name: "Punjab National Bank",     price: 108.00,  change: +1.20,  changePct: +1.12 },
  BANKBARODA:  { name: "Bank of Baroda",           price: 228.00,  change: +2.50,  changePct: +1.11 },
  IDFCFIRSTB:  { name: "IDFC First Bank Ltd.",     price: 72.00,   change: -0.80,  changePct: -1.10 },
  TRENT:       { name: "Trent Ltd. (Westside)",    price: 5680.00, change: +65.00, changePct: +1.16 },
  POLYCAB:     { name: "Polycab India Ltd.",       price: 6250.00, change: +48.00, changePct: +0.77 },
  HAVELLS:     { name: "Havells India Ltd.",       price: 1680.00, change: +12.50, changePct: +0.75 },
  SIEMENS:     { name: "Siemens Ltd.",             price: 7250.00, change: +55.00, changePct: +0.76 },
  ABB:         { name: "ABB India Ltd.",           price: 8450.00, change: -45.00, changePct: -0.53 },
  TORNTPHARM:  { name: "Torrent Pharmaceuticals",  price: 3280.00, change: +18.00, changePct: +0.55 },
  LUPIN:       { name: "Lupin Ltd.",               price: 2180.00, change: +15.00, changePct: +0.69 },
  AUROPHARMA:  { name: "Aurobindo Pharma Ltd.",    price: 1280.00, change: +8.50,  changePct: +0.67 },
  MANKIND:     { name: "Mankind Pharma Ltd.",      price: 2650.00, change: +20.00, changePct: +0.76 },
  MAXHEALTH:   { name: "Max Healthcare Institute", price: 1050.00, change: +9.50,  changePct: +0.91 },
  IRCTC:       { name: "Indian Railway Catering",  price: 780.00,  change: +6.50,  changePct: +0.84 },
  IRFC:        { name: "Indian Railway Finance",   price: 168.00,  change: +1.80,  changePct: +1.08 },
  HAL:         { name: "Hindustan Aeronautics",    price: 4650.00, change: +45.00, changePct: +0.98 },
  BEL:         { name: "Bharat Electronics Ltd.",  price: 298.00,  change: +3.20,  changePct: +1.09 },
  NHPC:        { name: "NHPC Ltd.",                price: 88.00,   change: +0.90,  changePct: +1.03 },
  RECLTD:      { name: "REC Ltd.",                 price: 545.00,  change: +5.80,  changePct: +1.08 },
  PFC:         { name: "Power Finance Corp.",      price: 468.00,  change: +4.20,  changePct: +0.91 },
  ADANIGREEN:  { name: "Adani Green Energy",       price: 1850.00, change: +22.00, changePct: +1.20 },
  ADANIPOWER:  { name: "Adani Power Ltd.",         price: 595.00,  change: +8.50,  changePct: +1.45 },
  TATAPOWER:   { name: "Tata Power Co. Ltd.",      price: 428.00,  change: +5.50,  changePct: +1.30 },
  CGPOWER:     { name: "CG Power & Industrial",    price: 748.00,  change: +8.20,  changePct: +1.11 },
  SUZLON:      { name: "Suzlon Energy Ltd.",       price: 58.00,   change: +0.80,  changePct: +1.40 },
  HFCL:        { name: "HFCL Ltd.",               price: 128.00,  change: +1.50,  changePct: +1.19 },
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
