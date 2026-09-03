"""
main.py — ChartLens FastAPI backend (Phase 6a)

Run:
  source venv/bin/activate
  uvicorn main:app --reload --port 8000

Swagger UI:  http://localhost:8000/docs
ReDoc:       http://localhost:8000/redoc
"""

from __future__ import annotations

import logging
import sys
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routers import candles as candles_router
from routers import fyers_auth as fyers_auth_router
from routers import backtest as backtest_router
from services.cache import cache
from services.data_provider import _NSE_PYTHON_OK  # noqa: PLC2701

# ── Logging ───────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("chartlens")

# ── Lifespan (startup / shutdown) ─────────────────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("─" * 50)
    logger.info("ChartLens backend starting up")
    logger.info("nsepython available: %s", _NSE_PYTHON_OK)
    # Report Fyers token status at startup
    try:
        from routers.fyers_auth import get_access_token, needs_reauth
        if needs_reauth():
            logger.warning("No Fyers token found — visit /api/fyers/login to authenticate")
        else:
            token = get_access_token()
            logger.info("Fyers token loaded ✓  (%s...%s)", token[:8], token[-4:])  # type: ignore[index]
    except Exception:  # noqa: BLE001
        pass
    logger.info("─" * 50)
    yield
    # Cleanup on shutdown
    logger.info("Shutting down — evicting stale cache entries")
    removed = cache.clear_expired()
    logger.info("Removed %d expired cache entries", removed)

# ── App ───────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ChartLens Backend",
    version="0.1.0",
    description=(
        "FastAPI backend for ChartLens charting app. "
        "Fetches OHLCV candle data for US stocks (via yfinance) and "
        "Indian NSE stocks (via nsepython + yfinance .NS). "
        "Responses match the `OHLCBar` shape used by the Next.js frontend."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────
# CORS_ORIGINS env var: comma-separated list of allowed origins.
# Set this on Render to include your Vercel frontend URL.
# e.g. CORS_ORIGINS=https://your-app.vercel.app,http://localhost:3000

import os as _os

_cors_env = _os.environ.get("CORS_ORIGINS", "")
_extra_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    *_extra_origins,
]

logger.info("CORS allowed origins: %s", ALLOWED_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Request timing middleware ─────────────────────────────────────────────

@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
    return response

# ── Routers ───────────────────────────────────────────────────────────────

app.include_router(candles_router.router, prefix="/api", tags=["Candles"])
app.include_router(fyers_auth_router.router, tags=["Fyers Auth"])
app.include_router(backtest_router.router, tags=["Backtest Cache"])

# ── Built-in endpoints ────────────────────────────────────────────────────

@app.get("/api/health", tags=["Meta"], summary="Health check")
def health() -> dict:
    """Quick liveness probe."""
    from routers.fyers_auth import needs_reauth
    return {
        "status": "ok",
        "version": "0.1.0",
        "cache_entries": cache.size(),
        "nsepython": _NSE_PYTHON_OK,
        "fyers_authenticated": not needs_reauth(),
    }


@app.get("/api/info", tags=["Meta"], summary="Supported symbols / timeframes")
def info() -> dict:
    from services.data_provider import NSE_SYMBOLS
    from routers.fyers_auth import needs_reauth
    return {
        "valid_timeframes": ["1m", "5m", "15m", "1h", "1D"],
        "auto_detected_nse_symbols": sorted(NSE_SYMBOLS),
        "nse_data_source_priority": [
            "Fyers API v3 (primary — requires /api/fyers/login)",
            "nsepython (daily only fallback)",
            "yfinance .NS (final fallback)",
        ],
        "fyers_authenticated": not needs_reauth(),
        "fyers_login_url": "/api/fyers/login",
        "notes": {
            "us_source": "yfinance only",
            "fyers_intraday_lookback": "90 days (5m/15m), 365 days (1h)",
            "yfinance_intraday_lookback": "60 days (5m/15m), 500 days (1h)",
        },
    }


@app.get("/api/symbols", tags=["Meta"], summary="Authoritative NSE symbol list")
def symbols() -> dict:
    """
    Single source of truth for NSE symbols.

    The frontend calls this once at startup to know which symbols trade
    in INR — used by paper trading (currency classification) and the
    watchlist (price source hints).  Eliminates the need to duplicate
    the NSE list in client-side code.
    """
    from services.data_provider import NSE_SYMBOLS
    return {"nse_symbols": sorted(NSE_SYMBOLS)}


# ── Dev entry point ───────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
