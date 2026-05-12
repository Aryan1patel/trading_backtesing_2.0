"""
data_provider.py — Phase 8 (Fyers integration)

Data source priority for NSE symbols:
  1. Fyers API v3  (primary)  — requires valid access_token from /api/fyers/login
  2. nsepython     (fallback) — NSE EOD daily only
  3. yfinance .NS  (fallback) — all timeframes, chunked to hit yfinance max window

For US symbols:
  yfinance only (no Fyers support for US equities)

Phase 6b swap point:
  Add real-time WebSocket / streaming endpoints here.
  The fetch_candles() signature stays unchanged.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# ── Known NSE symbols (auto-detected when exchange param is omitted) ───────
NSE_SYMBOLS: frozenset[str] = frozenset(
    {
        # Nifty 50 core
        "RELIANCE", "TCS", "INFY", "WIPRO", "HDFCBANK", "ICICIBANK",
        "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "TATAMOTORS",
        "BAJFINANCE", "ASIANPAINT", "MARUTI", "HINDUNILVR", "AXISBANK",
        "ULTRACEMCO", "TITAN", "SUNPHARMA", "NESTLEIND", "LT", "ONGC",
        "NTPC", "TECHM", "POWERGRID", "BAJAJFINSV", "DIVISLAB",
        "DRREDDY", "CIPLA", "COALINDIA", "ADANIENT", "ADANIPORTS",
        "HINDALCO", "JSWSTEEL", "TATASTEEL", "BPCL", "EICHERMOT",
        "APOLLOHOSP", "GRASIM", "HCLTECH", "HEROMOTOCO", "BRITANNIA",
        "SBILIFE", "HDFCLIFE", "UPL", "VEDL", "INDUSINDBK", "M&M",
    }
)

# ── yfinance interval / lookback config per timeframe ─────────────────────
# yfinance hard limits:
#   1m  → max 7 days
#   5m  → max 60 days
#   15m → max 60 days
#   1h  → max 730 days
#
# chunk_days=0 means single-fetch (use start/end date range directly).

_TF_CFG: dict[str, dict] = {
    "1m":  {"interval": "1m",  "max_days": 7,   "chunk_days": 1},
    "5m":  {"interval": "5m",  "max_days": 59,  "chunk_days": 7},
    "15m": {"interval": "15m", "max_days": 59,  "chunk_days": 14},
    "1h":  {"interval": "60m", "max_days": 500, "chunk_days": 0},
    "1D":  {"interval": "1d",  "max_days": 730, "chunk_days": 0},
}

# ── Optional nsepython import ─────────────────────────────────────────────
try:
    from nsepython import equity_history as _nse_equity_history  # type: ignore
    _NSE_PYTHON_OK = True
    logger.info("nsepython loaded ✓")
except Exception as exc:  # noqa: BLE001
    _NSE_PYTHON_OK = False
    logger.warning("nsepython unavailable (%s) — NSE daily will use yfinance", exc)


# ── Helpers ───────────────────────────────────────────────────────────────

def detect_exchange(symbol: str) -> str:
    return "NSE" if symbol.upper() in NSE_SYMBOLS else "US"


def _yf_ticker(symbol: str, exchange: str) -> str:
    return f"{symbol.upper()}.NS" if exchange == "NSE" else symbol.upper()


def _df_to_bars(df: pd.DataFrame, timeframe: str) -> list[dict]:
    bars: list[dict] = []
    for ts, row in df.iterrows():
        try:
            o  = row["Open"]
            h  = row["High"]
            l  = row["Low"]
            c  = row["Close"]
            if any(v is None or pd.isna(v) for v in (o, h, l, c)):
                continue
            o  = round(float(o), 2)
            h  = round(float(h), 2)
            l  = round(float(l), 2)
            c  = round(float(c), 2)
            if o <= 0 or h <= 0:
                continue
            vol = int(row["Volume"]) if not pd.isna(row["Volume"]) else 0
            t: int | str = (
                ts.strftime("%Y-%m-%d") if timeframe == "1D"
                else int(ts.timestamp())
            )
            bars.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": vol})
        except Exception:  # noqa: BLE001
            continue
    return bars


# ── yfinance fetcher (chunked for intraday) ───────────────────────────────

def _fetch_yfinance(symbol: str, timeframe: str, exchange: str) -> list[dict]:
    cfg        = _TF_CFG[timeframe]
    interval   = cfg["interval"]
    max_days   = cfg["max_days"]
    chunk_days = cfg["chunk_days"]
    ticker_sym = _yf_ticker(symbol, exchange)

    ticker = yf.Ticker(ticker_sym)

    # Single-fetch (1h, 1D)
    if chunk_days == 0:
        end_dt   = datetime.now()
        start_dt = end_dt - timedelta(days=max_days)
        logger.debug("yfinance single fetch: %s  interval=%s", ticker_sym, interval)
        df = ticker.history(interval=interval, start=start_dt, end=end_dt, auto_adjust=True)
        if df.empty:
            return []
        return _df_to_bars(df, timeframe)

    # Chunked fetch (1m, 5m, 15m)
    all_bars: dict[int, dict] = {}
    end_dt   = datetime.now()
    start_dt = end_dt - timedelta(days=max_days)
    chunk_end = end_dt

    while chunk_end > start_dt:
        chunk_start = max(chunk_end - timedelta(days=chunk_days), start_dt)
        logger.debug("yfinance chunk: %s  %s → %s", ticker_sym,
                     chunk_start.date(), chunk_end.date())
        try:
            df = ticker.history(interval=interval, start=chunk_start,
                                end=chunk_end, auto_adjust=True)
            if not df.empty:
                for bar in _df_to_bars(df, timeframe):
                    all_bars[bar["time"]] = bar
        except Exception as exc:  # noqa: BLE001
            logger.warning("yfinance chunk failed %s: %s", ticker_sym, exc)
        chunk_end = chunk_start

    if not all_bars:
        return []
    return sorted(all_bars.values(), key=lambda b: b["time"])


# ── nsepython fetcher (NSE daily only) ───────────────────────────────────

def _fetch_nse_daily(symbol: str) -> list[dict] | None:
    if not _NSE_PYTHON_OK:
        return None
    try:
        end_dt   = datetime.now()
        start_dt = end_dt - timedelta(days=730)
        df = _nse_equity_history(
            symbol.upper(), "EQ",
            start_dt.strftime("%d-%m-%Y"),
            end_dt.strftime("%d-%m-%Y"),
        )
        if df is None or df.empty:
            return None
        bars: list[dict] = []
        for _, row in df.iterrows():
            try:
                date_val = row.get("CH_TIMESTAMP") or row.get("Date") or row.get("date")
                t = pd.to_datetime(date_val).strftime("%Y-%m-%d")
                bars.append({
                    "time":   t,
                    "open":   round(float(row.get("CH_OPENING_PRICE")    or row.get("Open",  0)), 2),
                    "high":   round(float(row.get("CH_TRADE_HIGH_PRICE") or row.get("High",  0)), 2),
                    "low":    round(float(row.get("CH_TRADE_LOW_PRICE")  or row.get("Low",   0)), 2),
                    "close":  round(float(row.get("CH_CLOSING_PRICE")    or row.get("Close", 0)), 2),
                    "volume": int(row.get("CH_TOT_TRADED_QTY") or row.get("Volume", 0)),
                })
            except Exception:  # noqa: BLE001
                continue
        return sorted(bars, key=lambda b: b["time"]) if bars else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("nsepython failed for %s: %s", symbol, exc)
        return None


# ── Fyers fetcher ─────────────────────────────────────────────────────────

def _fetch_fyers(symbol: str, timeframe: str) -> list[dict] | None:
    """
    Try Fyers as primary NSE source.
    Returns None (to fall through) on any non-auth failure.
    Raises FyersAuthError if the token is expired — caller logs it and falls through.
    """
    try:
        from routers.fyers_auth import get_access_token
        from services.fyers_provider import FyersAuthError, fetch_fyers_candles
    except ImportError as exc:
        logger.warning("fyers_provider not available: %s", exc)
        return None

    token = get_access_token()
    if not token:
        logger.info("No Fyers token — skipping Fyers fetch for %s/%s", symbol, timeframe)
        return None

    try:
        bars = fetch_fyers_candles(token, symbol, timeframe)
        return bars if bars else None
    except FyersAuthError as exc:
        logger.warning("Fyers auth error (%s) — token expired, falling back to yfinance", exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Fyers fetch failed for %s/%s: %s — falling back", symbol, timeframe, exc)
        return None


# ── Public API ─────────────────────────────────────────────────────────────

def fetch_candles(
    symbol: str,
    timeframe: str,
    exchange: Optional[str] = None,
) -> list[dict]:
    """
    Fetch OHLCV bars using the priority chain:
      NSE:  Fyers (primary) → nsepython (daily only) → yfinance .NS (fallback)
      US:   yfinance only

    Returns bars sorted oldest-first in OHLCBar shape.
    Raises RuntimeError if all sources fail.
    """
    symbol   = symbol.upper()
    exchange = (exchange.upper() if exchange else detect_exchange(symbol))

    logger.info("fetch_candles  symbol=%s  tf=%s  exchange=%s", symbol, timeframe, exchange)

    # ── NSE path ──────────────────────────────────────────────────────────
    if exchange == "NSE":
        # 1. Fyers (primary — all timeframes)
        bars = _fetch_fyers(symbol, timeframe)
        if bars:
            return bars
        logger.info("Fyers unavailable/failed for %s/%s — trying nsepython/yfinance",
                    symbol, timeframe)

        # 2. nsepython (daily only)
        if timeframe == "1D":
            nse_bars = _fetch_nse_daily(symbol)
            if nse_bars:
                return nse_bars
            logger.info("nsepython returned nothing for %s — falling back to yfinance", symbol)

        # 3. yfinance .NS (final fallback)
        bars = _fetch_yfinance(symbol, timeframe, exchange)
        if bars:
            return bars
        raise RuntimeError(
            f"No data returned for {symbol}/{timeframe} from Fyers, nsepython, or yfinance."
        )

    # ── US path ───────────────────────────────────────────────────────────
    bars = _fetch_yfinance(symbol, timeframe, exchange)
    if not bars:
        raise RuntimeError(f"No data returned for {symbol}/{timeframe} from yfinance.")
    return bars
