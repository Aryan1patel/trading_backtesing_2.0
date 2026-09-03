"use client";

import React, { useEffect, useRef, useState } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────

type Status = "idle" | "checking" | "fetching" | "ready" | "error";

interface RangePreset {
  label: string;
  months: number;
}

const RANGE_PRESETS: RangePreset[] = [
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "1 year",   months: 12 },
  { label: "2 years",  months: 24 },
  { label: "5 years",  months: 60 },
];

interface Props {
  symbol: string;
  timeframe: string;
  onClose: () => void;
  onLoadBacktest: (bars: OHLCBar[], symbol: string, timeframe: string, dateFrom: string, dateTo: string) => void;
}

// ── OHLCBar shape ─────────────────────────────────────────────────────────
interface OHLCBar {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Component ─────────────────────────────────────────────────────────────

export default function BacktestPanel({ symbol, timeframe, onClose, onLoadBacktest }: Props) {
  // Form state
  const [sym, setSym]       = useState(symbol);
  const [tf, setTf]         = useState(timeframe);
  const [presetIdx, setPresetIdx] = useState(2); // default: 1 year
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState(toDateStr(new Date()));
  const [useCustom, setUseCustom]   = useState(false);

  // Run state
  const [status, setStatus]         = useState<Status>("idle");
  const [progress, setProgress]     = useState<string[]>([]);
  const [resultMsg, setResultMsg]   = useState("");
  const [errorMsg, setErrorMsg]     = useState("");
  const [barCount, setBarCount]     = useState<number | null>(null);
  const [source, setSource]         = useState<string>("");
  const abortRef = useRef<(() => void) | null>(null);

  // Scroll progress list to bottom on new messages
  const progressRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (progressRef.current)
      progressRef.current.scrollTop = progressRef.current.scrollHeight;
  }, [progress]);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Sync symbol/timeframe if parent changes while panel is open
  useEffect(() => { setSym(symbol); },    [symbol]);
  useEffect(() => { setTf(timeframe); }, [timeframe]);

  // ── Derived dates ────────────────────────────────────────────────────
  const today    = new Date();
  const dateFrom = useCustom
    ? customFrom
    : toDateStr(addMonths(today, RANGE_PRESETS[presetIdx].months));
  const dateTo   = useCustom ? customTo : toDateStr(today);

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "fetching") return;

    setStatus("checking");
    setProgress([]);
    setResultMsg("");
    setErrorMsg("");
    setBarCount(null);
    setSource("");

    let cancelled = false;

    try {
      const resp = await fetch(`${BACKEND}/api/backtest/prepare-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol:    sym.toUpperCase(),
          timeframe: tf,
          date_from: dateFrom,
          date_to:   dateTo,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail ?? "Request failed");
      }

      // SSE stream
      abortRef.current = () => { cancelled = true; };
      setStatus("fetching");

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || cancelled) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const evt = JSON.parse(raw);

            if (evt.type === "progress") {
              setProgress((p) => [...p, evt.message]);
            } else if (evt.type === "done") {
              const r = evt.result;
              setBarCount(r.total_bars_in_range);
              setSource(r.source);
              if (r.source === "cache" && r.fetched_windows === 0) {
                setResultMsg(
                  `Already cached — ${r.total_bars_in_range.toLocaleString()} bars ready instantly.`
                );
              } else {
                setResultMsg(
                  `${r.total_bars_in_range.toLocaleString()} bars cached and ready` +
                  (r.fidelity === "low" ? " (via yfinance fallback)" : " via Fyers") + "."
                );
              }
              setStatus("ready");
            } else if (evt.type === "error") {
              throw new Error(evt.message);
            }
          } catch (parseErr) {
            if ((parseErr as Error).message !== "Unexpected end of JSON input")
              console.warn("SSE parse error:", parseErr);
          }
        }
      }
    } catch (err) {
      if (!cancelled) {
        setErrorMsg((err as Error).message ?? "Unknown error");
        setStatus("error");
      }
    }

    abortRef.current = null;
  };

  const handleCancel = () => {
    abortRef.current?.();
    setStatus("idle");
    setProgress([]);
  };

  const handleLoadChart = async () => {
    try {
      const resp = await fetch(
        `${BACKEND}/api/backtest/query?symbol=${sym}&timeframe=${tf}&date_from=${dateFrom}&date_to=${dateTo}`
      );
      const data = await resp.json();
      onLoadBacktest(data.bars, sym, tf, dateFrom, dateTo);
      onClose();
    } catch (err) {
      setErrorMsg((err as Error).message ?? "Failed to load bars");
      setStatus("error");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="bt-overlay" role="dialog" aria-modal="true" aria-label="Backtest data prep">
      {/* Backdrop */}
      <div className="bt-backdrop" onClick={onClose} aria-hidden="true" />

      <div className="bt-panel">
        {/* Header */}
        <div className="bt-header">
          <div className="bt-header__left">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 10 L4 6.5 L6.5 8.5 L10 3.5 L13 6" stroke="#26a69a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="1" y="11" width="12" height="1.2" rx="0.6" fill="#26a69a" fillOpacity="0.4"/>
            </svg>
            <span className="bt-header__title">Prepare Backtest Data</span>
          </div>
          <button className="bt-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <form className="bt-body" onSubmit={handleSubmit}>
          {/* Symbol + Timeframe row */}
          <div className="bt-row">
            <div className="bt-field">
              <label className="bt-label" htmlFor="bt-symbol">Symbol</label>
              <input
                id="bt-symbol"
                className="bt-input"
                value={sym}
                onChange={(e) => setSym(e.target.value.toUpperCase())}
                placeholder="RELIANCE"
                disabled={status === "fetching"}
              />
            </div>
            <div className="bt-field">
              <label className="bt-label" htmlFor="bt-tf">Timeframe</label>
              <select
                id="bt-tf"
                className="bt-select"
                value={tf}
                onChange={(e) => setTf(e.target.value)}
                disabled={status === "fetching"}
              >
                {["1m", "5m", "15m", "1h", "1D"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date range */}
          <div className="bt-field">
            <label className="bt-label">Date range</label>

            {/* Quick presets */}
            <div className="bt-presets">
              {RANGE_PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  className={`bt-preset${!useCustom && presetIdx === i ? " bt-preset--active" : ""}`}
                  onClick={() => { setPresetIdx(i); setUseCustom(false); }}
                  disabled={status === "fetching"}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={`bt-preset${useCustom ? " bt-preset--active" : ""}`}
                onClick={() => setUseCustom(true)}
                disabled={status === "fetching"}
              >
                Custom
              </button>
            </div>

            {/* Custom date inputs */}
            {useCustom && (
              <div className="bt-date-row">
                <input
                  type="date"
                  className="bt-input bt-date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  max={customTo || toDateStr(today)}
                  disabled={status === "fetching"}
                  aria-label="From date"
                />
                <span className="bt-date-sep">→</span>
                <input
                  type="date"
                  className="bt-input bt-date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  min={customFrom}
                  max={toDateStr(today)}
                  disabled={status === "fetching"}
                  aria-label="To date"
                />
              </div>
            )}

            {/* Date range preview */}
            <p className="bt-date-preview">
              {dateFrom} → {dateTo}
            </p>
          </div>

          {/* Progress area — only shown while running */}
          {(status === "fetching" || status === "checking" || progress.length > 0) && (
            <div className="bt-progress-wrap">
              <div className="bt-progress-list" ref={progressRef}>
                {status === "checking" && progress.length === 0 && (
                  <span className="bt-progress-item bt-progress-item--checking">
                    <span className="bt-spinner" aria-hidden="true" />
                    Checking cache…
                  </span>
                )}
                {progress.map((msg, i) => (
                  <span
                    key={i}
                    className={`bt-progress-item${i === progress.length - 1 && status === "fetching" ? " bt-progress-item--active" : ""}`}
                  >
                    {status === "fetching" && i === progress.length - 1
                      ? <><span className="bt-spinner" aria-hidden="true" />{msg}</>
                      : <><span className="bt-progress-tick" aria-hidden="true">✓</span>{msg}</>
                    }
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Result / error */}
          {status === "ready" && (
            <div className="bt-result bt-result--ok" role="status">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="6" stroke="#26a69a" strokeWidth="1.4"/>
                <path d="M4 7 L6.2 9.2 L10 5" stroke="#26a69a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {resultMsg}
              {source === "cache" && (
                <span className="bt-result__badge">instant</span>
              )}
            </div>
          )}

          {status === "error" && (
            <div className="bt-result bt-result--err" role="alert">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="6" stroke="#ef5350" strokeWidth="1.4"/>
                <path d="M7 4 L7 7.5" stroke="#ef5350" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="7" cy="9.5" r="0.7" fill="#ef5350"/>
              </svg>
              {errorMsg}
            </div>
          )}

          {/* Action buttons */}
          <div className="bt-actions">
            {status === "fetching" ? (
              <button type="button" className="bt-btn bt-btn--cancel" onClick={handleCancel}>
                Cancel
              </button>
            ) : status === "ready" ? (
              <button type="button" className="bt-btn bt-btn--primary" onClick={handleLoadChart}>
                Load Backtest Chart
              </button>
            ) : (
              <>
                <button type="button" className="bt-btn bt-btn--ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bt-btn bt-btn--primary"
                  disabled={status === "checking" || !sym || (!useCustom || (customFrom && customTo)) ? false : true}
                >
                  {status === "checking" ? "Checking…" : "Prepare Data"}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
