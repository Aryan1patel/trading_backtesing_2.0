"use client";

import { useState, useCallback } from "react";
import ChartLoader from "./ChartLoader";
import { usePaperTrading } from "@/hooks/usePaperTrading";

export default function AppLayout() {
  const [symbol, setSymbol] = useState(() => {
    if (typeof window === "undefined") return "AAPL";
    return localStorage.getItem("chartlens_symbol") ?? "AAPL";
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tradeOpen, setTradeOpen] = useState(false);

  const handleSymbolSelect = (sym: string) => {
    setSymbol(sym);
    localStorage.setItem("chartlens_symbol", sym);
  };
  const [tradingPanelOpen, setTradingPanelOpen] = useState(false);

  const tradingHook = usePaperTrading();

  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const handlePriceUpdate = useCallback((sym: string, price: number) => {
    setCurrentPrices((prev) => (prev[sym] === price ? prev : { ...prev, [sym]: price }));
  }, []);

  return (
    <div className="app-content">
      <section className="chart-section" aria-label="Chart area">
        <ChartLoader
          key={symbol}
          symbol={symbol}
          onSymbolSelect={handleSymbolSelect}
          tradingHook={tradingHook}
          onPriceUpdate={handlePriceUpdate}
          wlOpen={sidebarOpen}
          onToggleWL={() => setSidebarOpen((v) => !v)}
          tradeOpen={tradeOpen}
          onToggleTrade={() => setTradeOpen((v) => !v)}
          ptOpen={tradingPanelOpen}
          onTogglePT={() => setTradingPanelOpen((v) => !v)}
          tradingState={tradingHook.state}
          isHydrated={tradingHook.isHydrated}
          currentPrices={currentPrices}
          onResetPT={tradingHook.reset}
        />
      </section>
    </div>
  );
}
