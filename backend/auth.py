"""Discord-OAuth2-Helfer (Phase 8).

Der komplette OAuth-Flow läuft serverseitig. Das Client Secret bleibt hier im
Backend und wird NIE ans Frontend gegeben. Konfiguration kommt aus der .env:

    DISCORD_CLIENT_ID       Application-ID aus dem Discord Developer Portal
    DISCORD_CLIENT_SECRET   Client Secret (geheim!)
    DISCORD_REDIRECT_URI    exakt wie im Portal registriert,
                            z.B. http://localhost:8000/auth/callback

Scope: nur ``identify`` (liefert user_id + username) — minimal nötig.
"""

from __future__ import annotations

import os
from urllib.parse import urlencode

import httpx

DISCORD_API = "https://discord.com/api"
SCOPE = "identify"
DEFAULT_REDIRECT = "http://localhost:8000/auth/callback"


def _cfg() -> dict:
    return {
        "client_id": os.getenv("DISCORD_CLIENT_ID", ""),
        "client_secret": os.getenv("DISCORD_CLIENT_SECRET", ""),
        "redirect_uri": os.getenv("DISCORD_REDIRECT_URI", DEFAULT_REDIRECT),
    }


def is_configured() -> bool:
    c = _cfg()
    return bool(c["client_id"] and c["client_secret"])


def authorize_url(state: str) -> str:
    """Discord-Authorize-URL, zu der der Login-Endpoint weiterleitet."""
    c = _cfg()
    q = urlencode({
        "client_id": c["client_id"],
        "redirect_uri": c["redirect_uri"],
        "response_type": "code",
        "scope": SCOPE,
        "state": state,
        "prompt": "consent",
    })
    return f"{DISCORD_API}/oauth2/authorize?{q}"


async def exchange_code(code: str) -> dict:
    """Tauscht den Auth-Code gegen ein Token und holt den Discord-User (/users/@me).

    Gibt das User-Objekt zurück (mind. id, username, global_name). Wirft bei Fehler.
    """
    c = _cfg()
    data = {
        "client_id": c["client_id"],
        "client_secret": c["client_secret"],
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": c["redirect_uri"],
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    async with httpx.AsyncClient(timeout=10) as client:
        tok = await client.post(f"{DISCORD_API}/oauth2/token", data=data, headers=headers)
        tok.raise_for_status()
        access = tok.json()["access_token"]
        me = await client.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {access}"},
        )
        me.raise_for_status()
        return me.json()
