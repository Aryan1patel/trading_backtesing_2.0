"""
cache.py — simple in-memory TTL cache.

Phase 7 / accounts swap point:
  Replace TTLCache with a Redis client (e.g. aioredis) for multi-process sharing.
  The interface (get / set / clear_expired) stays the same.
"""

import time
import threading
from typing import Any, Optional


class TTLCache:
    """Thread-safe in-memory key-value cache with per-entry TTL."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expiry = entry
            if time.monotonic() > expiry:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        with self._lock:
            self._store[key] = (value, time.monotonic() + ttl_seconds)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear_expired(self) -> int:
        """Evict all expired entries. Returns count removed."""
        now = time.monotonic()
        with self._lock:
            stale = [k for k, (_, exp) in self._store.items() if now > exp]
            for k in stale:
                del self._store[k]
        return len(stale)

    def size(self) -> int:
        with self._lock:
            return len(self._store)


# Singleton — imported by the router
cache = TTLCache()
