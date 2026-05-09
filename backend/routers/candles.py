"""
routers/candles.py — GET /api/candles

Query params:
  symbol    (required) — e.g. AAPL, RELIANCE, TCS
  timeframe (optional, default "1D") — 1m | 5m | 15m | 1h | 1D
  exchange  (optional, auto-detected) — NSE | US

Response matches the frontend's OHLCBar shape exactly:
  { symbol, timeframe, exchange, cached, bars: [{time, open, high, low, close, volume}, ...] }
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.cache import cache
from services.data_provider import detect_exchange, fetch_candles

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────

VALID_TIMEFRAMES = frozenset({"1m", "5m", "15m", "1h", "1D"})

# Cache TTL per timeframe (seconds)
# Intraday TTLs are intentionally longer now that we chunk-fetch 60 days of data —
# we don't want to re-run the chunked fetch on every poll.
CACHE_TTL: dict[str, int] = {
    "1m":  60,        # 1 min — still fast, small window
    "5m":  300,       # 5 min
    "15m": 600,       # 10 min
    "1h":  1_800,     # 30 min
    "1D":  3_600,     # 1 hour
}


# Thread pool for offloading blocking yfinance / nsepython calls
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="data_fetch")

# ── Pydantic response model ────────────────────────────────────────────────

class CandleBar(BaseModel):
    time: int | str   # Unix seconds (intraday) or "YYYY-MM-DD" (daily)
    open: float
    high: float
    low: float
    close: float
    volume: int

class CandlesResponse(BaseModel):
    symbol: str
    timeframe: str
    exchange: str
    cached: bool
    bar_count: int
    bars: list[CandleBar]

# ── Router ────────────────────────────────────────────────────────────────

router = APIRouter()

@router.get(
    "/candles",
    response_model=CandlesResponse,
    summary="OHLCV candle data",
    description=(
        "Returns OHLCV bars for a given symbol and timeframe. "
        "Indian NSE symbols (e.g. RELIANCE, TCS) and US symbols (e.g. AAPL, MSFT) are supported. "
        "Exchange is auto-detected from the symbol if not provided."
    ),
)
async def get_candles(
    symbol: Annotated[
        str,
        Query(description="Ticker symbol — e.g. AAPL, RELIANCE, TCS", min_length=1, max_length=20),
    ],
    timeframe: Annotated[
        str,
        Query(description="Bar interval: 1m | 5m | 15m | 1h | 1D"),
    ] = "1D",
    exchange: Annotated[
        Optional[str],
        Query(description="Force exchange: NSE or US (auto-detected if omitted)"),
    ] = None,
) -> CandlesResponse:
    # ── Validate ──────────────────────────────────────────────────────────
    timeframe = timeframe.strip()
    if timeframe not in VALID_TIMEFRAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid timeframe '{timeframe}'. Must be one of: {sorted(VALID_TIMEFRAMES)}",
        )

    symbol = symbol.strip().upper()
    resolved_exchange = exchange.strip().upper() if exchange else detect_exchange(symbol)
    if resolved_exchange not in ("NSE", "US"):
        raise HTTPException(status_code=400, detail="exchange must be 'NSE' or 'US'")

    # ── Cache check ───────────────────────────────────────────────────────
    cache_key = f"{symbol}:{timeframe}:{resolved_exchange}"
    cached_bars = cache.get(cache_key)

    if cached_bars is not None:
        logger.info("Cache HIT  %s", cache_key)
        return CandlesResponse(
            symbol=symbol,
            timeframe=timeframe,
            exchange=resolved_exchange,
            cached=True,
            bar_count=len(cached_bars),
            bars=cached_bars,
        )

    # ── Fetch (blocking I/O offloaded to thread pool) ─────────────────────
    logger.info("Cache MISS %s — fetching from data source", cache_key)
    loop = asyncio.get_running_loop()
    try:
        bars: list[dict] = await loop.run_in_executor(
            _executor,
            fetch_candles,
            symbol,
            timeframe,
            resolved_exchange,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected error fetching %s/%s", symbol, timeframe)
        raise HTTPException(status_code=502, detail=f"Data source error: {exc}") from exc

    if not bars:
        raise HTTPException(
            status_code=404,
            detail=f"No data available for {symbol} / {timeframe}",
        )

    # ── Cache and return ──────────────────────────────────────────────────
    cache.set(cache_key, bars, CACHE_TTL[timeframe])

    return CandlesResponse(
        symbol=symbol,
        timeframe=timeframe,
        exchange=resolved_exchange,
        cached=False,
        bar_count=len(bars),
        bars=bars,
    )


@router.delete(
    "/candles/cache",
    summary="Flush cache entry (or all)",
    description="Delete a specific cache entry (symbol+timeframe+exchange) or pass flush=true to clear everything.",
)
def flush_cache(
    symbol: Optional[str] = None,
    timeframe: Optional[str] = None,
    exchange: Optional[str] = None,
    flush_all: bool = Query(default=False, alias="flush"),
) -> dict:
    if flush_all:
        removed = cache.clear_expired()
        return {"flushed": "all_expired", "removed": removed}
    if symbol and timeframe and exchange:
        key = f"{symbol.upper()}:{timeframe}:{exchange.upper()}"
        cache.delete(key)
        return {"flushed": key}
    return {"error": "Provide symbol+timeframe+exchange, or ?flush=true"}
