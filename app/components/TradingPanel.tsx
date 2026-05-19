"use client";

import { useState } from "react";
import type { TradingState } from "@/lib/paperTrading";
import {
  fmt, fmtPnL, fmtBarTime,
  STARTING_BALANCE_INR, STARTING_BALANCE_USD,
  calcUnrealizedPnL,
  currencySymbol,
} from "@/lib/paperTrading";

interface TradingPanelProps {
  state: TradingState;
  isHydrated: boolean;
  /** Live current prices for each symbol — used to show live PnL in positions */
  currentPrices: Record<string, number>;
  onReset: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function TradingPanel({
  state,
  isHydrated,
  currentPrices,
  onReset,
  isOpen,
  onToggle,
}: TradingPanelProps) {
  const [tab, setTab] = useState<"positions" | "history">("positions");
  const [confirmReset, setConfirmReset] = useState(false);

  const positions = Object.values(state.positions);

  // Per-currency unrealized PnL totals
  const unrealizedByCurrency = positions.reduce(
    (acc, pos) => {
      const price = currentPrices[pos.symbol] ?? pos.entryPrice;
      acc[pos.currency] = (acc[pos.currency] ?? 0) + calcUnrealizedPnL(pos, price);
      return acc;
    },
    { INR: 0, USD: 0 } as { INR: number; USD: number }
  );

  const equityINR = state.cashBalance.INR + unrealizedByCurrency.INR;
  const equityUSD = state.cashBalance.USD + unrealizedByCurrency.USD;
  const totalPnL_INR = equityINR - STARTING_BALANCE_INR;
  const totalPnL_USD = equityUSD - STARTING_BALANCE_USD;

  return (
    <aside
      className={`tp-sidebar${isOpen ? " tp-sidebar--open" : ""}`}
      aria-label="Paper trading panel"
    >
      {/* ── Toggle button ──────────────────────────────────────────── */}
      <button
        id="tp-toggle-btn"
        className="tp-toggle-btn"
        onClick={onToggle}
        aria-label={isOpen ? "Collapse trading panel" : "Expand trading panel"}
        title={isOpen ? "Collapse" : "Paper Trading"}
      >
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none"
          style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}
          aria-hidden="true"
        >
          <path d="M5 2 L10 7 L5 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!isOpen && <span className="tp-toggle-label">PT</span>}
      </button>

      {isOpen && (
        <div className="tp-content">
          {/* ── Account summary ─────────────────────────────────────── */}
          <div className="tp-account">
            {/* INR bucket */}
            <div className="tp-account-section-label">₹ INR Account</div>
            <div className="tp-account-row">
              <span className="tp-account-label">Cash</span>
              <span className="tp-account-value">
                {isHydrated ? fmt(state.cashBalance.INR, "INR", 0) : "—"}
              </span>
            </div>
            <div className="tp-account-row">
              <span className="tp-account-label">Equity</span>
              <span className="tp-account-value">
                {isHydrated ? fmt(equityINR, "INR", 0) : "—"}
              </span>
            </div>
            <div className="tp-account-row">
              <span className="tp-account-label">P&L</span>
              <span className={`tp-account-value ${isHydrated ? fmtPnL(totalPnL_INR, "INR").cls : ""}`}>
                {isHydrated ? fmtPnL(totalPnL_INR, "INR").text : "—"}
              </span>
            </div>

            <div className="tp-account-divider" />

            {/* USD bucket */}
            <div className="tp-account-section-label">$ USD Account</div>
            <div className="tp-account-row">
              <span className="tp-account-label">Cash</span>
              <span className="tp-account-value">
                {isHydrated ? fmt(state.cashBalance.USD, "USD", 0) : "—"}
              </span>
            </div>
            <div className="tp-account-row">
              <span className="tp-account-label">Equity</span>
              <span className="tp-account-value">
                {isHydrated ? fmt(equityUSD, "USD", 0) : "—"}
              </span>
            </div>
            <div className="tp-account-row">
              <span className="tp-account-label">P&L</span>
              <span className={`tp-account-value ${isHydrated ? fmtPnL(totalPnL_USD, "USD").cls : ""}`}>
                {isHydrated ? fmtPnL(totalPnL_USD, "USD").text : "—"}
              </span>
            </div>
          </div>

          {/* ── Tab switcher ─────────────────────────────────────────── */}
          <div className="tp-tabs" role="tablist">
            <button
              id="tp-tab-positions"
              role="tab"
              aria-selected={tab === "positions"}
              className={`tp-tab${tab === "positions" ? " active" : ""}`}
              onClick={() => setTab("positions")}
            >
              Positions {positions.length > 0 && <span className="tp-tab-badge">{positions.length}</span>}
            </button>
            <button
              id="tp-tab-history"
              role="tab"
              aria-selected={tab === "history"}
              className={`tp-tab${tab === "history" ? " active" : ""}`}
              onClick={() => setTab("history")}
            >
              History {state.history.length > 0 && <span className="tp-tab-badge">{state.history.length}</span>}
            </button>
          </div>

          {/* ── Positions tab ────────────────────────────────────────── */}
          {tab === "positions" && (
            <div className="tp-list" role="tabpanel" aria-labelledby="tp-tab-positions">
              {!isHydrated && <div className="tp-empty">Loading…</div>}
              {isHydrated && positions.length === 0 && (
                <div className="tp-empty">
                  <p>No open positions.</p>
                  <p>Use Buy / Sell on the order panel to open one.</p>
                </div>
              )}
              {isHydrated && positions.map((pos) => {
                const price = currentPrices[pos.symbol] ?? pos.entryPrice;
                const upnl = calcUnrealizedPnL(pos, price);
                const upnlFmt = fmtPnL(upnl, pos.currency);
                const cs = currencySymbol(pos.currency);
                // Direction-aware pct
                const pct = pos.direction === "short"
                  ? ((pos.entryPrice - price) / pos.entryPrice) * 100
                  : ((price - pos.entryPrice) / pos.entryPrice) * 100;

                return (
                  <div key={pos.symbol} className="tp-pos-row" aria-label={`Position: ${pos.symbol}`}>
                    <div className="tp-pos-top">
                      <span className="tp-pos-symbol">{pos.symbol}</span>
                      <span className={`tp-pos-badge ${pos.mode}`}>{pos.mode}</span>
                      <span className={`tp-dir-tag ${pos.direction}`}>
                        {pos.direction === "long" ? "▲L" : "▼S"}
                      </span>
                      <span className={`tp-pos-pnl ${upnlFmt.cls}`}>{upnlFmt.text}</span>
                    </div>
                    <div className="tp-pos-bottom">
                      <span className="tp-pos-detail">
                        {pos.qty} × {cs}{pos.entryPrice.toFixed(2)}
                      </span>
                      <span className="tp-pos-detail tp-pos-current">
                        Now: {cs}{price.toFixed(2)}
                        <span className={pct >= 0 ? "pnl-green" : "pnl-red"}>
                          {" "}({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)
                        </span>
                      </span>
                    </div>
                    <div className="tp-pos-time">{fmtBarTime(pos.entryTime)}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── History tab ──────────────────────────────────────────── */}
          {tab === "history" && (
            <div className="tp-list" role="tabpanel" aria-labelledby="tp-tab-history">
              {!isHydrated && <div className="tp-empty">Loading…</div>}
              {isHydrated && state.history.length === 0 && (
                <div className="tp-empty">
                  <p>No closed trades yet.</p>
                </div>
              )}
              {isHydrated && state.history.map((trade) => {
                const pnlFmt = fmtPnL(trade.realizedPnL, trade.currency);
                const cs = currencySymbol(trade.currency);
                return (
                  <div key={trade.id} className="tp-trade-row" aria-label={`Closed trade: ${trade.symbol}`}>
                    <div className="tp-trade-top">
                      <span className="tp-pos-symbol">{trade.symbol}</span>
                      <span className={`tp-pos-badge ${trade.mode}`}>{trade.mode}</span>
                      <span className={`tp-dir-tag ${trade.direction}`}>
                        {trade.direction === "long" ? "▲L" : "▼S"}
                      </span>
                      <span className={`tp-trade-pnl ${pnlFmt.cls}`}>{pnlFmt.text}</span>
                    </div>
                    <div className="tp-trade-detail">
                      {trade.qty} × {cs}{trade.entryPrice.toFixed(2)} → {cs}{trade.exitPrice.toFixed(2)}
                    </div>
                    <div className="tp-pos-time">
                      {fmtBarTime(trade.entryTime)} → {fmtBarTime(trade.exitTime)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Reset button ─────────────────────────────────────────── */}
          <div className="tp-footer">
            {confirmReset ? (
              <div className="tp-reset-confirm">
                <span>Reset all trades?</span>
                <button
                  id="tp-reset-yes"
                  className="tp-reset-yes"
                  onClick={() => { onReset(); setConfirmReset(false); }}
                >Yes</button>
                <button
                  id="tp-reset-no"
                  className="tp-reset-no"
                  onClick={() => setConfirmReset(false)}
                >No</button>
              </div>
            ) : (
              <button
                id="tp-reset-btn"
                className="tp-reset-btn"
                onClick={() => setConfirmReset(true)}
                aria-label="Reset paper trading account"
              >
                ↺ Reset account
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
