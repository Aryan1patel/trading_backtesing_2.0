"use client";

import { useState, useCallback, useEffect } from "react";
import {
  loadWatchlist,
  saveWatchlist,
  getQuoteOrDefault,
  ALL_SYMBOLS,
  WatchlistItem,
} from "@/lib/watchlist";

export interface UseWatchlistReturn {
  /** Ordered list of watchlist items (with price/change data) */
  items: WatchlistItem[];
  /** Raw symbol list */
  symbols: string[];
  /** Symbols from ALL_SYMBOLS not yet in the watchlist */
  available: string[];
  addSymbol: (symbol: string) => void;
  removeSymbol: (symbol: string) => void;
  /** True until localStorage has been read on the client */
  isHydrated: boolean;
}

export function useWatchlist(): UseWatchlistReturn {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // ── Load from localStorage on client mount ────────────────────────────
  useEffect(() => {
    setSymbols(loadWatchlist());
    setIsHydrated(true);
  }, []);

  // ── Persist whenever the list changes (after hydration) ───────────────
  useEffect(() => {
    if (isHydrated) saveWatchlist(symbols);
  }, [symbols, isHydrated]);

  const addSymbol = useCallback((symbol: string) => {
    if (!ALL_SYMBOLS.includes(symbol)) return;
    setSymbols((prev) => (prev.includes(symbol) ? prev : [...prev, symbol]));
  }, []);

  const removeSymbol = useCallback((symbol: string) => {
    setSymbols((prev) => prev.filter((s) => s !== symbol));
  }, []);

  const items: WatchlistItem[] = symbols.map(getQuoteOrDefault);
  const available = ALL_SYMBOLS.filter((s) => !symbols.includes(s));

  return { items, symbols, available, addSymbol, removeSymbol, isHydrated };
}
