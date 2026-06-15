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
import trade_logic

load_dotenv()  # .env (Projektwurzel oder backend/) laden

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-insecure-change-me")

# Admin-Identifikation: kommaseparierte Discord-user_ids in .env (mehrere möglich).
ADMIN_USER_IDS = {
    s.strip() for s in os.getenv("ADMIN_USER_IDS", "").split(",") if s.strip()
}


def is_admin(user_id: str | None) -> bool:
    return bool(user_id) and user_id in ADMIN_USER_IDS


def avatar_url(user_id: str | None, avatar_hash: str | None) -> str:
    """Discord-CDN-URL des Avatars; Fallback auf den Discord-Default-Avatar."""
    if user_id and avatar_hash:
        ext = "gif" if avatar_hash.startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.{ext}?size=128"
    # Default-Avatar: für neue Usernamen (user_id >> 22) % 6; sonst Index 0.
    try:
        idx = (int(user_id) >> 22) % 6
    except (TypeError, ValueError):
        idx = 0
    return f"https://cdn.discordapp.com/embed/avatars/{idx}.png"

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


def _record_login(user_id: str, username: str | None, avatar: str | None = None) -> None:
    """Login in app_users festhalten (für die Admin-User-Liste + Avatar)."""
    with db.connection() as conn:
        conn.execute(
            "INSERT INTO app_users (user_id, username, avatar, first_login, last_login) "
            "VALUES (?, ?, ?, datetime('now'), datetime('now')) "
            "ON CONFLICT(user_id) DO UPDATE SET "
            "username = excluded.username, avatar = excluded.avatar, "
            "last_login = datetime('now')",
            (user_id, username, avatar),
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
    _record_login(uid, uname, user.get("avatar"))
    return RedirectResponse(FRONTEND_URL)


@app.post("/auth/logout")
def auth_logout(request: Request) -> dict:
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(request: Request) -> dict:
    """Aktueller Login-Status inkl. Avatar + Sanduhr-Stand (vom Frontend abgefragt)."""
    uid = request.session.get("user_id")
    avatar = None
    hourglasses = 0
    if uid:
        with db.connection() as conn:
            au = conn.execute(
                "SELECT avatar FROM app_users WHERE user_id = ?", (uid,)
            ).fetchone()
            avatar = au["avatar"] if au else None
            hg = conn.execute(
                "SELECT count FROM hourglasses WHERE user_id = ?", (uid,)
            ).fetchone()
            hourglasses = hg["count"] if hg else 0
    return {
        "logged_in": bool(uid),
        "user_id": uid,
        "username": request.session.get("username"),
        "is_admin": is_admin(uid),
        "avatar_url": avatar_url(uid, avatar) if uid else None,
        "hourglasses": hourglasses,
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
# User-Verzeichnis & fremde Sammlungen (eingeloggt; Basis für Trading/Freunde)
# =====================================================================
@app.get("/api/users")
def users(request: Request) -> dict:
    """Alle bekannten OAuth-User (außer mir selbst) — für die Handelspartner-Wahl."""
    me_id = require_user(request)
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT user_id, username, avatar FROM app_users WHERE user_id != ? "
            "ORDER BY username COLLATE NOCASE",
            (me_id,),
        ).fetchall()
    return {"users": [
        {"user_id": r["user_id"], "username": r["username"],
         "avatar_url": avatar_url(r["user_id"], r["avatar"])}
        for r in rows
    ]}


@app.get("/api/users/{user_id}/collection")
def user_collection(user_id: str, request: Request) -> dict:
    """Besitz-Anzahl je Karte EINES Users (eingeloggt einsehbar; auch eigene)."""
    require_user(request)
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT card_id, count FROM user_cards WHERE user_id = ? AND count > 0",
            (user_id,),
        ).fetchall()
    return {"user_id": user_id, "cards": {r["card_id"]: r["count"] for r in rows}}


# =====================================================================
# Trading (Phase 9b) — 1:1-Tausch zwischen eingeloggten Usern.
# Die Logik liegt in trade_logic.py (auch vom Bot nutzbar); hier nur HTTP.
# =====================================================================
def _trade_view(t: dict) -> dict:
    """Avatar-Hashes -> URLs für die Ausgabe (Frontend mappt Karten selbst)."""
    t = dict(t)
    t["from_avatar_url"] = avatar_url(t.get("from_user"), t.pop("from_avatar", None))
    t["to_avatar_url"] = avatar_url(t.get("to_user"), t.pop("to_avatar", None))
    return t


def _trade_call(fn, *args):
    """Ruft eine trade_logic-Funktion und übersetzt TradeError -> HTTPException."""
    try:
        return _trade_view(fn(*args))
    except trade_logic.TradeError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


class CreateTradeRequest(BaseModel):
    to_user: str
    offered_card: str
    requested_card: str


class CounterTradeRequest(BaseModel):
    offered_card: str
    requested_card: str


@app.get("/api/trades")
def trades_list(request: Request) -> dict:
    """Meine Trades, kategorisiert: incoming (ich am Zug), outgoing (warte), closed."""
    me_id = require_user(request)
    incoming, outgoing, closed = [], [], []
    for t in trade_logic.list_trades(me_id):
        v = _trade_view(t)
        if v["status"] != trade_logic.OPEN:
            closed.append(v)
        elif v["turn_user"] == me_id:
            incoming.append(v)
        else:
            outgoing.append(v)
    return {"incoming": incoming, "outgoing": outgoing, "closed": closed}


@app.get("/api/trades/{trade_id}")
def trade_detail(trade_id: int, request: Request) -> dict:
    me_id = require_user(request)
    return _trade_call(trade_logic.get_trade, trade_id, me_id)


@app.post("/api/trades")
def trade_create(req: CreateTradeRequest, request: Request) -> dict:
    me_id = require_user(request)
    return _trade_call(trade_logic.create_trade, me_id, req.to_user,
                       req.offered_card, req.requested_card)


@app.post("/api/trades/{trade_id}/counter")
def trade_counter(trade_id: int, req: CounterTradeRequest, request: Request) -> dict:
    me_id = require_user(request)
    return _trade_call(trade_logic.counter_trade, trade_id, me_id,
                       req.offered_card, req.requested_card)


@app.post("/api/trades/{trade_id}/accept")
def trade_accept(trade_id: int, request: Request) -> dict:
    me_id = require_user(request)
    return _trade_call(trade_logic.accept_trade, trade_id, me_id)


@app.post("/api/trades/{trade_id}/reject")
def trade_reject(trade_id: int, request: Request) -> dict:
    me_id = require_user(request)
    return _trade_call(trade_logic.reject_trade, trade_id, me_id)


@app.post("/api/trades/{trade_id}/cancel")
def trade_cancel(trade_id: int, request: Request) -> dict:
    me_id = require_user(request)
    return _trade_call(trade_logic.cancel_trade, trade_id, me_id)


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
                   au.avatar AS avatar,
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
    users = []
    for r in rows:
        u = dict(r)
        u["avatar_url"] = avatar_url(u["user_id"], u.pop("avatar"))
        users.append(u)
    return {"users": users}


@app.get("/api/admin/user-cards")
def admin_user_cards(request: Request, user_id: str) -> dict:
    """Besitz-Anzahl je Karte für EINEN User (für die Karten-Verwaltung)."""
    require_admin(request)
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT card_id, count FROM user_cards WHERE user_id = ? AND count > 0",
            (user_id,),
        ).fetchall()
    return {"user_id": user_id, "cards": {r["card_id"]: r["count"] for r in rows}}


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
