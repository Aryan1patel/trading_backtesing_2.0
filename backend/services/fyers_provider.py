"""
services/fyers_provider.py — Fyers API v3 historical data provider

Handles:
  - Mapping plain NSE symbols (RELIANCE) → Fyers format (NSE:RELIANCE-EQ)
  - Mapping our timeframe strings → Fyers resolution values
  - Rolling date-range fetches to stay within Fyers' 100-day intraday limit
  - Detecting auth errors (-8/-15/-16/-17) and raising FyersAuthError
  - Returning bars in the same OHLCBar shape as the rest of the app

Fyers candle response format:
  {
    "s": "ok",
    "candles": [
      [epoch_seconds, open, high, low, close, volume],
      ...
    ]
  }
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── Auth error codes Fyers returns when token is expired / invalid ────────
FYERS_AUTH_ERROR_CODES = {-8, -15, -16, -17}


class FyersAuthError(Exception):
    """Raised when Fyers returns an auth error — caller should prompt re-login."""


# ── Timeframe → Fyers resolution mapping ─────────────────────────────────
# Fyers resolution values for historical data:
#   Minutes: 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 120, 180, 240
#   Daily:   "D"
#   Weekly:  "W"
#   Monthly: "M"

_TF_TO_RESOLUTION: dict[str, str] = {
    "1m":  "1",
    "5m":  "5",
    "15m": "15",
    "1h":  "60",
    "1D":  "D",
}

# Max calendar days per single Fyers history request
# (Fyers allows 100 days for intraday, 366 days for D/W/M)
_MAX_DAYS_PER_REQUEST: dict[str, int] = {
    "1m":  100,
    "5m":  100,
    "15m": 100,
    "1h":  100,
    "1D":  366,
}

# Total lookback we want (matches / exceeds what we had with yfinance)
_TOTAL_LOOKBACK_DAYS: dict[str, int] = {
    "1m":  7,    # keep small — 1m data is large
    "5m":  90,   # ~3 months (well beyond yfinance's 60-day cap)
    "15m": 90,
    "1h":  365,
    "1D":  730,
}

_FYERS_API_BASE = "https://api-t1.fyers.in/api/v3"


# ── Symbol formatting ─────────────────────────────────────────────────────

def to_fyers_symbol(symbol: str) -> str:
    """
    Convert a plain NSE symbol to Fyers format.
    e.g.  RELIANCE  →  NSE:RELIANCE-EQ
          NIFTY50   →  NSE:NIFTY50-INDEX  (indices stay as-is)
    """
    symbol = symbol.upper().strip()
    # Already formatted
    if ":" in symbol:
        return symbol
    # Indices don't get -EQ
    indices = {"NIFTY50", "BANKNIFTY", "NIFTYIT", "NIFTYMIDCAP50"}
    if symbol in indices:
        return f"NSE:{symbol}-INDEX"
    return f"NSE:{symbol}-EQ"


# ── Single chunk fetch ────────────────────────────────────────────────────

def _fetch_chunk(
    access_token: str,
    client_id: str,
    fyers_symbol: str,
    resolution: str,
    date_from: datetime,
    date_to: datetime,
) -> list[dict]:
    """
    Fetch a single date-range chunk from Fyers /data/history.
    Returns a list of bar dicts: {time, open, high, low, close, volume}
    Raises FyersAuthError on auth failure.

    Authorization header format: "client_id:access_token" (NOT Bearer)
    date_format=1 → range_from/range_to are "yyyy-mm-dd" strings
    Response candles: [epoch_seconds, open, high, low, close, volume]
    """
    # Fyers requires "app_id:access_token" — not Bearer, not token alone
    headers = {
        "Authorization": f"{client_id}:{access_token}",
    }
    params = {
        "symbol":      fyers_symbol,
        "resolution":  resolution,
        "date_format": "1",                              # use yyyy-mm-dd strings
        "range_from":  date_from.strftime("%Y-%m-%d"),  # string date, not epoch
        "range_to":    date_to.strftime("%Y-%m-%d"),    # string date, not epoch
        "cont_flag":   "1",
    }

    logger.debug(
        "Fyers fetch chunk: %s  res=%s  %s → %s",
        fyers_symbol, resolution,
        date_from.strftime("%Y-%m-%d"),
        date_to.strftime("%Y-%m-%d"),
    )

    try:
        resp = requests.get(
            "https://api-t1.fyers.in/data/history",
            headers=headers,
            params=params,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        logger.warning("Fyers HTTP error: %s", exc)
        raise

    # Check for auth errors
    code = data.get("code", 0)
    if isinstance(code, int) and code in FYERS_AUTH_ERROR_CODES:
        logger.warning("Fyers auth error code %d — token expired or invalid", code)
        raise FyersAuthError(f"Fyers auth error {code}: {data.get('message', '')}")

    if data.get("s") not in ("ok", "no_data"):
        logger.warning("Fyers returned non-ok status: %s", data)
        return []

    candles = data.get("candles", [])
    if not candles:
        return []

    bars: list[dict] = []
    for c in candles:
        try:
            epoch, o, h, l, cl, vol = c[0], c[1], c[2], c[3], c[4], c[5]
            # Skip zero/invalid bars
            if o <= 0 or h <= 0:
                continue
            bars.append({
                "time":   epoch,          # already epoch seconds
                "open":   round(float(o),  2),
                "high":   round(float(h),  2),
                "low":    round(float(l),  2),
                "close":  round(float(cl), 2),
                "volume": int(vol),
            })
        except (IndexError, TypeError, ValueError):
            continue

    return bars


# ── Public API ────────────────────────────────────────────────────────────

def fetch_fyers_candles(
    access_token: str,
    symbol: str,
    timeframe: str,
) -> list[dict]:
    """
    Fetch the maximum available history for a symbol/timeframe from Fyers.

    Uses rolling date-range windows to stay within Fyers' per-request limit.
    Deduplicates by timestamp and returns bars sorted oldest-first.

    Raises:
      FyersAuthError  — token expired / invalid (caller should prompt re-login)
      RuntimeError    — no data returned
    """
    import os
    from dotenv import load_dotenv
    load_dotenv()
    client_id = os.environ["FYERS_CLIENT_ID"]

    if timeframe not in _TF_TO_RESOLUTION:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    resolution   = _TF_TO_RESOLUTION[timeframe]
    fyers_symbol = to_fyers_symbol(symbol)
    max_per_req  = _MAX_DAYS_PER_REQUEST[timeframe]
    total_days   = _TOTAL_LOOKBACK_DAYS[timeframe]
    is_daily     = timeframe == "1D"

    now      = datetime.now(tz=timezone.utc)
    end_dt   = now
    start_dt = now - timedelta(days=total_days)

    all_bars: dict[int, dict] = {}   # keyed by timestamp for dedup

    # Walk backwards in max_per_req-day windows
    chunk_end = end_dt
    while chunk_end > start_dt:
        chunk_start = max(chunk_end - timedelta(days=max_per_req), start_dt)

        try:
            chunk_bars = _fetch_chunk(
                access_token, client_id, fyers_symbol, resolution,
                chunk_start, chunk_end
            )
        except FyersAuthError:
            raise   # propagate auth errors immediately
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Fyers chunk failed for %s %s→%s: %s",
                fyers_symbol,
                chunk_start.strftime("%Y-%m-%d"),
                chunk_end.strftime("%Y-%m-%d"),
                exc,
            )
            chunk_end = chunk_start
            continue

        for bar in chunk_bars:
            all_bars[bar["time"]] = bar

        chunk_end = chunk_start

        # For daily resolution one chunk is enough (366 days covers it)
        if is_daily:
            break

    if not all_bars:
        logger.warning("Fyers returned no bars for %s / %s", symbol, timeframe)
        return []

    # Sort oldest → newest
    sorted_bars = sorted(all_bars.values(), key=lambda b: b["time"])

    # For daily bars: convert epoch timestamps to "YYYY-MM-DD" strings
    # (to match the shape nsepython/yfinance daily bars use)
    if is_daily:
        for bar in sorted_bars:
            bar["time"] = datetime.fromtimestamp(
                bar["time"], tz=timezone.utc
            ).strftime("%Y-%m-%d")

    logger.info(
        "Fyers returned %d bars for %s / %s (source: Fyers)",
        len(sorted_bars), symbol, timeframe,
    )
    return sorted_bars
