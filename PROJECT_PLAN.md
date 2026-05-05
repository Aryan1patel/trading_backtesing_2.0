# TradingView-style Web App — Project Plan

A simplified TradingView-like charting website with multi-timeframe candles, indicators, replay mode, a watchlist, and Indian stock data.

## Core Features (for now)
1. Candlestick chart with multiple timeframes (1m, 5m, 15m, 1h, 1d, etc.)
2. Technical indicators (RSI, MACD, EMA/SMA, Bollinger Bands, Volume)
3. Replay mode (step/play through historical candles one by one)
4. Watchlist (add/remove symbols, see live price + % change)
5. Indian stocks data (NSE)
6. Paper trading — simulated buy/sell in both live mode and replay mode

## Tech Stack
- **Frontend:** Next.js (React framework)
- **Charting library:** Lightweight Charts (by TradingView, free & open-source)
- **Indicator math:** `technicalindicators` npm package
- **Backend:** FastAPI (Python) — to fetch/cache data and avoid exposing API rate limits to the browser
- **Database:** MongoDB (via `motor` for async) or PostgreSQL/SQLite (store user's watchlist)
- **Data source (Indian stocks):** `nsepython` (NSE unofficial wrapper) — expect ~15 min delay
- **Data source (Gold/other):** `yfinance`
- **Data source (Crypto):** Binance API or `ccxt`
- **Hosting:** Vercel/Netlify (frontend) + Render/Railway/Fly.io (backend — FastAPI doesn't deploy as seamlessly on Vercel as Node does)

## Build Sequence

### Phase 1 — Basic Chart
- [ ] Set up Next.js project
- [ ] Integrate Lightweight Charts (client-side only — use dynamic import with ssr: false)
- [ ] Fetch static/sample OHLC data and render candlesticks
- [ ] Style chart to look TradingView-ish (dark theme, colors, crosshair)

### Phase 2 — Timeframes
- [ ] Add timeframe selector UI (1m/5m/15m/1h/1d)
- [ ] Fetch/aggregate data per timeframe
- [ ] Re-render chart on timeframe change without full reload

### Phase 3 — Indicators
- [ ] Add indicator panel/menu
- [ ] Implement SMA/EMA (overlay on price)
- [ ] Implement RSI (separate pane below chart)
- [ ] Implement MACD (separate pane)
- [ ] Implement Bollinger Bands (overlay)
- [ ] Allow toggling indicators on/off

### Phase 4 — Replay Mode
- [ ] "Start Replay" button — pick a starting candle index
- [ ] Slice historical data up to that index, feed rest incrementally
- [ ] Play / Pause / Step forward / Step back controls
- [ ] Speed control (candles per second)
- [ ] Recalculate indicators live as replay progresses

### Phase 5 — Watchlist
- [ ] Sidebar UI listing symbols (like TradingView's watchlist panel)
- [ ] Add/remove symbol search
- [ ] Show live/delayed price, change, % change per symbol
- [ ] Click symbol → loads it into main chart
- [ ] Persist watchlist (localStorage first, DB later if you add login)

### Phase 6 — Indian Stock Data
- [ ] Connect backend to NSE data source
- [ ] Cache responses (avoid hammering the unofficial API)
- [ ] Map NSE symbols (e.g. RELIANCE, TCS, INFY) into the app
- [ ] Handle delay/error states gracefully in UI

### Phase 7 — Paper Trading (Live + Replay)
- [ ] Design trade/position data model (symbol, qty, entry price, entry time, status)
- [ ] Backend: endpoints to place order, close position, fetch open positions, fetch trade history
- [ ] Store starting fake balance, deduct/add on buy/sell
- [ ] Live mode: fill order at current price, track unrealized P&L as price updates
- [ ] Replay mode: fill order at the "current" replay candle's price, so trades respect replay timeline
- [ ] UI: Buy/Sell buttons, position panel, P&L display, trade history list
- [ ] Reset balance/positions option

## Notes
- Build and test each phase with **one symbol first** (e.g. AAPL or RELIANCE) before wiring up the full watchlist — easier to debug.
- Keep backend as a thin proxy: browser never calls NSE/exchange APIs directly (avoids CORS + rate-limit issues).
- Gold and Bitcoin were discussed as later additions — not in this phase, add once Phase 1–6 are solid.
