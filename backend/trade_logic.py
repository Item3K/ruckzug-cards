"""Trade-Logik (Phase 9b) — wiederverwendbarer Layer für Web UND Discord-Bot.

Mehrkarten-Tausch: jede Seite bietet 1–5 verschiedene Karten (card_ids). Diese
Funktionen kapseln den kompletten Tausch inkl. Verhandlung (Gegenvorschläge) und
atomarer Ausführung. Sie hängen NUR an ``db`` (cards.db), nicht an FastAPI/HTTP —
damit der spätere Bot-Cog dieselben Funktionen aufrufen kann. Fehler werden als
``TradeError`` mit passendem HTTP-Statuscode geworfen.

Rollen-Modell (siehe schema.sql):
- ``from_user`` (A) bietet die ``from``-Karten; ``to_user`` (B) gibt die ``to``-Karten.
- Die Rollen A/B sind über den ganzen Trade FEST. Ein Gegenvorschlag ändert nur die
  beiden Karten-Listen + wer als Nächstes am Zug ist (``turn_user``).
- Annehmen/Ablehnen/Kontern darf immer NUR der ``turn_user``. Abbrechen darf jeder
  der beiden Beteiligten (solange der Trade offen ist).

Regeln je Seite: 1–5 Karten, keine seiteninternen Duplikate, keine Überschneidung
zwischen den Seiten (keine card_id auf beiden Seiten), und Besitz beider Parteien.

Ausführung ist atomar: beim Annehmen wird in EINER Transaktion geprüft, dass beide
Seiten ALLE ihre Karten noch besitzen, dann werden alle umgebucht. Schlägt etwas fehl,
wird die ganze Transaktion zurückgerollt (kein Teiltausch). Doppel-Annehmen ist durch
ein bedingtes Status-Update (``WHERE status='open'``) abgesichert.
"""

from __future__ import annotations

import json

import db

# Status-Werte (zentral, damit Web/Bot dieselben Strings verwenden).
OPEN = "open"
ACCEPTED = "accepted"
REJECTED = "rejected"
CANCELLED = "cancelled"

MAX_PER_SIDE = 5  # max. Karten pro Seite


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


def _clean_side(cards, label: str) -> list[str]:
    """Normalisiert/validiert eine Karten-Liste einer Seite (Form, Anzahl, Duplikate)."""
    if not isinstance(cards, (list, tuple)):
        raise TradeError(400, f"{label}: ungültige Karten-Liste.")
    cards = [c for c in cards if c]
    if len(cards) < 1:
        raise TradeError(400, f"{label}: mindestens 1 Karte.")
    if len(cards) > MAX_PER_SIDE:
        raise TradeError(400, f"{label}: höchstens {MAX_PER_SIDE} Karten.")
    if len(set(cards)) != len(cards):
        raise TradeError(400, f"{label}: keine doppelten Karten auf einer Seite.")
    return list(cards)


def _validate(conn, from_user: str, to_user: str,
              from_cards, to_cards) -> tuple[list[str], list[str]]:
    """Vollständige serverseitige Prüfung. Gibt die bereinigten Listen zurück."""
    fc = _clean_side(from_cards, "Deine Seite")
    tc = _clean_side(to_cards, "Gegenseite")
    if set(fc) & set(tc):
        raise TradeError(400, "Eine Karte darf nicht auf beiden Seiten stehen.")
    for cid in fc:
        if not _card_exists(conn, cid):
            raise TradeError(404, f"Karte '{cid}' existiert nicht.")
        if not _owns(conn, from_user, cid):
            raise TradeError(400, "Eine angebotene Karte gehört dem Anbieter nicht.")
    for cid in tc:
        if not _card_exists(conn, cid):
            raise TradeError(404, f"Karte '{cid}' existiert nicht.")
        if not _owns(conn, to_user, cid):
            raise TradeError(400, "Eine angefragte Karte gehört dem Partner nicht.")
    return fc, tc


def _set_items(conn, trade_id: int, from_cards: list[str], to_cards: list[str]) -> None:
    conn.execute("DELETE FROM trade_items WHERE trade_id = ?", (trade_id,))
    conn.executemany(
        "INSERT INTO trade_items (trade_id, side, card_id) VALUES (?, 'from', ?)",
        [(trade_id, c) for c in from_cards],
    )
    conn.executemany(
        "INSERT INTO trade_items (trade_id, side, card_id) VALUES (?, 'to', ?)",
        [(trade_id, c) for c in to_cards],
    )


def _items(conn, trade_id: int) -> dict:
    rows = conn.execute(
        "SELECT side, card_id FROM trade_items WHERE trade_id = ? ORDER BY rowid",
        (trade_id,),
    ).fetchall()
    out = {"from": [], "to": []}
    for r in rows:
        out[r["side"]].append(r["card_id"])
    return out


def _add_history(conn, trade_id: int, actor: str, action: str,
                 from_cards: list[str], to_cards: list[str]) -> None:
    conn.execute(
        "INSERT INTO trade_history (trade_id, actor, action, from_cards, to_cards) "
        "VALUES (?, ?, ?, ?, ?)",
        (trade_id, actor, action, json.dumps(from_cards), json.dumps(to_cards)),
    )


def _fetch(conn, trade_id: int) -> dict | None:
    """Trade als dict inkl. Anzeigedaten (Username + Avatar-Hash) + Karten-Listen."""
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
    if not row:
        return None
    t = dict(row)
    its = _items(conn, trade_id)
    t["from_cards"] = its["from"]
    t["to_cards"] = its["to"]
    return t


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
                 from_cards, to_cards) -> dict:
    """Neuer Trade-Vorschlag von A an B (je 1–5 Karten)."""
    if not to_user or from_user == to_user:
        raise TradeError(400, "Ungültiger Handelspartner.")
    with db.connection() as conn:
        if not _user_known(conn, to_user):
            raise TradeError(404, "Handelspartner unbekannt.")
        fc, tc = _validate(conn, from_user, to_user, from_cards, to_cards)
        cur = conn.execute(
            "INSERT INTO trades (from_user, to_user, status, turn_user) VALUES (?, ?, ?, ?)",
            (from_user, to_user, OPEN, to_user),
        )
        tid = cur.lastrowid
        _set_items(conn, tid, fc, tc)
        _add_history(conn, tid, from_user, "create", fc, tc)
        return _fetch(conn, tid)


def counter_trade(trade_id: int, actor: str, from_cards, to_cards) -> dict:
    """Gegenvorschlag des aktuellen Zug-Users: beide Listen neu, Zug wechselt."""
    with db.connection() as conn:
        t = _fetch(conn, trade_id)
        if t is None:
            raise TradeError(404, "Trade nicht gefunden.")
        _require_participant(t, actor)
        if t["status"] != OPEN:
            raise TradeError(409, "Dieser Trade ist nicht mehr offen.")
        if t["turn_user"] != actor:
            raise TradeError(403, "Du bist nicht am Zug.")
        # A-Seite muss A gehören, B-Seite muss B gehören (unabhängig davon, wer kontert).
        fc, tc = _validate(conn, t["from_user"], t["to_user"], from_cards, to_cards)
        other = t["from_user"] if actor == t["to_user"] else t["to_user"]
        _set_items(conn, trade_id, fc, tc)
        conn.execute(
            "UPDATE trades SET turn_user = ?, updated_at = datetime('now') WHERE id = ?",
            (other, trade_id),
        )
        _add_history(conn, trade_id, actor, "counter", fc, tc)
        return _fetch(conn, trade_id)


def accept_trade(trade_id: int, actor: str) -> dict:
    """Aktueller Zug-User nimmt an: atomarer Mehrkarten-Tausch mit Besitz-Neuprüfung."""
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
        fc, tc = t["from_cards"], t["to_cards"]
        # Besitz ALLER Karten JETZT neu prüfen; bei Fehlschlag rollt die Transaktion
        # alles zurück (inkl. Status) -> kein Teiltausch, Trade bleibt offen.
        for cid in fc:
            if not _owns(conn, a, cid):
                raise TradeError(409, "Der Ersteller besitzt eine seiner Karten nicht mehr.")
        for cid in tc:
            if not _owns(conn, b, cid):
                raise TradeError(409, "Der Empfänger besitzt eine seiner Karten nicht mehr.")
        for cid in fc:
            _move_one(conn, a, b, cid)   # A gibt seine Karten an B
        for cid in tc:
            _move_one(conn, b, a, cid)   # B gibt seine Karten an A
        _add_history(conn, trade_id, actor, "accept", fc, tc)
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
        _add_history(conn, trade_id, actor, action, t["from_cards"], t["to_cards"])
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
            "SELECT actor, action, from_cards, to_cards, created_at "
            "FROM trade_history WHERE trade_id = ? ORDER BY id",
            (trade_id,),
        ).fetchall()
        t["history"] = [
            {
                "actor": h["actor"], "action": h["action"], "created_at": h["created_at"],
                "from_cards": json.loads(h["from_cards"] or "[]"),
                "to_cards": json.loads(h["to_cards"] or "[]"),
            }
            for h in hist
        ]
        return t


def list_trades(user_id: str) -> list[dict]:
    """Alle Trades, an denen der User beteiligt ist (neueste zuerst), inkl. Karten-Listen."""
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
        trades = [dict(r) for r in rows]
        if trades:
            ids = [t["id"] for t in trades]
            by_id = {tid: {"from": [], "to": []} for tid in ids}
            ph = ",".join("?" * len(ids))
            for r in conn.execute(
                f"SELECT trade_id, side, card_id FROM trade_items "
                f"WHERE trade_id IN ({ph}) ORDER BY rowid",
                ids,
            ).fetchall():
                by_id[r["trade_id"]][r["side"]].append(r["card_id"])
            for t in trades:
                t["from_cards"] = by_id[t["id"]]["from"]
                t["to_cards"] = by_id[t["id"]]["to"]
        return trades
