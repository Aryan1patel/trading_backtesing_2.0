"use client";

import { useState, useRef, useEffect } from "react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { WatchlistItem, MOCK_QUOTES } from "@/lib/watchlist";

interface WatchlistSidebarProps {
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

// ── Individual row ────────────────────────────────────────────────────────

function WatchlistRow({
  item,
  isActive,
  onSelect,
  onRemove,
}: {
  item: WatchlistItem;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const sign = item.change >= 0 ? "+" : "";
  const pctSign = item.changePct >= 0 ? "+" : "";

  return (
    <div
      className={`wl-row${isActive ? " wl-row--active" : ""}${item.isUp ? " wl-row--up" : " wl-row--down"}`}
      role="button"
      tabIndex={0}
      aria-label={`Select ${item.symbol} — ${item.name}`}
      aria-current={isActive ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      id={`wl-row-${item.symbol}`}
    >
      {/* Active indicator strip */}
      {isActive && <span className="wl-row-strip" aria-hidden="true" />}

      {/* Left: symbol + name */}
      <div className="wl-row-left">
        <span className="wl-row-symbol">{item.symbol}</span>
        <span className="wl-row-name">{item.name}</span>
      </div>

      {/* Right: price + change */}
      <div className="wl-row-right">
        <span className="wl-row-price">
          {item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`wl-row-change${item.isUp ? " up" : " down"}`}>
          {sign}{item.changePct.toFixed(2)}%
        </span>
      </div>

      {/* Remove button (visible on hover via CSS) */}
      <button
        className="wl-row-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`Remove ${item.symbol} from watchlist`}
        tabIndex={-1}
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}

// ── Add symbol panel ──────────────────────────────────────────────────────

function AddSymbolPanel({
  available,
  onAdd,
  onClose,
}: {
  available: string[];
  onAdd: (s: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = available.filter((s) =>
    s.toLowerCase().includes(query.toLowerCase()) ||
    (MOCK_QUOTES[s]?.name ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="wl-add-panel" role="dialog" aria-label="Add symbol to watchlist">
      <div className="wl-add-header">
        <span>Add Symbol</span>
        <button className="wl-add-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <input
        ref={inputRef}
        id="wl-search-input"
        className="wl-add-input"
        type="text"
        placeholder="Search symbol or name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search symbols"
      />
      <div className="wl-add-list" role="listbox" aria-label="Available symbols">
        {filtered.length === 0 && (
          <div className="wl-add-empty">No symbols found</div>
        )}
        {filtered.map((s) => (
          <button
            key={s}
            id={`wl-add-${s}`}
            className="wl-add-option"
            role="option"
            aria-selected="false"
            onClick={() => { onAdd(s); onClose(); }}
          >
            <span className="wl-add-option-symbol">{s}</span>
            <span className="wl-add-option-name">{MOCK_QUOTES[s]?.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────

export default function WatchlistSidebar({
  activeSymbol,
  onSelect,
  isOpen,
  onToggle,
}: WatchlistSidebarProps) {
  const { items, available, addSymbol, removeSymbol, isHydrated } = useWatchlist();
  const [showAddPanel, setShowAddPanel] = useState(false);

  const handleSelect = (symbol: string) => {
    if (symbol !== activeSymbol) onSelect(symbol);
  };

  return (
    <aside
      className={`watchlist-sidebar${isOpen ? " watchlist-sidebar--open" : ""}`}
      aria-label="Watchlist panel"
    >
      {/* ── Collapse/expand toggle ─────────────────────────────────── */}
      <button
        id="wl-toggle-btn"
        className="wl-toggle-btn"
        onClick={onToggle}
        aria-label={isOpen ? "Collapse watchlist" : "Expand watchlist"}
        title={isOpen ? "Collapse" : "Watchlist"}
      >
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none"
          style={{ transform: isOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s ease" }}
          aria-hidden="true"
        >
          <path d="M9 2 L4 7 L9 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!isOpen && <span className="wl-toggle-label">WL</span>}
      </button>

      {/* ── Expanded content ───────────────────────────────────────── */}
      {isOpen && (
        <div className="wl-content">
          {/* Header */}
          <div className="wl-header">
            <span className="wl-header-title">Watchlist</span>
            <span className="wl-header-count" aria-label={`${items.length} symbols`}>
              {isHydrated ? items.length : "—"}
            </span>
            {/* Add button */}
            <button
              id="wl-add-btn"
              className="wl-add-btn"
              onClick={() => setShowAddPanel((v) => !v)}
              disabled={available.length === 0}
              aria-label="Add symbol"
              title="Add symbol"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <rect x="5" y="1" width="2" height="10" rx="1" />
                <rect x="1" y="5" width="10" height="2" rx="1" />
              </svg>
            </button>
          </div>

          {/* Add panel (dropdown) */}
          {showAddPanel && (
            <AddSymbolPanel
              available={available}
              onAdd={addSymbol}
              onClose={() => setShowAddPanel(false)}
            />
          )}

          {/* ── Symbol list ──────────────────────────────────────────── */}
          <div className="wl-list" role="list" aria-label="Watchlist symbols">
            {!isHydrated && (
              <div className="wl-skeleton">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="wl-skeleton-row" aria-hidden="true" />
                ))}
              </div>
            )}
            {isHydrated && items.length === 0 && (
              <div className="wl-empty">
                <p>Your watchlist is empty.</p>
                <p>Click <strong>+</strong> to add symbols.</p>
              </div>
            )}
            {isHydrated &&
              items.map((item) => (
                <WatchlistRow
                  key={item.symbol}
                  item={item}
                  isActive={item.symbol === activeSymbol}
                  onSelect={() => handleSelect(item.symbol)}
                  onRemove={() => removeSymbol(item.symbol)}
                />
              ))}
          </div>

          {/* Footer note */}
          <div className="wl-footer" aria-label="Data note">
            <span className="wl-footer-dot" aria-hidden="true" />
            Prices are static mock data
          </div>
        </div>
      )}
    </aside>
  );
}
