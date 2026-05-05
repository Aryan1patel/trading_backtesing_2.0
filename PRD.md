# Product Requirements Document (PRD)

## Project Name
TradingView-style Charting Web App (working title)

## Summary
A web app for viewing and analyzing financial charts — similar to TradingView, but scoped down to a focused feature set. Targets stocks (including Indian stocks), with candlestick charts, technical indicators, a historical replay mode, and a personal watchlist.

## Problem / Motivation
Full platforms like TradingView are powerful but heavy, and building a scoped-down version is a good way to learn/demonstrate real-time data handling, charting, and financial domain logic. This isn't meant to replace TradingView — it's a focused tool + portfolio project.

## Goals
- Let a user view candlestick charts for a stock across multiple timeframes
- Let a user apply common technical indicators to a chart
- Let a user "replay" historical price action candle-by-candle
- Let a user maintain a personal watchlist of symbols
- Support Indian stock symbols (NSE)
- Let a user paper trade (simulated buy/sell) both in live mode and while using replay mode

## Non-Goals (out of scope for now)
- Real order execution / actual trading with real money (paper trading only — simulated, no real broker orders)
- Full Pine-Script-style custom scripting for indicators
- Every indicator TradingView offers — just the common ones
- Gold and Bitcoin (planned for later, not this phase)
- User accounts / multi-device sync (localStorage is enough for now)

## Target User
Someone who wants a simple, fast tool to check stock charts and practice reading price action — including via replay — without the clutter of a full trading platform. Also functions as a personal portfolio/demo project.

## Key Features & Requirements

### 1. Candlestick Chart
- Displays OHLC data as candlesticks
- User can switch timeframe: 1m, 5m, 15m, 1h, 1d
- Chart supports zoom/pan
- Dark theme UI similar to TradingView

### 2. Indicators
- User can add/remove indicators from a menu
- Supported at launch: SMA, EMA, RSI, MACD, Bollinger Bands, Volume
- Overlay indicators (SMA/EMA/Bollinger) render on the price chart
- Separate-pane indicators (RSI/MACD) render below the price chart

### 3. Replay Mode
- User selects a starting point on the chart
- Candles after that point are hidden until "played"
- Controls: Play, Pause, Step forward, Step back, Speed adjustment
- Indicators update live as replay progresses

### 4. Watchlist
- Sidebar list of symbols
- Add/remove symbols via search
- Shows last price, change, % change per symbol
- Clicking a symbol loads it into the main chart
- Persisted locally (browser storage) for now

### 5. Paper Trading (Live + Replay)
- User starts with a fake cash balance (e.g. ₹1,00,000 or $10,000 — configurable)
- User can place simulated Buy/Sell orders on the currently loaded chart symbol
- Works in **live mode**: orders fill at current/last price, position tracked in real time
- Works in **replay mode**: orders fill at the price of the candle being replayed — lets user test strategies against historical data candle-by-candle
- Shows open positions, P&L (unrealized + realized), and trade history
- Balance/positions reset available (start fresh)
- No real money, no real broker connection — purely simulated

### 6. Indian Stock Data
- Backend (FastAPI/Python) fetches NSE stock data via `nsepython` (unofficial wrapper)
- Data may be delayed (~15 min) — this is disclosed in the UI, not hidden
- Symbols mapped to standard NSE tickers (e.g. RELIANCE, TCS, INFY)

## Tech Note
- Frontend is built in **Next.js** rather than plain React — chosen for built-in routing, easy Vercel deployment, and better resume/job-market relevance. (Lightweight Charts touches the DOM directly, so it's loaded client-side only via dynamic import with `ssr: false`.)
- Backend is built in **FastAPI (Python)** rather than Node/Express — chosen for its strong data/finance ecosystem (`pandas`, `nsepython`, `yfinance`) and built-in API docs, which makes testing endpoints easier during development.

## Success Criteria
- A user can search a symbol, view its chart across at least 4 timeframes, apply at least 3 indicators, replay its history, save it to a watchlist, and place simulated paper trades in both live and replay mode with correct P&L tracking — all without errors or noticeable lag on reasonable data sizes (e.g. 1 year of daily candles).

## Assumptions & Constraints
- No paid data feed initially — free/unofficial sources only, so live-ness and reliability of Indian stock data is a known limitation, not a bug
- Single-user app for now (no login/auth)
- Performance target: smooth on a handful of symbols and moderate history length, not exchange-scale data volumes

## Open Questions
- Do we eventually add user accounts so watchlist syncs across devices?
- Do we add gold/crypto in this version or a v2?
- Do we ever move to a paid data feed (e.g. Kite Connect) for real-time Indian data?

## Related Docs
- See `PROJECT_PLAN.md` for the technical build sequence and phase breakdown.
