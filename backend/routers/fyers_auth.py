"""
routers/fyers_auth.py — Fyers OAuth2 login flow

Endpoints:
  GET /api/fyers/login      → redirects browser to Fyers auth page
  GET /api/fyers/callback   → receives auth_code, exchanges for access_token
  GET /api/fyers/status     → shows whether a valid token is currently stored
  DELETE /api/fyers/logout  → clears the stored token

Auth flow (Fyers API v3, no refresh tokens as of April 2026):
  1. User visits /api/fyers/login  → backend builds auth URL → redirects
  2. Fyers redirects to REDIRECT_URI with ?auth_code=...&state=...
  3. Backend catches it at /api/fyers/callback, computes appIdHash
     (SHA-256 of "client_id:secret_key"), POSTs to /api/v3/validate-authcode
  4. Token stored in fyers_token.json (gitignored) + in-memory cache
  5. On expiry (error codes -8/-15/-16/-17), callers call needs_reauth()
     which returns True — frontend should prompt user to visit /api/fyers/login

The REDIRECT_URI must exactly match what's registered in the Fyers API portal.
The default value in .env points to Fyers' own hosted redirect page which
echoes the auth_code back in the URL fragment — the user copies that URL and
our /api/fyers/callback?auth_code=XXX endpoint can also be called manually.

For a cleaner flow, register http://localhost:8000/api/fyers/callback in the
Fyers portal and the browser will land directly on this endpoint.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import time
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse

load_dotenv()

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────

CLIENT_ID    = os.environ["FYERS_CLIENT_ID"]
SECRET_KEY   = os.environ["FYERS_SECRET_KEY"]
REDIRECT_URI = os.environ["FYERS_REDIRECT_URI"]

# Token persisted to disk so server restarts don't require re-auth
_TOKEN_FILE = Path(__file__).parent.parent / "fyers_token.json"

# Fyers API v3 base
_FYERS_API_BASE   = "https://api-t1.fyers.in/api/v3"
_FYERS_AUTH_BASE  = "https://api-t1.fyers.in/api/v3"

# Error codes Fyers returns when the token is invalid / expired
FYERS_AUTH_ERROR_CODES = {-8, -15, -16, -17}

# ── In-memory token store ─────────────────────────────────────────────────
# Populated on startup (load from file) and on successful callback.

_token_store: dict = {}   # {"access_token": str, "stored_at": float}


def _load_token_from_disk() -> None:
    """Load token from fyers_token.json on startup if it exists."""
    global _token_store
    if _TOKEN_FILE.exists():
        try:
            _token_store = json.loads(_TOKEN_FILE.read_text())
            logger.info("Fyers token loaded from disk (stored_at=%s)",
                        time.strftime("%Y-%m-%d %H:%M:%S",
                                      time.localtime(_token_store.get("stored_at", 0))))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not read fyers_token.json: %s", exc)
            _token_store = {}


def _save_token_to_disk(token: str) -> None:
    global _token_store
    _token_store = {"access_token": token, "stored_at": time.time()}
    try:
        _TOKEN_FILE.write_text(json.dumps(_token_store, indent=2))
        logger.info("Fyers access_token saved to disk")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not write fyers_token.json: %s", exc)


def get_access_token() -> Optional[str]:
    """Return the stored access_token, or None if none is available."""
    return _token_store.get("access_token")


def needs_reauth() -> bool:
    """True when no token is stored."""
    return not bool(_token_store.get("access_token"))


def clear_token() -> None:
    global _token_store
    _token_store = {}
    if _TOKEN_FILE.exists():
        _TOKEN_FILE.unlink()
    logger.info("Fyers token cleared")


# Load on import (module-level side effect is safe here)
_load_token_from_disk()

# ── Router ────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/fyers", tags=["Fyers Auth"])

# One-time CSRF state — regenerated each time /login is hit
_pending_state: str = ""


@router.get("/login", summary="Redirect to Fyers auth page")
def fyers_login():
    """
    Redirects the browser to the Fyers OAuth2 authorisation page.
    After the user logs in, Fyers redirects back to REDIRECT_URI with
    ?auth_code=...&state=...
    """
    global _pending_state
    _pending_state = secrets.token_hex(16)

    auth_url = (
        f"https://api-t1.fyers.in/api/v3/generate-authcode"
        f"?client_id={CLIENT_ID}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&response_type=code"
        f"&state={_pending_state}"
    )
    logger.info("Redirecting to Fyers auth URL (state=%s)", _pending_state)
    return RedirectResponse(url=auth_url)


@router.get("/callback", summary="Fyers OAuth2 callback — exchange auth_code for access_token")
def fyers_callback(
    auth_code: str = Query(..., description="auth_code returned by Fyers"),
    state: Optional[str] = Query(None),
):
    """
    Called by Fyers after the user authorises.
    Computes appIdHash = SHA-256(client_id:secret_key), calls
    /api/v3/validate-authcode, stores the returned access_token.
    """
    # Validate CSRF state when present
    if state and _pending_state and state != _pending_state:
        raise HTTPException(status_code=400, detail="Invalid state parameter (CSRF check failed)")

    # Compute appIdHash
    app_id_hash = hashlib.sha256(f"{CLIENT_ID}:{SECRET_KEY}".encode()).hexdigest()

    payload = {
        "grant_type": "authorization_code",
        "appIdHash":  app_id_hash,
        "code":       auth_code,
    }

    try:
        resp = requests.post(
            f"{_FYERS_API_BASE}/validate-authcode",
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        logger.error("Fyers validate-authcode request failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Fyers API error: {exc}") from exc

    if data.get("s") != "ok" or not data.get("access_token"):
        logger.error("Fyers validate-authcode returned error: %s", data)
        raise HTTPException(
            status_code=401,
            detail=f"Fyers rejected auth_code: {data.get('message', data)}",
        )

    access_token = data["access_token"]
    _save_token_to_disk(access_token)
    logger.info("Fyers access_token obtained and stored successfully")

    return HTMLResponse(content="""
    <html><body style="font-family:sans-serif;padding:40px;background:#0f1117;color:#d1d4dc">
      <h2 style="color:#26a69a">✓ Fyers login successful</h2>
      <p>Your access token has been stored. You can close this tab.</p>
      <p style="color:#758696;font-size:12px">Token is valid until market close today. 
         Visit <code>/api/fyers/login</code> tomorrow to re-authenticate.</p>
    </body></html>
    """)


@router.get("/status", summary="Check Fyers token status")
def fyers_status():
    """Returns whether a Fyers access_token is currently stored."""
    token = get_access_token()
    if not token:
        return {"authenticated": False, "message": "No token stored. Visit /api/fyers/login"}

    stored_at = _token_store.get("stored_at", 0)
    age_hours  = (time.time() - stored_at) / 3600

    return {
        "authenticated": True,
        "stored_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stored_at)),
        "age_hours": round(age_hours, 2),
        "token_preview": f"{token[:8]}...{token[-4:]}",
        "note": "Fyers tokens expire daily. Re-login at /api/fyers/login if data calls fail.",
    }


@router.delete("/logout", summary="Clear stored Fyers token")
def fyers_logout():
    """Removes the stored access_token from memory and disk."""
    clear_token()
    return {"cleared": True, "message": "Token removed. Visit /api/fyers/login to re-authenticate."}
