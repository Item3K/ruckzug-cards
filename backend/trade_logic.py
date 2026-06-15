"""Trade-Logik (Phase 9b) — wiederverwendbarer Layer für Web UND Discord-Bot.

Diese Funktionen kapseln den kompletten 1:1-Kartentausch inkl. Verhandlung
(Gegenvorschläge) und atomarer Ausführung. Sie hängen NUR an ``db`` (cards.db),
nicht an FastAPI/HTTP — damit der spätere Bot-Cog dieselben Funktionen aufrufen
kann. Fehler werden als ``TradeError`` mit passendem HTTP-Statuscode geworfen
(die Web-Schicht übersetzt sie 1:1; der Bot kann den Code ignorieren).

Rollen-Modell (siehe schema.sql):
- ``from_user`` (A) gibt ``offered_card``; ``to_user`` (B) gibt ``requested_card``.
- Die Rollen A/B sind über den ganzen Trade FEST. Ein Gegenvorschlag ändert nur die
  beiden Karten + wer als Nächstes am Zug ist (``turn_user``).
- Annehmen/Ablehnen/Kontern darf immer NUR der ``turn_user``. Abbrechen darf jeder
  der beiden Beteiligten (solange der Trade offen ist).

Ausführung ist atomar: beim Annehmen wird in EINER Transaktion geprüft, dass beide
Seiten ihre Karte noch besitzen, dann getauscht. Schlägt etwas fehl, wird die ganze
Transaktion zurückgerollt (kein halber Tausch). Doppel-Annehmen ist durch ein
bedingtes Status-Update (``WHERE status='open'``) abgesichert.
"""

from __future__ import annotations

import db

# Status-Werte (zentral, damit Web/Bot dieselben Strings verwenden).
OPEN = "open"
ACCEPTED = "accepted"
REJECTED = "rejected"
CANCELLED = "cancelled"


class TradeError(Exception):
    """Fachlicher Fehler beim Handel (-> von der Web-Schicht in HTTP übersetzt)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# --- kleine Helfer (erwarten eine offene Verbindung) -------------------------
def _owns(conn, user_id: str, card_id: str) -> bool:
    r = conn.execute(
        "SELECT count FROM user_cards WHERE user_id = ? AND card_id = ?",
        (user_id, card_id),
    ).fetchone()
    return bool(r and r["count"] > 0)


def _card_exists(conn, card_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM card_defs WHERE card_id = ?", (card_id,)
    ).fetchone() is not None


def _user_known(conn, user_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM app_users WHERE user_id = ?", (user_id,)
    ).fetchone() is not None


def _add_history(conn, trade_id: int, actor: str, action: str,
                 offered_card: str | None, requested_card: str | None) -> None:
    conn.execute(
        "INSERT INTO trade_history (trade_id, actor, action, offered_card, requested_card) "
        "VALUES (?, ?, ?, ?, ?)",
        (trade_id, actor, action, offered_card, requested_card),
    )


def _fetch(conn, trade_id: int) -> dict | None:
    """Trade als dict inkl. Anzeigedaten (Username + Avatar-Hash beider Seiten)."""
    row = conn.execute(
        """
        SELECT t.*,
               af.username AS from_username, af.avatar AS from_avatar,
               at.username AS to_username,   at.avatar AS to_avatar
        FROM trades t
        LEFT JOIN app_users af ON af.user_id = t.from_user
        LEFT JOIN app_users at ON at.user_id = t.to_user
        WHERE t.id = ?
        """,
        (trade_id,),
    ).fetchone()
    return dict(row) if row else None


def _require_participant(trade: dict, user_id: str) -> None:
    if user_id not in (trade["from_user"], trade["to_user"]):
        raise TradeError(403, "Du gehörst nicht zu diesem Trade.")


def _move_one(conn, giver: str, receiver: str, card_id: str) -> None:
    """Verschiebt 1 Exemplar von giver zu receiver. Wirft, wenn giver nichts (mehr) hat."""
    upd = conn.execute(
        "UPDATE user_cards SET count = count - 1, updated_at = datetime('now') "
        "WHERE user_id = ? AND card_id = ? AND count > 0",
        (giver, card_id),
    )
    if upd.rowcount != 1:
        raise TradeError(409, "Karte ist nicht mehr im Besitz — Tausch abgebrochen.")
    conn.execute(
        "INSERT INTO user_cards (user_id, card_id, count, updated_at) "
        "VALUES (?, ?, 1, datetime('now')) "
        "ON CONFLICT(user_id, card_id) DO UPDATE SET "
        "count = count + 1, updated_at = datetime('now')",
        (receiver, card_id),
    )


# --- öffentliche API ---------------------------------------------------------
def create_trade(from_user: str, to_user: str,
                 offered_card: str, requested_card: str) -> dict:
    """Neuer Trade-Vorschlag von A an B. A bietet offered_card, B soll requested_card geben."""
    if not to_user or from_user == to_user:
        raise TradeError(400, "Ungültiger Handelspartner.")
    with db.connection() as conn:
        if not _user_known(conn, to_user):
            raise TradeError(404, "Handelspartner unbekannt.")
        if not _card_exists(conn, offered_card) or not _card_exists(conn, requested_card):
            raise TradeError(404, "Karte existiert nicht.")
        if not _owns(conn, from_user, offered_card):
            raise TradeError(400, "Du besitzt die angebotene Karte nicht.")
        if not _owns(conn, to_user, requested_card):
            raise TradeError(400, "Der Partner besitzt die angefragte Karte nicht.")
        cur = conn.execute(
            "INSERT INTO trades (from_user, to_user, offered_card, requested_card, status, turn_user) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (from_user, to_user, offered_card, requested_card, OPEN, to_user),
        )
        tid = cur.lastrowid
        _add_history(conn, tid, from_user, "create", offered_card, requested_card)
        return _fetch(conn, tid)


def counter_trade(trade_id: int, actor: str,
                  offered_card: str, requested_card: str) -> dict:
    """Gegenvorschlag des aktuellen Zug-Users: Paar neu zusammenstellen, Zug wechselt."""
    with db.connection() as conn:
        t = _fetch(conn, trade_id)
        if t is None:
            raise TradeError(404, "Trade nicht gefunden.")
        _require_participant(t, actor)
        if t["status"] != OPEN:
            raise TradeError(409, "Dieser Trade ist nicht mehr offen.")
        if t["turn_user"] != actor:
            raise TradeError(403, "Du bist nicht am Zug.")
        if not _card_exists(conn, offered_card) or not _card_exists(conn, requested_card):
            raise TradeError(404, "Karte existiert nicht.")
        # A-Seite muss A gehören, B-Seite muss B gehören (unabhängig davon, wer kontert).
        if not _owns(conn, t["from_user"], offered_card):
            raise TradeError(400, "Die A-Seite-Karte gehört dem Ersteller nicht.")
        if not _owns(conn, t["to_user"], requested_card):
            raise TradeError(400, "Die B-Seite-Karte gehört dem Empfänger nicht.")
        other = t["from_user"] if actor == t["to_user"] else t["to_user"]
        conn.execute(
            "UPDATE trades SET offered_card = ?, requested_card = ?, turn_user = ?, "
            "updated_at = datetime('now') WHERE id = ?",
            (offered_card, requested_card, other, trade_id),
        )
        _add_history(conn, trade_id, actor, "counter", offered_card, requested_card)
        return _fetch(conn, trade_id)


def accept_trade(trade_id: int, actor: str) -> dict:
    """Aktueller Zug-User nimmt an: atomarer Tausch mit Besitz-Neuprüfung."""
    with db.connection() as conn:
        t = _fetch(conn, trade_id)
        if t is None:
            raise TradeError(404, "Trade nicht gefunden.")
        _require_participant(t, actor)
        if t["status"] != OPEN:
            raise TradeError(409, "Dieser Trade ist nicht mehr offen.")
        if t["turn_user"] != actor:
            raise TradeError(403, "Du bist nicht am Zug.")

        # Trade atomar "beanspruchen" — verhindert Doppel-Annehmen/Races.
        claimed = conn.execute(
            "UPDATE trades SET status = ?, turn_user = NULL, updated_at = datetime('now') "
            "WHERE id = ? AND status = ?",
            (ACCEPTED, trade_id, OPEN),
        )
        if claimed.rowcount != 1:
            raise TradeError(409, "Trade wurde bereits bearbeitet.")

        a, b = t["from_user"], t["to_user"]
        a_card, b_card = t["offered_card"], t["requested_card"]
        # Besitz JETZT neu prüfen; bei Fehlschlag rollt die Transaktion alles zurück
        # (inkl. des Status-Updates) -> Trade bleibt offen, kein halber Tausch.
        if not _owns(conn, a, a_card):
            raise TradeError(409, "Der Ersteller besitzt seine Karte nicht mehr.")
        if not _owns(conn, b, b_card):
            raise TradeError(409, "Der Empfänger besitzt seine Karte nicht mehr.")
        _move_one(conn, a, b, a_card)   # A gibt a_card an B
        _move_one(conn, b, a, b_card)   # B gibt b_card an A
        _add_history(conn, trade_id, actor, "accept", a_card, b_card)
        return _fetch(conn, trade_id)


def _close(trade_id: int, actor: str, new_status: str, action: str,
           turn_only: bool) -> dict:
    with db.connection() as conn:
        t = _fetch(conn, trade_id)
        if t is None:
            raise TradeError(404, "Trade nicht gefunden.")
        _require_participant(t, actor)
        if t["status"] != OPEN:
            raise TradeError(409, "Dieser Trade ist nicht mehr offen.")
        if turn_only and t["turn_user"] != actor:
            raise TradeError(403, "Du bist nicht am Zug.")
        upd = conn.execute(
            "UPDATE trades SET status = ?, turn_user = NULL, updated_at = datetime('now') "
            "WHERE id = ? AND status = ?",
            (new_status, trade_id, OPEN),
        )
        if upd.rowcount != 1:
            raise TradeError(409, "Trade wurde bereits bearbeitet.")
        _add_history(conn, trade_id, actor, action, t["offered_card"], t["requested_card"])
        return _fetch(conn, trade_id)


def reject_trade(trade_id: int, actor: str) -> dict:
    """Aktueller Zug-User lehnt den Vorschlag ab."""
    return _close(trade_id, actor, REJECTED, "reject", turn_only=True)


def cancel_trade(trade_id: int, actor: str) -> dict:
    """Beteiligter bricht den offenen Trade ab (z.B. der Wartende zieht zurück)."""
    return _close(trade_id, actor, CANCELLED, "cancel", turn_only=False)


def get_trade(trade_id: int, user_id: str) -> dict:
    """Trade-Detail inkl. Verlauf; nur für Beteiligte."""
    with db.connection() as conn:
        t = _fetch(conn, trade_id)
        if t is None:
            raise TradeError(404, "Trade nicht gefunden.")
        _require_participant(t, user_id)
        hist = conn.execute(
            "SELECT actor, action, offered_card, requested_card, created_at "
            "FROM trade_history WHERE trade_id = ? ORDER BY id",
            (trade_id,),
        ).fetchall()
        t["history"] = [dict(h) for h in hist]
        return t


def list_trades(user_id: str) -> list[dict]:
    """Alle Trades, an denen der User beteiligt ist (neueste zuerst)."""
    with db.connection() as conn:
        rows = conn.execute(
            """
            SELECT t.*,
                   af.username AS from_username, af.avatar AS from_avatar,
                   at.username AS to_username,   at.avatar AS to_avatar
            FROM trades t
            LEFT JOIN app_users af ON af.user_id = t.from_user
            LEFT JOIN app_users at ON at.user_id = t.to_user
            WHERE t.from_user = ? OR t.to_user = ?
            ORDER BY t.updated_at DESC, t.id DESC
            """,
            (user_id, user_id),
        ).fetchall()
        return [dict(r) for r in rows]
