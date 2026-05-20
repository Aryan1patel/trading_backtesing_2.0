"""
routers/backtest.py — POST /api/backtest/prepare-data

Triggers ensure_cached() for a given symbol/timeframe/date range.
Streams progress as Server-Sent Events (SSE) so the frontend can show
a live progress bar without polling.

Request body:
  {
    "symbol":    "RELIANCE",
    "timeframe": "5m",
    "date_from": "2025-01-01",   # YYYY-MM-DD
    "date_to":   "2025-12-31"
  }

SSE event stream format:
  data: {"type": "progress", "message": "Batch 2 of 8: 2025-03-12 → 2025-06-19"}
  data: {"type": "progress", "message": "Batch 3 of 8: 2025-06-19 → 2025-09-27"}
  ...
  data: {"type": "done", "result": { ...ensure_cached return dict... }}
  data: {"type": "error", "message": "..."}

Also exposes:
  GET /api/backtest/cache-info?symbol=RELIANCE&timeframe=5m
  GET /api/backtest/query?symbol=RELIANCE&timeframe=5m&date_from=2025-01-01&date_to=2025-03-31
"""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backtest", tags=["Backtest Cache"])

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="backtest_cache")

VALID_TIMEFRAMES = frozenset({"1m", "5m", "15m", "1h", "1D"})

# ── Request model ─────────────────────────────────────────────────────────

class PrepareDataRequest(BaseModel):
    symbol:    str
    timeframe: str
    date_from: str   # "YYYY-MM-DD"
    date_to:   str   # "YYYY-MM-DD"

    @field_validator("timeframe")
    @classmethod
    def validate_tf(cls, v: str) -> str:
        if v not in VALID_TIMEFRAMES:
            raise ValueError(f"timeframe must be one of {sorted(VALID_TIMEFRAMES)}")
        return v

    @field_validator("date_from", "date_to")
    @classmethod
    def validate_date(cls, v: str) -> str:
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("date must be YYYY-MM-DD")
        return v


# ── SSE streaming endpoint ────────────────────────────────────────────────

@router.post(
    "/prepare-data",
    summary="Populate backtest data cache",
    description=(
        "Fetches and stores OHLCV data for the given symbol/timeframe/date range "
        "into a local SQLite cache. Returns an SSE stream of progress events, "
        "ending with a 'done' event containing the final result."
    ),
)
def prepare_data(req: PrepareDataRequest) -> StreamingResponse:
    """
    Streams Server-Sent Events:
      - progress events while fetching missing windows from Fyers/yfinance
      - done event with the final result dict
      - error event on failure
    """
    symbol    = req.symbol.upper()
    timeframe = req.timeframe
    date_from = datetime.strptime(req.date_from, "%Y-%m-%d")
    date_to   = datetime.strptime(req.date_to,   "%Y-%m-%d")

    if date_from >= date_to:
        raise HTTPException(status_code=400, detail="date_from must be before date_to")

    # Limit to avoid absurd requests (10 years of 1m data would be ~3M rows)
    max_days = (date_to - date_from).days
    limits = {"1m": 30, "5m": 365, "15m": 730, "1h": 1825, "1D": 3650}
    if max_days > limits.get(timeframe, 365):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Date range too large for {timeframe}: {max_days} days "
                f"(max {limits[timeframe]} days)"
            ),
        )

    # Queue bridges the blocking thread → async generator
    progress_q: queue.Queue[Optional[str]] = queue.Queue()

    def run_in_thread() -> None:
        from services.backtest_cache import ensure_cached

        def on_progress(msg: str) -> None:
            event = json.dumps({"type": "progress", "message": msg})
            progress_q.put(event)

        try:
            result = ensure_cached(
                symbol, timeframe, date_from, date_to,
                on_progress=on_progress,
            )
            done_event = json.dumps({"type": "done", "result": result})
            progress_q.put(done_event)
        except Exception as exc:
            err_event = json.dumps({"type": "error", "message": str(exc)})
            progress_q.put(err_event)
            logger.exception("ensure_cached failed for %s/%s", symbol, timeframe)
        finally:
            progress_q.put(None)  # sentinel — stream ends

    _executor.submit(run_in_thread)

    def event_generator():
        while True:
            item = progress_q.get()
            if item is None:
                break
            yield f"data: {item}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
        },
    )


# ── Cache info endpoint ───────────────────────────────────────────────────

@router.get("/cache-info", summary="Show what's stored in the backtest cache")
def get_cache_info(
    symbol:    Annotated[str, Query(description="Ticker symbol")],
    timeframe: Annotated[str, Query(description="Bar interval: 1m | 5m | 15m | 1h | 1D")],
) -> dict:
    from services.backtest_cache import cache_info
    return cache_info(symbol.upper(), timeframe)


# ── Query endpoint ────────────────────────────────────────────────────────

@router.get(
    "/query",
    summary="Query bars from backtest cache (no API calls)",
)
def query_bars(
    symbol:    Annotated[str, Query()],
    timeframe: Annotated[str, Query()],
    date_from: Annotated[str, Query(description="YYYY-MM-DD")],
    date_to:   Annotated[str, Query(description="YYYY-MM-DD")],
) -> dict:
    try:
        df = datetime.strptime(date_from, "%Y-%m-%d")
        dt = datetime.strptime(date_to,   "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")

    from services.backtest_cache import query_cache
    bars = query_cache(symbol.upper(), timeframe, df, dt)

    return {
        "symbol":    symbol.upper(),
        "timeframe": timeframe,
        "date_from": date_from,
        "date_to":   date_to,
        "bar_count": len(bars),
        "bars":      bars,
    }
