"""RuckZUG Cards — Web-Backend (FastAPI).

Phase 0:  Grundgerüst mit /health.
Phase 3a: serverseitiges Pack-Öffnen (Cheat-Schutz: Würfeln nur im Backend).
Phase 8:  Discord-OAuth. Der eingeloggte User kommt aus der SESSION (signiertes
          HttpOnly-Cookie), NICHT mehr als Parameter vom Client.

Sicherheit:
- OAuth-Flow komplett serverseitig; Client Secret nur im Backend (auth.py).
- Session via Starlette SessionMiddleware -> signiertes, HttpOnly-Cookie
  (SameSite=lax). Schlüssel aus SESSION_SECRET (.env).
- open-pack/collection lesen die user_id aus der Session (401 wenn nicht eingeloggt).

Lokal starten (aus dem backend-Ordner):  uvicorn main:app --reload
"""

from __future__ import annotations

import os
import secrets

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

import auth
import db
import pack_logic

load_dotenv()  # .env (Projektwurzel oder backend/) laden

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-insecure-change-me")

app = FastAPI(title="RuckZUG Cards API", version="0.8.0")

# Session-Cookie: signiert, HttpOnly, SameSite=lax. https_only nur, wenn das
# Frontend über https läuft (Pi/Cloudflare) — lokal (http) aus.
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=FRONTEND_URL.startswith("https"),
)
# CORS für direkten Zugriff (lokal via Vite-Proxy ohnehin same-origin). localhost
# beliebiger Port; mit Credentials, falls das Frontend doch direkt zugreift.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://localhost(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_user(request: Request) -> str:
    """user_id aus der Session; 401, wenn nicht eingeloggt."""
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Nicht eingeloggt.")
    return uid


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# =====================================================================
# Auth (Discord OAuth, Phase 8)
# =====================================================================
@app.get("/auth/login")
def auth_login(request: Request):
    """Leitet zum Discord-Authorize-Link weiter (mit CSRF-state in der Session)."""
    if not auth.is_configured():
        raise HTTPException(503, "Discord OAuth nicht konfiguriert — .env-Variablen setzen.")
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    return RedirectResponse(auth.authorize_url(state))


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str | None = None, state: str | None = None):
    """Discord-Redirect-Ziel: Code -> Token -> User, dann Session setzen."""
    if not code:
        raise HTTPException(400, "Auth-Code fehlt.")
    if not state or state != request.session.get("oauth_state"):
        raise HTTPException(400, "Ungültiger state (CSRF-Schutz).")
    request.session.pop("oauth_state", None)
    try:
        user = await auth.exchange_code(code)
    except Exception:
        raise HTTPException(502, "Token-Tausch mit Discord fehlgeschlagen.")
    request.session["user_id"] = str(user["id"])
    request.session["username"] = user.get("global_name") or user.get("username") or "Discord-User"
    return RedirectResponse(FRONTEND_URL)


@app.post("/auth/logout")
def auth_logout(request: Request) -> dict:
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(request: Request) -> dict:
    """Aktueller Login-Status (vom Frontend abgefragt)."""
    uid = request.session.get("user_id")
    return {
        "logged_in": bool(uid),
        "user_id": uid,
        "username": request.session.get("username"),
    }


# =====================================================================
# Sammlung / Pack öffnen (user_id aus der Session)
# =====================================================================
@app.get("/api/collection")
def collection(request: Request, set_id: str) -> dict:
    """card_ids, die der eingeloggte User aus einem Set besitzt (count > 0)."""
    user_id = require_user(request)
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT uc.card_id FROM user_cards uc "
            "JOIN card_defs cd ON cd.card_id = uc.card_id "
            "WHERE uc.user_id = ? AND cd.set_id = ? AND uc.count > 0",
            (user_id, set_id),
        ).fetchall()
    return {"set_id": set_id, "owned": [r["card_id"] for r in rows]}


class OpenPackRequest(BaseModel):
    pack_id: str = Field(..., examples=["pack_green"])
    # user_id kommt jetzt aus der Session, NICHT mehr vom Client (Phase 8).


@app.post("/api/open-pack")
def open_pack(req: OpenPackRequest, request: Request) -> dict:
    """Öffnet ein Pack serverseitig für den eingeloggten User."""
    user_id = require_user(request)
    try:
        return pack_logic.open_pack(user_id=user_id, pack_id=req.pack_id)
    except pack_logic.PackError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


# =====================================================================
# DEV-ONLY Helfer
# TODO: vor Live ENTFERNEN oder hinter Admin-Auth absichern!
# =====================================================================
class GiveHourglassesRequest(BaseModel):
    user_id: str = Field(..., examples=["test_user_1"])
    amount: int = Field(..., gt=0, examples=[5])


@app.post("/api/dev/give-hourglasses")
def dev_give_hourglasses(req: GiveHourglassesRequest) -> dict:
    """DEV-ONLY: schreibt einem User Sanduhren gut."""
    with db.connection() as conn:
        conn.execute(
            "INSERT INTO hourglasses (user_id, count, updated_at) "
            "VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(user_id) DO UPDATE SET "
            "count = count + excluded.count, updated_at = datetime('now')",
            (req.user_id, req.amount),
        )
        new_count = conn.execute(
            "SELECT count FROM hourglasses WHERE user_id = ?", (req.user_id,)
        ).fetchone()["count"]
    return {"user_id": req.user_id, "hourglasses": new_count}


@app.post("/api/dev/login")
def dev_login(request: Request, user_id: str = "test_user_1") -> dict:
    """DEV-ONLY: loggt ohne Discord als Test-User ein (lokales Testen ohne OAuth)."""
    request.session["user_id"] = user_id
    request.session["username"] = f"DEV {user_id}"
    return {"logged_in": True, "user_id": user_id, "username": f"DEV {user_id}"}
