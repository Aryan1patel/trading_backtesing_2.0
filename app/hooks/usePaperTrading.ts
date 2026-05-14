"use client";

import { useState, useCallback, useEffect } from "react";
import {
  TradingState,
  loadTradingState,
  saveTradingState,
  createInitialState,
  openPosition,
  closePosition,
  setPositionTP,
  setPositionSL,
  calcUnrealizedPnL,
  calcTotalEquity,
  getCurrency,
  currencySymbol,
  setNseSymbols,
} from "@/lib/paperTrading";
import { fetchSymbols } from "@/lib/dataService";

/**
 * usePaperTrading — Phase 7
 *
 * Manages TradingState in React, handles localStorage hydration,
 * and exposes clean buy / sell / close actions.
 *
 * Currency is resolved from the symbol via getCurrency() — the hook
 * never hard-codes ₹ or $ directly.
 */
export function usePaperTrading() {
  const [state, setState] = useState<TradingState>(createInitialState);
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastOrderMsg, setLastOrderMsg] = useState<string | null>(null);

  // ── Hydrate from localStorage + fetch authoritative NSE symbols ──────
  useEffect(() => {
    setState(loadTradingState());
    setIsHydrated(true);

    // Fetch the NSE symbol list from the backend so currency classification
    // (INR vs USD) is based on the single source of truth, not a hardcoded list.
    fetchSymbols()
      .then((nseSymbols) => setNseSymbols(nseSymbols))
      .catch(() => {
        /* backend offline — fallback seed list in paperTrading.ts is fine */
      });
  }, []);

  // ── Persist whenever state changes (after initial hydration) ──────────
  useEffect(() => {
    if (!isHydrated) return;
    saveTradingState(state);
  }, [state, isHydrated]);

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Open a LONG position (profit when price rises) */
  const buy = useCallback(
    (
      symbol: string,
      price: number,
      qty: number,
      barTime: string | number,
      mode: "live" | "replay"
    ) => {
      setState((prev) => {
        const result = openPosition(prev, symbol, price, qty, barTime, mode, "long");
        if (!result.ok) { setLastOrderMsg(`⚠ ${result.error}`); return prev; }
        const cs = currencySymbol(getCurrency(symbol));
        setLastOrderMsg(`✓ Bought (Long) ${qty} × ${symbol} @ ${cs}${price.toFixed(2)}`);
        return result.state;
      });
    },
    []
  );

  /** Open a SHORT position (profit when price falls) */
  const sell = useCallback(
    (
      symbol: string,
      price: number,
      qty: number,
      barTime: string | number,
      mode: "live" | "replay"
    ) => {
      setState((prev) => {
        const result = openPosition(prev, symbol, price, qty, barTime, mode, "short");
        if (!result.ok) { setLastOrderMsg(`⚠ ${result.error}`); return prev; }
        const cs = currencySymbol(getCurrency(symbol));
        setLastOrderMsg(`✓ Sold (Short) ${qty} × ${symbol} @ ${cs}${price.toFixed(2)}`);
        return result.state;
      });
    },
    []
  );

  /** Close (exit) whatever position is open in this symbol */
  const closePos = useCallback(
    (
      symbol: string,
      price: number,
      barTime: string | number,
      mode: "live" | "replay"
    ) => {
      setState((prev) => {
        const result = closePosition(prev, symbol, price, barTime, mode);
        if (!result.ok) { setLastOrderMsg(`⚠ ${result.error}`); return prev; }
        const trade = result.state.history[0];
        const pnl = trade?.realizedPnL ?? 0;
        const cs = currencySymbol(trade?.currency ?? getCurrency(symbol));
        const sign = pnl >= 0 ? "+" : "";
        setLastOrderMsg(
          `✓ Closed ${symbol} @ ${cs}${price.toFixed(2)}  (${sign}${cs}${Math.abs(pnl).toFixed(2)})`
        );
        return result.state;
      });
    },
    []
  );

  const reset = useCallback(() => {
    const fresh = createInitialState();
    setState(fresh);
    saveTradingState(fresh);
    setLastOrderMsg("Account reset — ₹1,00,000 · $10,000");
  }, []);

  const clearMsg = useCallback(() => setLastOrderMsg(null), []);

  const setTP = useCallback((symbol: string, price: number | null) => {
    setState((prev) => setPositionTP(prev, symbol, price));
  }, []);

  const setSL = useCallback((symbol: string, price: number | null) => {
    setState((prev) => setPositionSL(prev, symbol, price));
  }, []);

  const clearTP = useCallback((symbol: string) => {
    setState((prev) => setPositionTP(prev, symbol, null));
  }, []);

  const clearSL = useCallback((symbol: string) => {
    setState((prev) => setPositionSL(prev, symbol, null));
  }, []);

  // ── Derived helpers ──────────────────────────────────────────────────────

  const getUnrealizedPnL = useCallback(
    (symbol: string, currentPrice: number) => {
      const pos = state.positions[symbol];
      if (!pos) return null;
      return calcUnrealizedPnL(pos, currentPrice);
    },
    [state.positions]
  );

  const getTotalEquity = useCallback(
    (currentPrices: Record<string, number>) =>
      calcTotalEquity(state, currentPrices),
    [state]
  );

  return {
    state,
    isHydrated,
    lastOrderMsg,
    buy,
    sell,
    closePos,
    reset,
    clearMsg,
    setTP,
    setSL,
    clearTP,
    clearSL,
    getUnrealizedPnL,
    getTotalEquity,
  };
}
