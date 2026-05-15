"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import TimeframeSelector from "./TimeframeSelector";
import IndicatorMenu from "./IndicatorMenu";
import ReplayControls from "./ReplayControls";
import BuySellBar from "./BuySellBar";
import TradingPanel from "./TradingPanel";
import WatchlistSidebar from "./WatchlistSidebar";
import DrawingLayer from "./DrawingLayer";
import BacktestPanel from "./BacktestPanel";
import type { TradingState } from "@/lib/paperTrading";
import { Timeframe, TIMEFRAMES, OHLCBar, fetchCandles } from "@/lib/dataService";
import { ReplayEngine, ReplayState, ReplaySpeed } from "@/lib/replayEngine";
import { usePaperTrading } from "@/hooks/usePaperTrading";
import { getCurrency, currencySymbol } from "@/lib/paperTrading";
import { useIndicators } from "@/hooks/useIndicators";

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";


// ── Polling interval per timeframe ─────────────────────────────────────────
const POLL_INTERVAL: Record<Timeframe, number> = {
  "1m":  30_000,
  "5m":  60_000,
  "15m": 120_000,
  "1h":  300_000,
  "1D":  0,
};

const CandlestickChart = dynamic(() => import("./CandlestickChart"), {
  ssr: false,
  loading: () => (
    <div className="chart-loading">
      <div className="spinner" />
      <span>Loading chart…</span>
    </div>
  ),
});

interface ChartLoaderProps {
  symbol: string;
  onSymbolSelect: (symbol: string) => void;
  onPriceUpdate?: (symbol: string, price: number) => void;
  tradingHook: ReturnType<typeof usePaperTrading>;
  wlOpen: boolean;
  onToggleWL: () => void;
  tradeOpen: boolean;
  onToggleTrade: () => void;
  ptOpen: boolean;
  onTogglePT: () => void;
  tradingState: TradingState;
  isHydrated: boolean;
  currentPrices: Record<string, number>;
  onResetPT: () => void;
}

export default function ChartLoader({
  symbol, onSymbolSelect, onPriceUpdate, tradingHook,
  wlOpen, onToggleWL,
  tradeOpen, onToggleTrade,
  ptOpen, onTogglePT,
  tradingState, isHydrated, currentPrices, onResetPT,
}: ChartLoaderProps) {
  // ── Timeframe ─────────────────────────────────────────────────────────
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const activeConfig = TIMEFRAMES.find((t) => t.key === timeframe)!;

  useEffect(() => {
    const saved = localStorage.getItem("chartlens_timeframe") as Timeframe | null;
    if (saved && TIMEFRAMES.some((t) => t.key === saved)) setTimeframe(saved);
  }, []);

  const handleTimeframeChange = (tf: Timeframe) => {
    localStorage.setItem("chartlens_timeframe", tf);
    setIsLoading(true);
    setTimeframe(tf);
  };

  // ── Data ──────────────────────────────────────────────────────────────
  const [bars, setBars] = useState<OHLCBar[]>([]);
  const barsRef = useRef<OHLCBar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // ── Backtest mode — must be declared before the fetch useEffects ──────
  const [btMode, setBtMode] = useState(false);
  const [btLabel, setBtLabel] = useState("");

  // ── Live price in React STATE so BuySellBar re-renders on every poll ──
  const [livePrice, setLivePrice] = useState<number | null>(null);

  // ── Indicators ─────────────────────────────────────────────────────
  const indicatorHook = useIndicators();

  // ── TP/SL placement mode ───────────────────────────────────────────────
  // "tp" or "sl" = user clicked Set TP/SL and is about to click on chart
  // null = inactive
  const [tpslMode, setTpslMode] = useState<"tp" | "sl" | null>(null);

  // Esc cancels placement mode
  useEffect(() => {
    if (!tpslMode) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setTpslMode(null); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [tpslMode]);

  // Called by CandlestickChart when user clicks during placement mode
  const handleChartPriceClick = useCallback((price: number) => {
    if (tpslMode === "tp") tradingHook.setTP(symbol, price);
    else if (tpslMode === "sl") tradingHook.setSL(symbol, price);
    setTpslMode(null); // auto-exit placement mode after one click
  }, [tpslMode, symbol, tradingHook]);


  // ── Replay ────────────────────────────────────────────────────────────
  const engineRef = useRef(new ReplayEngine());
  const [replayState, setReplayState] = useState<ReplayState | null>(null);
  const isReplayMode = replayState !== null && replayState.status !== "idle";

  useEffect(() => {
    const engine = engineRef.current;
    const unsub = engine.subscribe((state) => {
      setReplayState(state.status === "idle" ? null : { ...state });
    });
    return unsub;
  }, []);

  const handleToggleReplay  = () => {
    if (isReplayMode) { engineRef.current.stop(); }
    else { if (barsRef.current.length === 0) return; engineRef.current.activate(barsRef.current); }
  };
  const handleReplayPick    = useCallback((index: number) => { engineRef.current.setStartIndex(index); }, []);
  const handlePlay          = () => engineRef.current.play();
  const handlePause         = () => engineRef.current.pause();
  const handleStepForward   = () => engineRef.current.stepForward();
  const handleStepBack      = () => engineRef.current.stepBack();
  const handleSpeedChange   = (speed: ReplaySpeed) => engineRef.current.setSpeed(speed);
  const handleExitReplay    = () => engineRef.current.stop();

  // ── TP/SL auto-trigger ────────────────────────────────────────────────
  // Called after every price update (fetch + poll). Checks open positions
  // for this symbol and auto-closes if TP or SL is crossed.
  const checkTPSL = useCallback((price: number) => {
    const pos = tradingHook.state.positions[symbol];
    if (!pos) return;

    const barTime = barsRef.current[barsRef.current.length - 1]?.time ?? Date.now() / 1000;
    const isLong = pos.direction !== "short";

    if (isLong) {
      // LONG: TP triggers when price rises to target, SL when price falls
      if (pos.tp !== null && price >= pos.tp) {
        tradingHook.closePos(symbol, pos.tp, barTime, "live"); return;
      }
      if (pos.sl !== null && price <= pos.sl) {
        tradingHook.closePos(symbol, pos.sl, barTime, "live");
      }
    } else {
      // SHORT: TP triggers when price FALLS to target, SL when price RISES
      if (pos.tp !== null && price <= pos.tp) {
        tradingHook.closePos(symbol, pos.tp, barTime, "live"); return;
      }
      if (pos.sl !== null && price >= pos.sl) {
        tradingHook.closePos(symbol, pos.sl, barTime, "live");
      }
    }
  }, [symbol, tradingHook]);

  // ── Data fetching ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isReplayMode || btMode) return;
    const controller = new AbortController();
    setIsLoading(true);
    setFetchError(null);

    fetchCandles(symbol, timeframe, controller.signal)
      .then((raw) => {
        if (controller.signal.aborted) return;
        barsRef.current = raw;
        setBars(raw);
        setIsLoading(false);
        const lastClose = raw[raw.length - 1]?.close ?? null;
        if (lastClose !== null) {
          setLivePrice(lastClose);
          onPriceUpdate?.(symbol, lastClose);
          checkTPSL(lastClose);
        }
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setIsLoading(false);
        setFetchError(err.message || "Failed to load chart data");
      });

    return () => controller.abort();
  }, [symbol, timeframe, retryCount, btMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Background polling ────────────────────────────────────────────────
  useEffect(() => {
    const ms = POLL_INTERVAL[timeframe];
    if (ms === 0 || isReplayMode || btMode) { setIsPolling(false); return; }
    setIsPolling(true);
    const timer = setInterval(async () => {
      try {
        const fresh = await fetchCandles(symbol, timeframe);
        if (fresh.length > 0) {
          barsRef.current = fresh;
          setBars(fresh);
          const lastClose = fresh[fresh.length - 1]?.close ?? null;
          if (lastClose !== null) {
            setLivePrice(lastClose);
            onPriceUpdate?.(symbol, lastClose);
            checkTPSL(lastClose);
          }
        }
      } catch { /* silent */ }
    }, ms);
    return () => { clearInterval(timer); setIsPolling(false); };
  }, [symbol, timeframe, isReplayMode, btMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Also check TP/SL when replay steps (direction-aware) ─────────────
  useEffect(() => {
    if (!isReplayMode) return;
    const bar = engineRef.current.getCurrentBar();
    if (!bar) return;
    const pos = tradingHook.state.positions[symbol];
    if (!pos) return;

    const isLong = pos.direction !== "short";
    if (isLong) {
      if (pos.tp !== null && bar.close >= pos.tp)
        tradingHook.closePos(symbol, pos.tp, bar.time, "replay");
      else if (pos.sl !== null && bar.close <= pos.sl)
        tradingHook.closePos(symbol, pos.sl, bar.time, "replay");
    } else {
      if (pos.tp !== null && bar.close <= pos.tp)
        tradingHook.closePos(symbol, pos.tp, bar.time, "replay");
      else if (pos.sl !== null && bar.close >= pos.sl)
        tradingHook.closePos(symbol, pos.sl, bar.time, "replay");
    }
  }, [replayState?.currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Paper trading price resolution ───────────────────────────────────
  // CRITICAL: live fills at last bar close; replay fills at engine.getCurrentBar().close
  const replayFillPrice = isReplayMode ? (engineRef.current.getCurrentBar()?.close ?? null) : null;
  const fillPrice = isReplayMode ? replayFillPrice : livePrice;

  const openPosition = tradingHook.state.positions[symbol] ?? null;

  // Resolve currency from the current symbol — determines which balance bucket to show
  const currency = getCurrency(symbol);
  const cs = currencySymbol(currency);
  void cs; // used in BuySellBar, exported for readability

  // ── Fyers auth status ─────────────────────────────────────────────────
  const [fyersAuthed, setFyersAuthed] = useState<boolean | null>(null);

  // ── Backtest panel ────────────────────────────────────────────────────
  const [btOpen, setBtOpen] = useState(false);

  const handleLoadBacktest = useCallback((
    cachedBars: OHLCBar[],
    sym: string,
    tf: string,
    dateFrom: string,
    dateTo: string,
  ) => {
    barsRef.current = cachedBars;
    setBars(cachedBars);
    setBtMode(true);
    setBtLabel(`${sym} ${tf} · ${dateFrom} → ${dateTo}  (${cachedBars.length.toLocaleString()} bars)`);
  }, []);

  const handleExitBacktest = useCallback(() => {
    setBtMode(false);
    setBtLabel("");
    setRetryCount((c) => c + 1); // re-trigger live fetch
  }, []);
  useEffect(() => {
    fetch(`${BACKEND}/api/fyers/status`)
      .then((r) => r.json())
      .then((d) => setFyersAuthed(d.authenticated ?? false))
      .catch(() => setFyersAuthed(false));
    // re-check every 5 minutes
    const t = setInterval(() => {
      fetch(`${BACKEND}/api/fyers/status`)
        .then((r) => r.json())
        .then((d) => setFyersAuthed(d.authenticated ?? false))
        .catch(() => setFyersAuthed(false));
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);


  /** Opens a LONG position (Buy button) — auto-sets TP +5% / SL -3% */
  const handleBuy = useCallback((qty: number) => {
    if (fillPrice === null) return;
    const barTime = isReplayMode
      ? (engineRef.current.getCurrentBar()?.time ?? Date.now() / 1000)
      : (barsRef.current[barsRef.current.length - 1]?.time ?? Date.now() / 1000);
    tradingHook.buy(symbol, fillPrice, qty, barTime, isReplayMode ? "replay" : "live");
    // Auto-place TP +6 / SL -2.5 fixed price offset
    tradingHook.setTP(symbol, Math.round((fillPrice + 6) * 100) / 100);
    tradingHook.setSL(symbol, Math.round((fillPrice - 2.5) * 100) / 100);
  }, [fillPrice, isReplayMode, symbol, tradingHook]);

  /** Opens a SHORT position (Sell button) — auto-sets TP -5% / SL +3% */
  const handleOpenShort = useCallback((qty: number) => {
    if (fillPrice === null) return;
    const barTime = isReplayMode
      ? (engineRef.current.getCurrentBar()?.time ?? Date.now() / 1000)
      : (barsRef.current[barsRef.current.length - 1]?.time ?? Date.now() / 1000);
    tradingHook.sell(symbol, fillPrice, qty, barTime, isReplayMode ? "replay" : "live");
    // Auto-place TP -6 / SL +2.5 fixed price offset
    tradingHook.setTP(symbol, Math.round((fillPrice - 6) * 100) / 100);
    tradingHook.setSL(symbol, Math.round((fillPrice + 2.5) * 100) / 100);
  }, [fillPrice, isReplayMode, symbol, tradingHook]);

  /** Closes whatever position is open (Close Position button) */
  const handleClose = useCallback(() => {
    if (fillPrice === null) return;
    const barTime = isReplayMode
      ? (engineRef.current.getCurrentBar()?.time ?? Date.now() / 1000)
      : (barsRef.current[barsRef.current.length - 1]?.time ?? Date.now() / 1000);
    tradingHook.closePos(symbol, fillPrice, barTime, isReplayMode ? "replay" : "live");
  }, [fillPrice, isReplayMode, symbol, tradingHook]);

  const handleSetTP = useCallback((price: number | null) => tradingHook.setTP(symbol, price), [symbol, tradingHook]);
  const handleSetSL = useCallback((price: number | null) => tradingHook.setSL(symbol, price), [symbol, tradingHook]);

  // Called by CandlestickChart while dragging the TP/SL price lines
  const handleTPDrag = useCallback((price: number) => tradingHook.setTP(symbol, price), [symbol, tradingHook]);
  const handleSLDrag = useCallback((price: number) => tradingHook.setSL(symbol, price), [symbol, tradingHook]);


  // ── Positions for chart price lines ──────────────────────────────────
  const positions = Object.values(tradingHook.state.positions);

  // ── Drawing layer: chart + series handles ────────────────────────────
  const [drawingChart, setDrawingChart] = useState<import("lightweight-charts").IChartApi | null>(null);
  const [drawingSeries, setDrawingSeries] = useState<import("lightweight-charts").ISeriesApi<"Candlestick"> | null>(null);
  const handleChartReady = useCallback(
    (chart: import("lightweight-charts").IChartApi, series: import("lightweight-charts").ISeriesApi<"Candlestick">) => {
      setDrawingChart(chart);
      setDrawingSeries(series);
    },
    []
  );
  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="chart-loader">
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="tf-bar">
        <TimeframeSelector
          active={timeframe}
          onChange={handleTimeframeChange}
          isLoading={isLoading}
          disabled={isReplayMode}
        />
        <div className="toolbar-divider" aria-hidden="true" />
        <IndicatorMenu hook={indicatorHook} />
        <div className="toolbar-divider" aria-hidden="true" />
        <button
          id="replay-toggle-btn"
          className={`replay-toggle-btn${isReplayMode ? " active" : ""}`}
          onClick={handleToggleReplay}
          disabled={bars.length === 0}
          aria-pressed={isReplayMode}
          aria-label={isReplayMode ? "Exit replay mode" : "Enter replay mode"}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M11 2 L6 6.5 L11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 2 L1 6.5 L6 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Replay
        </button>
        <button
          className={`replay-toggle-btn${btOpen ? " active" : ""}`}
          onClick={() => setBtOpen((v) => !v)}
          aria-pressed={btOpen}
          aria-label="Prepare backtest data"
          title="Prepare historical data for backtesting"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 10.5 L4 7 L6.5 9 L10 4 L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="1" y="11.5" width="11" height="1" rx="0.5" fill="currentColor" fillOpacity="0.5"/>
          </svg>
          Backtest
        </button>
        <span className="tf-data-note">
          {isPolling && !isReplayMode ? (
            <><span className="tf-live-dot" aria-hidden="true" />Live · auto-refreshing</>
          ) : timeframe === "1D" ? "EOD data · ~15 min delay" : "FastAPI backend"}
        </span>
        <div className="toolbar-divider" aria-hidden="true" />
        <button
          className={`panel-toggle-btn${wlOpen ? " active" : ""}`}
          onClick={onToggleWL}
          aria-label={wlOpen ? "Close watchlist" : "Open watchlist"}
          title={wlOpen ? "Close watchlist" : "Watchlist"}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <rect x="0.5" y="1.5" width="10" height="1.4" rx="0.7" fill="currentColor"/>
            <rect x="0.5" y="4.8" width="10" height="1.4" rx="0.7" fill="currentColor"/>
            <rect x="0.5" y="8.1" width="10" height="1.4" rx="0.7" fill="currentColor"/>
          </svg>
          WL
        </button>
        <button
          className={`panel-toggle-btn${tradeOpen ? " active" : ""}`}
          onClick={onToggleTrade}
          aria-label={tradeOpen ? "Close trade panel" : "Open trade panel"}
          title={tradeOpen ? "Close trade panel" : "Trade"}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M1 9 L3.5 6 L5.5 7.5 L10 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="3.5" cy="6" r="1" fill="currentColor"/>
          </svg>
          Trade
        </button>
        <button
          className={`panel-toggle-btn${ptOpen ? " active" : ""}`}
          onClick={onTogglePT}
          aria-label={ptOpen ? "Close trading panel" : "Open trading panel"}
          title={ptOpen ? "Close trading panel" : "Paper Trading"}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M1 8.5 L4 5 L6.5 7 L10 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          PT
        </button>

        {/* ── Fyers auth button ──────────────────────────────────── */}
        <div className="toolbar-divider" aria-hidden="true" />
        <a
          href={`${BACKEND}/api/fyers/login`}
          target="_blank"
          rel="noopener noreferrer"
          className={`fyers-auth-btn${fyersAuthed === true ? " fyers-auth-btn--ok" : fyersAuthed === false ? " fyers-auth-btn--off" : ""}`}
          title={fyersAuthed ? "Fyers connected — click to re-auth" : "Connect Fyers for 90-day NSE data"}
          aria-label={fyersAuthed ? "Fyers authenticated" : "Authenticate with Fyers"}
        >
          {/* Small F logo mark */}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect width="10" height="10" rx="2" fill="currentColor" fillOpacity="0.18"/>
            <text x="1.5" y="8.5" fontSize="8" fontWeight="700" fill="currentColor" fontFamily="sans-serif">F</text>
          </svg>
          {fyersAuthed === null ? "Fyers" : fyersAuthed ? "Fyers ✓" : "Auth Fyers"}
        </a>
      </div>

      {/* ── Error banner ───────────────────────────────────────────── */}
      {fetchError && (
        <div className="chart-error-banner" role="alert">
          <span className="chart-error-icon">⚠</span>
          <span className="chart-error-msg">{fetchError}</span>
          <button id="chart-error-retry-btn" className="chart-error-retry" onClick={() => setRetryCount((c) => c + 1)}>Retry</button>
        </div>
      )}

      {/* ── Backtest mode banner ───────────────────────────────── */}
      {btMode && (
        <div className="bt-mode-banner" role="status">
          <span className="bt-mode-banner__icon" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 9 L3.5 6 L6 8 L9 3.5 L11 5.5" stroke="#26a69a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="1" y="10" width="10" height="1" rx="0.5" fill="#26a69a" fillOpacity="0.4"/>
            </svg>
          </span>
          <span className="bt-mode-banner__label">BACKTEST MODE</span>
          <span className="bt-mode-banner__info">{btLabel}</span>
          <button className="bt-mode-banner__exit" onClick={handleExitBacktest}>
            ✕ Exit
          </button>
        </div>
      )}

      {/* ── Replay picking hint ────────────────────────────────────── */}
      {replayState?.status === "picking" && (
        <div className="replay-picking-hint" role="status">
          <span className="replay-picking-dot" />
          Click any candle on the chart to set your replay start point
        </div>
      )}

      {/* ── Replay controls ────────────────────────────────────────── */}
      {replayState && (
        <ReplayControls
          state={replayState}
          onPlay={handlePlay}
          onPause={handlePause}
          onStepBack={handleStepBack}
          onStepForward={handleStepForward}
          onSpeedChange={handleSpeedChange}
          onExit={handleExitReplay}
        />
      )}

      {/* ── Main row: chart pane + Trade column + PT column ────────── */}
      <div className="chart-body">
        {/* Chart canvas — flex:1 */}
        <div className="chart-body__chart">
          <CandlestickChart
            symbol={symbol}
            timeframeLabel={activeConfig.label}
            bars={bars}
            isLoading={isLoading}
            indicatorInstances={indicatorHook.instances}
            replayState={replayState}
            onReplayPick={handleReplayPick}
            openPositions={positions}
            livePrice={livePrice}
            tpslMode={tpslMode}
            onChartPriceClick={handleChartPriceClick}
            onTPDrag={handleTPDrag}
            onSLDrag={handleSLDrag}
            onChartReady={handleChartReady}
            drawingLayerChildren={
              <DrawingLayer
                symbol={symbol}
                timeframe={timeframe}
                chart={drawingChart}
                series={drawingSeries}
                locked={isReplayMode || tpslMode !== null}
              />
            }
          />
        </div>

        {/* Trade panel — full-height column, toggled by toolbar */}
        {tradeOpen && (
          <BuySellBar
            symbol={symbol}
            fillPrice={fillPrice}
            currentPrice={livePrice}
            openPosition={openPosition}
            cashBalance={tradingHook.state.cashBalance[currency]}
            currency={currency}
            onBuy={handleBuy}
            onSell={handleOpenShort}
            onClose={handleClose}
            onSetTP={handleSetTP}
            onSetSL={handleSetSL}
            lastOrderMsg={tradingHook.lastOrderMsg}
            onClearMsg={tradingHook.clearMsg}
            isReplayMode={isReplayMode}
            tpslMode={tpslMode}
            onActivateTPMode={() => setTpslMode((m) => m === "tp" ? null : "tp")}
            onActivateSLMode={() => setTpslMode((m) => m === "sl" ? null : "sl")}
          />
        )}

        {/* PT panel — full-height column, toggled by toolbar */}
        <TradingPanel
          state={tradingState}
          isHydrated={isHydrated}
          currentPrices={currentPrices}
          onReset={onResetPT}
          isOpen={ptOpen}
          onToggle={onTogglePT}
        />

        {/* WL panel — full-height column, toggled by toolbar */}
        <WatchlistSidebar
          activeSymbol={symbol}
          onSelect={onSymbolSelect}
          isOpen={wlOpen}
          onToggle={onToggleWL}
        />
      </div>

      {/* Backtest data-prep panel — modal overlay */}
      {btOpen && (
        <BacktestPanel
          symbol={symbol}
          timeframe={timeframe}
          onClose={() => setBtOpen(false)}
          onLoadBacktest={handleLoadBacktest}
        />
      )}
    </div>
  );
}
