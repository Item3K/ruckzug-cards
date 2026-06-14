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

# Admin-Identifikation: kommaseparierte Discord-user_ids in .env (mehrere möglich).
ADMIN_USER_IDS = {
    s.strip() for s in os.getenv("ADMIN_USER_IDS", "").split(",") if s.strip()
}
# Dev-Endpoints (z.B. /api/dev/login) nur, wenn DEV_ENDPOINTS gesetzt ist.
DEV_ENDPOINTS = os.getenv("DEV_ENDPOINTS", "").lower() in {"1", "true", "yes", "on"}


def is_admin(user_id: str | None) -> bool:
    return bool(user_id) and user_id in ADMIN_USER_IDS

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


def require_admin(request: Request) -> str:
    """user_id aus der Session UND in ADMIN_USER_IDS; sonst 401/403. Serverseitig erzwungen."""
    uid = require_user(request)
    if not is_admin(uid):
        raise HTTPException(status_code=403, detail="Kein Admin-Zugriff.")
    return uid


def _record_login(user_id: str, username: str | None) -> None:
    """Login in app_users festhalten (für die Admin-User-Liste)."""
    with db.connection() as conn:
        conn.execute(
            "INSERT INTO app_users (user_id, username, first_login, last_login) "
            "VALUES (?, ?, datetime('now'), datetime('now')) "
            "ON CONFLICT(user_id) DO UPDATE SET "
            "username = excluded.username, last_login = datetime('now')",
            (user_id, username),
        )


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
    uid = str(user["id"])
    uname = user.get("global_name") or user.get("username") or "Discord-User"
    request.session["user_id"] = uid
    request.session["username"] = uname
    _record_login(uid, uname)
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
        "is_admin": is_admin(uid),
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
# Admin (Phase 13a) — ALLE Endpoints hinter require_admin (serverseitig erzwungen).
# Sanduhren-/Karten-Verwaltung; ersetzt den alten /api/dev/give-hourglasses.
# =====================================================================
@app.get("/api/admin/users")
def admin_users(request: Request) -> dict:
    """Alle bekannten User (eingeloggt / mit Sanduhren / mit Karten) + Bestände."""
    require_admin(request)
    with db.connection() as conn:
        rows = conn.execute(
            """
            WITH ids AS (
                SELECT user_id FROM app_users
                UNION SELECT user_id FROM hourglasses
                UNION SELECT user_id FROM user_cards
            )
            SELECT i.user_id AS user_id,
                   au.username AS username,
                   au.last_login AS last_login,
                   COALESCE(h.count, 0) AS hourglasses,
                   COALESCE((SELECT COUNT(*) FROM user_cards uc
                             WHERE uc.user_id = i.user_id AND uc.count > 0), 0) AS card_count
            FROM ids i
            LEFT JOIN app_users au ON au.user_id = i.user_id
            LEFT JOIN hourglasses h ON h.user_id = i.user_id
            ORDER BY au.last_login DESC NULLS LAST, i.user_id
            """
        ).fetchall()
    return {"users": [dict(r) for r in rows]}


class AdminHourglassesRequest(BaseModel):
    user_id: str
    mode: str = Field("set", pattern="^(set|add)$")  # 'set' = absolut, 'add' = +/- Betrag
    amount: int


@app.post("/api/admin/hourglasses")
def admin_hourglasses(req: AdminHourglassesRequest, request: Request) -> dict:
    """Sanduhren setzen (absolut) oder ändern (+/-). Floor bei 0."""
    require_admin(request)
    with db.connection() as conn:
        cur = conn.execute(
            "SELECT count FROM hourglasses WHERE user_id = ?", (req.user_id,)
        ).fetchone()
        current = cur["count"] if cur else 0
        new_val = req.amount if req.mode == "set" else current + req.amount
        new_val = max(0, new_val)
        conn.execute(
            "INSERT INTO hourglasses (user_id, count, updated_at) "
            "VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(user_id) DO UPDATE SET count = excluded.count, updated_at = datetime('now')",
            (req.user_id, new_val),
        )
    return {"user_id": req.user_id, "hourglasses": new_val}


class AdminCardRequest(BaseModel):
    user_id: str
    card_id: str
    count: int = Field(1, gt=0)


@app.post("/api/admin/cards/give")
def admin_cards_give(req: AdminCardRequest, request: Request) -> dict:
    """Einer user_id eine Karte (Anzahl) gutschreiben."""
    require_admin(request)
    with db.connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM card_defs WHERE card_id = ?", (req.card_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(404, f"card_id '{req.card_id}' existiert nicht.")
        conn.execute(
            "INSERT INTO user_cards (user_id, card_id, count, updated_at) "
            "VALUES (?, ?, ?, datetime('now')) "
            "ON CONFLICT(user_id, card_id) DO UPDATE SET "
            "count = count + excluded.count, updated_at = datetime('now')",
            (req.user_id, req.card_id, req.count),
        )
        new_count = conn.execute(
            "SELECT count FROM user_cards WHERE user_id = ? AND card_id = ?",
            (req.user_id, req.card_id),
        ).fetchone()["count"]
    return {"user_id": req.user_id, "card_id": req.card_id, "count": new_count}


@app.post("/api/admin/cards/take")
def admin_cards_take(req: AdminCardRequest, request: Request) -> dict:
    """Einer user_id eine Karte (Anzahl) abziehen (nicht unter 0)."""
    require_admin(request)
    with db.connection() as conn:
        cur = conn.execute(
            "SELECT count FROM user_cards WHERE user_id = ? AND card_id = ?",
            (req.user_id, req.card_id),
        ).fetchone()
        new_count = max(0, (cur["count"] if cur else 0) - req.count)
        conn.execute(
            "INSERT INTO user_cards (user_id, card_id, count, updated_at) "
            "VALUES (?, ?, ?, datetime('now')) "
            "ON CONFLICT(user_id, card_id) DO UPDATE SET "
            "count = excluded.count, updated_at = datetime('now')",
            (req.user_id, req.card_id, new_count),
        )
    return {"user_id": req.user_id, "card_id": req.card_id, "count": new_count}


# =====================================================================
# DEV-ONLY (nur aktiv, wenn DEV_ENDPOINTS gesetzt ist)
# =====================================================================
@app.post("/api/dev/login")
def dev_login(request: Request, user_id: str = "test_user_1") -> dict:
    """DEV-ONLY: loggt ohne Discord als Test-User ein (lokales Testen)."""
    if not DEV_ENDPOINTS:
        raise HTTPException(404, "Nicht verfügbar.")
    request.session["user_id"] = user_id
    request.session["username"] = f"DEV {user_id}"
    _record_login(user_id, f"DEV {user_id}")
    return {"logged_in": True, "user_id": user_id, "username": f"DEV {user_id}"}
