"""
services/backtest_cache.py — SQLite-backed historical data cache for backtesting

Schema:
  candles(symbol, timeframe, timestamp, open, high, low, close, volume)
  PRIMARY KEY (symbol, timeframe, timestamp) — prevents duplicates on re-fetch

Design:
  ensure_cached(symbol, timeframe, date_from, date_to, on_progress=None)
    1. Query SQLite for the covered timestamp range within [date_from, date_to]
    2. Build a list of missing sub-ranges (gaps)
    3. For each gap, fetch from Fyers → nsepython → yfinance (same priority chain)
    4. Insert fetched rows, skipping existing timestamps via INSERT OR IGNORE
    5. Return all bars in range from SQLite (always the source of truth after fill)

  query_cache(symbol, timeframe, date_from, date_to) → list[dict]
    Read-only query — returns bars already stored, sorted oldest-first.

  cache_info(symbol, timeframe) → dict
    Returns coverage summary: earliest/latest stored timestamp, bar count.

Fyers per-request limits (calendar days):
  intraday (1m/5m/15m/1h): 100 days
  daily (1D):               366 days

For a 1-year 5m request we loop through ~4 × 100-day chunks.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Generator, Optional

logger = logging.getLogger(__name__)

# ── DB path ───────────────────────────────────────────────────────────────

_DB_DIR  = Path(__file__).parent.parent / "data"
_DB_PATH = _DB_DIR / "backtest_cache.db"

# ── Fyers per-request day limits ─────────────────────────────────────────

_MAX_DAYS_PER_CHUNK: dict[str, int] = {
    "1m":  100,
    "5m":  100,
    "15m": 100,
    "1h":  100,
    "1D":  366,
}

# ── DB helpers ────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def _db() -> Generator[sqlite3.Connection, None, None]:
    conn = _get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _init_db() -> None:
    """Create the candles table if it doesn't exist."""
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS candles (
                symbol    TEXT    NOT NULL,
                timeframe TEXT    NOT NULL,
                timestamp INTEGER NOT NULL,
                open      REAL    NOT NULL,
                high      REAL    NOT NULL,
                low       REAL    NOT NULL,
                close     REAL    NOT NULL,
                volume    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (symbol, timeframe, timestamp)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_candles_sym_tf_ts
            ON candles (symbol, timeframe, timestamp)
        """)
    logger.info("Backtest SQLite DB ready: %s", _DB_PATH)


# Initialise on import
_init_db()


# ── Gap detection ─────────────────────────────────────────────────────────

def _covered_timestamps(
    symbol: str, timeframe: str, from_ts: int, to_ts: int
) -> set[int]:
    """Return the set of timestamps already stored for this symbol/tf/range."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT timestamp FROM candles "
            "WHERE symbol=? AND timeframe=? AND timestamp>=? AND timestamp<=?",
            (symbol, timeframe, from_ts, to_ts),
        ).fetchall()
    return {r["timestamp"] for r in rows}


def _find_missing_date_ranges(
    symbol: str,
    timeframe: str,
    date_from: datetime,
    date_to: datetime,
    chunk_days: int,
) -> list[tuple[datetime, datetime]]:
    """
    Split [date_from, date_to] into chunk_days-sized windows.
    For each window, check if it's fully covered in SQLite.
    Return only the windows that have no data at all (missing entirely).

    We use whole-window granularity rather than per-bar gaps because:
      - Partial windows (e.g. holiday gaps) would look like missing data
      - Re-fetching a window with existing data is safe (INSERT OR IGNORE)
    """
    missing: list[tuple[datetime, datetime]] = []
    cursor = date_from

    while cursor < date_to:
        window_end = min(cursor + timedelta(days=chunk_days), date_to)

        from_ts = int(cursor.timestamp())
        to_ts   = int(window_end.timestamp())

        covered = _covered_timestamps(symbol, timeframe, from_ts, to_ts)
        if not covered:
            missing.append((cursor, window_end))
        else:
            logger.debug(
                "Window %s→%s already has %d bars in cache",
                cursor.date(), window_end.date(), len(covered),
            )

        cursor = window_end

    return missing


# ── Insert helpers ────────────────────────────────────────────────────────

def _insert_bars(symbol: str, timeframe: str, bars: list[dict]) -> int:
    """
    Insert bars into SQLite. INSERT OR IGNORE skips any that already exist.
    Returns the number of new rows inserted.
    """
    if not bars:
        return 0

    rows = [
        (
            symbol,
            timeframe,
            int(b["time"]) if isinstance(b["time"], (int, float)) else
            int(datetime.strptime(str(b["time"]), "%Y-%m-%d")
                .replace(tzinfo=timezone.utc).timestamp()),
            b["open"], b["high"], b["low"], b["close"], b["volume"],
        )
        for b in bars
    ]

    with _db() as conn:
        before = conn.execute(
            "SELECT COUNT(*) FROM candles WHERE symbol=? AND timeframe=?",
            (symbol, timeframe),
        ).fetchone()[0]

        conn.executemany(
            "INSERT OR IGNORE INTO candles "
            "(symbol, timeframe, timestamp, open, high, low, close, volume) "
            "VALUES (?,?,?,?,?,?,?,?)",
            rows,
        )

        after = conn.execute(
            "SELECT COUNT(*) FROM candles WHERE symbol=? AND timeframe=?",
            (symbol, timeframe),
        ).fetchone()[0]

    inserted = after - before
    return inserted


# ── Fyers fetch for arbitrary date range ─────────────────────────────────

def _fetch_range_fyers(
    symbol: str,
    timeframe: str,
    date_from: datetime,
    date_to: datetime,
) -> list[dict]:
    """Fetch a single date-range window from Fyers (reuses _fetch_chunk)."""
    try:
        from routers.fyers_auth import get_access_token
        from services.fyers_provider import FyersAuthError, _fetch_chunk, _TF_TO_RESOLUTION, to_fyers_symbol
    except ImportError as exc:
        logger.warning("fyers_provider import failed: %s", exc)
        return []

    from dotenv import load_dotenv
    load_dotenv()
    client_id    = os.environ.get("FYERS_CLIENT_ID", "")
    access_token = get_access_token()

    if not access_token or not client_id:
        raise RuntimeError("Fyers not authenticated")

    resolution   = _TF_TO_RESOLUTION.get(timeframe)
    if not resolution:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    fyers_symbol = to_fyers_symbol(symbol)

    try:
        bars = _fetch_chunk(
            access_token, client_id, fyers_symbol,
            resolution, date_from, date_to,
        )
        return bars
    except FyersAuthError:
        raise
    except Exception as exc:
        logger.warning("Fyers chunk %s→%s failed: %s", date_from.date(), date_to.date(), exc)
        return []


# ── Fallback: yfinance for arbitrary date range ───────────────────────────

def _fetch_range_yfinance(
    symbol: str,
    timeframe: str,
    date_from: datetime,
    date_to: datetime,
) -> list[dict]:
    """Fallback fetch from yfinance for a specific date window."""
    import pandas as pd
    import yfinance as yf

    _TF_YF = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "60m", "1D": "1d"}
    interval = _TF_YF.get(timeframe)
    if not interval:
        return []

    exchange   = "NSE" if symbol.upper() in _get_nse_symbols() else "US"
    ticker_sym = f"{symbol.upper()}.NS" if exchange == "NSE" else symbol.upper()

    try:
        ticker = yf.Ticker(ticker_sym)
        df = ticker.history(
            interval=interval,
            start=date_from.strftime("%Y-%m-%d"),
            end=date_to.strftime("%Y-%m-%d"),
            auto_adjust=True,
        )
        if df.empty:
            return []
    except Exception as exc:
        logger.warning("yfinance fetch failed %s: %s", ticker_sym, exc)
        return []

    bars: list[dict] = []
    for ts, row in df.iterrows():
        try:
            o = round(float(row["Open"]),  2)
            h = round(float(row["High"]),  2)
            l = round(float(row["Low"]),   2)
            c = round(float(row["Close"]), 2)
            if o <= 0 or h <= 0 or any(pd.isna(v) for v in (o, h, l, c)):
                continue
            vol = int(row["Volume"]) if not pd.isna(row["Volume"]) else 0
            t = ts.strftime("%Y-%m-%d") if timeframe == "1D" else int(ts.timestamp())
            bars.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": vol})
        except Exception:
            continue
    return bars


def _get_nse_symbols() -> frozenset:
    try:
        from services.data_provider import NSE_SYMBOLS
        return NSE_SYMBOLS
    except Exception:
        return frozenset()


# ── Public API ────────────────────────────────────────────────────────────

def ensure_cached(
    symbol: str,
    timeframe: str,
    date_from: datetime,
    date_to: datetime,
    on_progress: Optional[Callable[[str], None]] = None,
) -> dict:
    """
    Ensure [date_from, date_to] is fully populated in SQLite for symbol/timeframe.

    Strategy:
      1. Split the range into chunk_days windows
      2. Skip windows already in SQLite (has ≥1 bar → treat as covered)
      3. For missing windows: try Fyers first, fall back to yfinance
      4. INSERT OR IGNORE new bars
      5. Return summary dict

    on_progress: optional callback(message: str) for streaming progress updates.

    Returns:
      {
        "symbol": str, "timeframe": str,
        "date_from": str, "date_to": str,
        "total_windows": int, "fetched_windows": int, "skipped_windows": int,
        "new_bars_inserted": int, "total_bars_in_range": int,
        "source": "fyers" | "yfinance" | "mixed" | "cache",
        "fidelity": "high" | "low",   # high = Fyers, low = fallback
      }
    """
    symbol    = symbol.upper()
    chunk_days = _MAX_DAYS_PER_CHUNK.get(timeframe, 100)

    # Normalise datetimes to UTC midnight
    date_from = date_from.replace(hour=0,  minute=0,  second=0, microsecond=0,
                                   tzinfo=timezone.utc)
    date_to   = date_to.replace(  hour=23, minute=59, second=59, microsecond=0,
                                   tzinfo=timezone.utc)

    logger.info(
        "ensure_cached  symbol=%s  tf=%s  %s → %s  chunk=%dd",
        symbol, timeframe, date_from.date(), date_to.date(), chunk_days,
    )

    # ── Find missing windows ──────────────────────────────────────────────
    missing_windows = _find_missing_date_ranges(
        symbol, timeframe, date_from, date_to, chunk_days
    )
    total_windows   = ((date_to - date_from).days // chunk_days) + 1
    skipped         = total_windows - len(missing_windows)

    if not missing_windows:
        total_in_range = _count_in_range(symbol, timeframe, date_from, date_to)
        msg = f"Fully cached — {total_in_range} bars, zero API calls"
        logger.info(msg)
        if on_progress:
            on_progress(msg)
        return {
            "symbol": symbol, "timeframe": timeframe,
            "date_from": date_from.date().isoformat(),
            "date_to":   date_to.date().isoformat(),
            "total_windows": total_windows, "fetched_windows": 0,
            "skipped_windows": skipped,
            "new_bars_inserted": 0, "total_bars_in_range": total_in_range,
            "source": "cache", "fidelity": "high",
        }

    # ── Check Fyers availability ──────────────────────────────────────────
    fyers_ok  = _fyers_available()
    source_used: set[str] = set()
    total_inserted = 0

    for i, (win_from, win_to) in enumerate(missing_windows, start=1):
        batch_msg = (
            f"Batch {i} of {len(missing_windows)}: "
            f"{win_from.date()} → {win_to.date()}"
        )
        logger.info(batch_msg)
        if on_progress:
            on_progress(batch_msg)

        bars: list[dict] = []

        # 1. Try Fyers
        if fyers_ok:
            try:
                bars = _fetch_range_fyers(symbol, timeframe, win_from, win_to)
                if bars:
                    source_used.add("fyers")
            except RuntimeError:
                fyers_ok = False   # token gone mid-run
                logger.warning("Fyers token expired mid-batch — switching to yfinance")
            except Exception as exc:
                logger.warning("Fyers batch failed: %s", exc)

        # 2. Fall back to yfinance
        if not bars:
            logger.info("Falling back to yfinance for %s→%s", win_from.date(), win_to.date())
            bars = _fetch_range_yfinance(symbol, timeframe, win_from, win_to)
            if bars:
                source_used.add("yfinance")

        if bars:
            n = _insert_bars(symbol, timeframe, bars)
            total_inserted += n
            logger.info("  Inserted %d new bars (skipped %d duplicates)", n, len(bars) - n)
        else:
            logger.warning("  No data returned for window %s→%s", win_from.date(), win_to.date())

    # ── Final count ───────────────────────────────────────────────────────
    total_in_range = _count_in_range(symbol, timeframe, date_from, date_to)

    if len(source_used) > 1:
        source_label = "mixed"
    elif source_used:
        source_label = next(iter(source_used))
    else:
        source_label = "cache"

    fidelity = "high" if source_label in ("fyers", "cache") else "low"

    if fidelity == "low":
        logger.warning(
            "Cache filled via %s (not Fyers) — data may be lower fidelity",
            source_label,
        )

    done_msg = (
        f"Done — {total_in_range} bars in range, "
        f"{total_inserted} new rows inserted, source={source_label}"
    )
    logger.info(done_msg)
    if on_progress:
        on_progress(done_msg)

    return {
        "symbol": symbol, "timeframe": timeframe,
        "date_from": date_from.date().isoformat(),
        "date_to":   date_to.date().isoformat(),
        "total_windows": total_windows,
        "fetched_windows": len(missing_windows),
        "skipped_windows": skipped,
        "new_bars_inserted": total_inserted,
        "total_bars_in_range": total_in_range,
        "source": source_label,
        "fidelity": fidelity,
    }


def query_cache(
    symbol: str,
    timeframe: str,
    date_from: datetime,
    date_to: datetime,
) -> list[dict]:
    """
    Return bars from SQLite for symbol/timeframe in [date_from, date_to].
    Sorted oldest-first. Does NOT trigger any API calls.
    """
    from_ts = int(date_from.replace(tzinfo=timezone.utc).timestamp())
    to_ts   = int(date_to.replace(  tzinfo=timezone.utc).timestamp())

    with _db() as conn:
        rows = conn.execute(
            "SELECT timestamp, open, high, low, close, volume "
            "FROM candles "
            "WHERE symbol=? AND timeframe=? AND timestamp>=? AND timestamp<=? "
            "ORDER BY timestamp ASC",
            (symbol.upper(), timeframe, from_ts, to_ts),
        ).fetchall()

    return [
        {
            "time":   r["timestamp"],
            "open":   r["open"],
            "high":   r["high"],
            "low":    r["low"],
            "close":  r["close"],
            "volume": r["volume"],
        }
        for r in rows
    ]


def cache_info(symbol: str, timeframe: str) -> dict:
    """Summary of what's stored for a given symbol/timeframe."""
    symbol = symbol.upper()
    with _db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) as cnt, MIN(timestamp) as earliest, MAX(timestamp) as latest "
            "FROM candles WHERE symbol=? AND timeframe=?",
            (symbol, timeframe),
        ).fetchone()

    cnt      = row["cnt"] or 0
    earliest = row["earliest"]
    latest   = row["latest"]

    return {
        "symbol":    symbol,
        "timeframe": timeframe,
        "bar_count": cnt,
        "earliest":  datetime.fromtimestamp(earliest, tz=timezone.utc).isoformat() if earliest else None,
        "latest":    datetime.fromtimestamp(latest,   tz=timezone.utc).isoformat() if latest   else None,
        "db_path":   str(_DB_PATH),
    }


# ── Internal helpers ──────────────────────────────────────────────────────

def _count_in_range(symbol: str, timeframe: str, date_from: datetime, date_to: datetime) -> int:
    from_ts = int(date_from.timestamp())
    to_ts   = int(date_to.timestamp())
    with _db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM candles "
            "WHERE symbol=? AND timeframe=? AND timestamp>=? AND timestamp<=?",
            (symbol, timeframe, from_ts, to_ts),
        ).fetchone()
    return row[0] if row else 0


def _fyers_available() -> bool:
    try:
        from routers.fyers_auth import get_access_token
        return bool(get_access_token())
    except Exception:
        return False
