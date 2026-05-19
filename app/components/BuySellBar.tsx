"use client";

import { useState, useEffect, useRef } from "react";
import type { Position, Currency } from "@/lib/paperTrading";
import { fmtPnL, currencySymbol } from "@/lib/paperTrading";

interface BuySellBarProps {
  symbol: string;
  fillPrice: number | null;
  currentPrice: number | null;
  openPosition: Position | null;
  cashBalance: number;
  currency: Currency;
  onBuy: (qty: number) => void;
  onSell: (qty: number) => void;
  onClose: () => void;
  onSetTP: (price: number | null) => void;
  onSetSL: (price: number | null) => void;
  lastOrderMsg: string | null;
  onClearMsg: () => void;
  isReplayMode: boolean;
  tpslMode?: "tp" | "sl" | null;
  onActivateTPMode?: () => void;
  onActivateSLMode?: () => void;
}

export default function BuySellBar({
  symbol,
  fillPrice,
  currentPrice,
  openPosition,
  cashBalance,
  currency,
  onBuy,
  onSell,
  onClose,
  onSetTP,
  onSetSL,
  lastOrderMsg,
  onClearMsg,
  isReplayMode,
  tpslMode = null,
  onActivateTPMode,
  onActivateSLMode,
}: BuySellBarProps) {
  const [qty, setQty] = useState(1);
  const [tpInput, setTpInput] = useState("");
  const [slInput, setSlInput] = useState("");
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync TP/SL inputs when position changes
  useEffect(() => {
    if (openPosition) {
      setTpInput(openPosition.tp != null ? String(openPosition.tp) : "");
      setSlInput(openPosition.sl != null ? String(openPosition.sl) : "");
    } else {
      setTpInput("");
      setSlInput("");
    }
  }, [openPosition?.symbol, openPosition?.tp, openPosition?.sl]); // eslint-disable-line

  // Auto-dismiss order message after 4s
  useEffect(() => {
    if (!lastOrderMsg) return;
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(onClearMsg, 4000);
    return () => { if (msgTimer.current) clearTimeout(msgTimer.current); };
  }, [lastOrderMsg, onClearMsg]);

  const price = fillPrice ?? 0;
  const cost = price * qty;
  const hasPosition = openPosition !== null;
  const cs = currencySymbol(currency);  // "₹" or "$"
  const canBuy   = fillPrice !== null && fillPrice > 0 && !hasPosition && cost <= cashBalance && qty > 0;
  const canSell  = fillPrice !== null && fillPrice > 0 && !hasPosition && cost <= cashBalance && qty > 0;
  const canClose = hasPosition && fillPrice !== null && fillPrice > 0;

  // Direction-aware unrealized PnL
  const unrealizedPnL =
    openPosition && currentPrice != null
      ? openPosition.direction === "short"
        ? (openPosition.entryPrice - currentPrice) * openPosition.qty
        : (currentPrice - openPosition.entryPrice) * openPosition.qty
      : null;
  const pnlFmt = unrealizedPnL !== null ? fmtPnL(unrealizedPnL, currency) : null;
  const pnlPct =
    openPosition && unrealizedPnL !== null
      ? (unrealizedPnL / (openPosition.entryPrice * openPosition.qty)) * 100
      : null;

  const handleSetTP = () => {
    const v = parseFloat(tpInput);
    if (isNaN(v) || v <= 0) { onActivateTPMode?.(); return; }
    onSetTP(v);
  };
  const handleSetSL = () => {
    const v = parseFloat(slInput);
    if (isNaN(v) || v <= 0) { onActivateSLMode?.(); return; }
    onSetSL(v);
  };
  const handleTPKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSetTP(); }
  };
  const handleSLKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSetSL(); }
  };

  return (
    <aside className={`op-panel${isReplayMode ? " op-panel--replay" : ""}`} aria-label="Order panel">

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="op-header">
        <span className="op-symbol">{symbol}</span>
        <span className={`op-mode-badge ${isReplayMode ? "replay" : "live"}`}>
          {isReplayMode ? "REPLAY" : "LIVE"}
        </span>
      </div>

      {/* ─── Price display ──────────────────────────────────────────── */}
      <div className="op-price-row">
        <div className="op-side-price sell">
          <span className="op-side-label">Sell</span>
          <span className="op-side-value">{fillPrice != null ? `${cs}${fillPrice.toFixed(2)}` : "—"}</span>
        </div>
        <div className="op-side-price buy">
          <span className="op-side-label">Buy</span>
          <span className="op-side-value">{fillPrice != null ? `${cs}${fillPrice.toFixed(2)}` : "—"}</span>
        </div>
      </div>

      {/* ─── Quantity ────────────────────────────────────────────────── */}
      <div className="op-qty-row">
        <label htmlFor="op-qty-input" className="op-qty-label">Qty</label>
        <div className="op-qty-ctrl">
          <button
            className="op-qty-step"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={hasPosition}
            aria-label="Decrease quantity"
          >−</button>
          <input
            id="op-qty-input"
            className="op-qty-input"
            type="number"
            min={1} max={99999} step={1}
            value={qty}
            disabled={hasPosition}
            onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value))))}
          />
          <button
            className="op-qty-step"
            onClick={() => setQty((q) => q + 1)}
            disabled={hasPosition}
            aria-label="Increase quantity"
          >+</button>
        </div>
            {fillPrice != null && qty > 0 && !hasPosition && (
              <span className="op-cost">
                ≈ {cs}{cost.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 })}
              </span>
            )}
      </div>

      {/* ─── Buy / Sell action buttons ───────────────────────────────── */}
      <div className="op-action-row">
        <button
          id="op-sell-btn"
          className="op-btn op-btn--sell"
          onClick={() => onSell(qty)}
          disabled={!canSell}
          title={hasPosition ? "Close position first" : "Open Short position"}
        >
          Sell
        </button>
        <button
          id="op-buy-btn"
          className="op-btn op-btn--buy"
          onClick={() => onBuy(qty)}
          disabled={!canBuy}
          title={hasPosition ? "Close position first" : "Open Long position"}
        >
          Buy
        </button>
      </div>

      {/* ─── Open position card ─────────────────────────────────────── */}
      {hasPosition && openPosition && (
        <div className="op-position-card">
          <div className="op-pos-header">
            <span className={`op-dir-badge ${openPosition.direction}`}>
              {openPosition.direction === "long" ? "▲ LONG" : "▼ SHORT"}
            </span>
            <span className="op-pos-qty">{openPosition.qty} units</span>
          </div>
          <div className="op-pos-entry">
            Entry <strong>{cs}{openPosition.entryPrice.toFixed(2)}</strong>
          </div>
          {currentPrice != null && (
            <div className="op-pos-mkt">
              Market <strong>{cs}{currentPrice.toFixed(2)}</strong>
            </div>
          )}
          {pnlFmt && (
            <div className={`op-pos-pnl ${pnlFmt.cls}`}>
              <span className="op-pnl-label">P&L</span>
              <span className="op-pnl-value">{pnlFmt.text}</span>
              {pnlPct !== null && (
                <span className="op-pnl-pct">
                  ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
                </span>
              )}
            </div>
          )}

          {/* Close Position */}
          <button
            id="op-close-btn"
            className="op-close-btn"
            onClick={onClose}
            disabled={!canClose}
          >
            Close Position
          </button>
        </div>
      )}

      {/* ─── TP / SL ────────────────────────────────────────────────── */}
      {hasPosition && openPosition && (
        <div className="op-tpsl-section">
          <div className="op-tpsl-title">Take Profit / Stop Loss</div>

          {/* TP */}
          <div className="op-tpsl-row">
            <button
              className={`op-tpsl-chart-btn tp${tpslMode === "tp" ? " active" : ""}`}
              onClick={onActivateTPMode}
              title={tpslMode === "tp" ? "Cancel" : "Click chart to set TP price"}
            >
              {tpslMode === "tp" ? <><span className="op-tpsl-pulse" />Chart</> : "🎯 TP"}
            </button>
            <input
              id="op-tp-input"
              className="op-tpsl-input"
              type="number"
              placeholder={fillPrice
                ? (openPosition.direction === "long" ? fillPrice + 6 : fillPrice - 6).toFixed(2)
                : "Target"}
              value={tpInput}
              step="0.01" min="0"
              onChange={(e) => setTpInput(e.target.value)}
              onKeyDown={handleTPKeyDown}
            />
            {openPosition.tp != null ? (
              <button className="op-tpsl-cancel" onClick={() => { setTpInput(""); onSetTP(null); }} title="Remove TP">✕</button>
            ) : (
              <button id="op-tp-set-btn" className="op-tpsl-set tp" onClick={handleSetTP}>Set</button>
            )}
          </div>
          {openPosition.tp != null && (
            <div className="op-tpsl-active-price tp">@ {cs}{openPosition.tp.toFixed(2)}</div>
          )}

          {/* SL */}
          <div className="op-tpsl-row">
            <button
              className={`op-tpsl-chart-btn sl${tpslMode === "sl" ? " active" : ""}`}
              onClick={onActivateSLMode}
              title={tpslMode === "sl" ? "Cancel" : "Click chart to set SL price"}
            >
              {tpslMode === "sl" ? <><span className="op-tpsl-pulse" />Chart</> : "🛑 SL"}
            </button>
            <input
              id="op-sl-input"
              className="op-tpsl-input"
              type="number"
              placeholder={fillPrice
                ? (openPosition.direction === "long" ? fillPrice - 2.5 : fillPrice + 2.5).toFixed(2)
                : "Stop"}
              value={slInput}
              step="0.01" min="0"
              onChange={(e) => setSlInput(e.target.value)}
              onKeyDown={handleSLKeyDown}
            />
            {openPosition.sl != null ? (
              <button className="op-tpsl-cancel" onClick={() => { setSlInput(""); onSetSL(null); }} title="Remove SL">✕</button>
            ) : (
              <button id="op-sl-set-btn" className="op-tpsl-set sl" onClick={handleSetSL}>Set</button>
            )}
          </div>
          {openPosition.sl != null && (
            <div className="op-tpsl-active-price sl">@ {cs}{openPosition.sl.toFixed(2)}</div>
          )}

          {tpslMode && (
            <p className="op-tpsl-hint">
              Click the chart to place {tpslMode === "tp" ? "TP" : "SL"} · Esc to cancel
            </p>
          )}
        </div>
      )}

      {/* ─── Balance ────────────────────────────────────────────────── */}
      <div className="op-balance">
        <span className="op-balance-label">Balance</span>
        <span className="op-balance-value">
          {cs}{cashBalance.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 0 })}
        </span>
      </div>

      {/* ─── Order feedback ─────────────────────────────────────────── */}
      {lastOrderMsg && (
        <div
          className={`op-order-msg${lastOrderMsg.startsWith("⚠") ? " error" : " success"}`}
          role="status"
          aria-live="polite"
        >
          {lastOrderMsg}
        </div>
      )}
    </aside>
  );
}
