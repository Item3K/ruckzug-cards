"""Serverseitige Pack-Öffnen-Logik (Phase 5b — Slot-System, ROADMAP §7).

Die GESAMTE Zufalls-/Wahrscheinlichkeitslogik liegt hier im Backend
(Cheat-Schutz). Das Frontend bekommt nur das fertige Ergebnis.

Slot-System: 10 Karten pro Pack, jeder Slot-Block (repeat × gewichtete outcomes)
wählt pro Karte ein outcome (Filter nach rarity/finish) und zieht dann eine
passende Karte aus dem Pack-Pool (shared + pack-exklusiv). Die Wahrscheinlichkeiten
kommen pro Pack aus cards.db.packs.draw_config (vom Seed aus set_config.json).
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass

import db
import pack_config as cfg


class PackError(Exception):
    """Fachlicher Fehler beim Pack-Öffnen (-> vom Endpoint in HTTP übersetzt)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class CardDef:
    card_id: str
    set_id: str
    name: str
    rarity: str
    finish: str
    pack_exclusive_to: str | None
    asset: str | None


# --- Pool + Draw-Konfig aus der DB -------------------------------------------
def get_pack(conn, pack_id: str) -> tuple[list[CardDef], dict]:
    """Liefert (pool, draw_config) für ein Pack.

    pool = set-weite Karten (pack_exclusive_to IS NULL) + nur-dieses-Pack-Karten.
    So sind pack-exklusive Karten automatisch nur aus diesem Pack ziehbar.
    Wirft PackError(404), wenn das Pack nicht existiert.
    """
    pack = conn.execute(
        "SELECT pack_id, set_id, draw_config FROM packs WHERE pack_id = ?", (pack_id,)
    ).fetchone()
    if pack is None:
        raise PackError(404, f"Pack '{pack_id}' existiert nicht.")
    set_id = pack["set_id"]

    rows = conn.execute(
        "SELECT card_id, set_id, name, rarity, finish, pack_exclusive_to, asset "
        "FROM card_defs WHERE set_id = ? AND (pack_exclusive_to IS NULL OR pack_exclusive_to = ?)",
        (set_id, pack_id),
    ).fetchall()
    pool = [
        CardDef(r["card_id"], r["set_id"], r["name"], r["rarity"], r["finish"],
                r["pack_exclusive_to"], r["asset"])
        for r in rows
    ]

    draw = None
    if pack["draw_config"]:
        try:
            draw = json.loads(pack["draw_config"])
        except json.JSONDecodeError:
            draw = None
    if not draw or not draw.get("slots"):
        draw = cfg.FALLBACK_DRAW
    return pool, draw


# --- Reine Würfel-Logik (ohne DB) --------------------------------------------
def _pick_card(pool: list[CardDef], rarity: str | None, finish: str | None,
               rng: random.Random) -> CardDef:
    """Wählt eine Karte passend zu (rarity, finish) mit weicher Fallback-Kette."""
    cands = [c for c in pool
             if (rarity is None or c.rarity == rarity) and (finish is None or c.finish == finish)]
    if not cands and finish is not None:      # Finish lockern
        cands = [c for c in pool if rarity is None or c.rarity == rarity]
    if not cands and rarity is not None:      # Rarität lockern, Finish behalten
        cands = [c for c in pool if finish is None or c.finish == finish]
    if not cands:                             # irgendwas
        cands = pool
    return rng.choice(cands)


def draw_pack(pool: list[CardDef], draw_config: dict,
              rng: random.Random | None = None) -> list[CardDef]:
    """Zieht die Karten gemäß Slot-Konfig. Reine Funktion (testbar, kein DB-Zugriff)."""
    rng = rng or random.Random()
    if not pool:
        raise PackError(500, "Karten-Pool des Packs ist leer — Seed-Daten fehlen?")

    slots = draw_config.get("slots") or cfg.FALLBACK_DRAW["slots"]
    drawn: list[CardDef] = []
    for block in slots:
        repeat = int(block.get("repeat", 1))
        outcomes = block.get("outcomes", [])
        weights = [o.get("w", 1) for o in outcomes]
        for _ in range(repeat):
            if not outcomes:
                drawn.append(rng.choice(pool))
                continue
            o = rng.choices(outcomes, weights=weights, k=1)[0]
            drawn.append(_pick_card(pool, o.get("rarity"), o.get("finish"), rng))
    return drawn


def determine_beam_stage(drawn: list[CardDef]) -> str:
    """Beam-Stufe aus der BESTEN gezogenen Karte (Rarität + Finish)."""
    if not drawn:
        return cfg.DEFAULT_BEAM
    best_tier = max(cfg.card_beam_tier(c.rarity, c.finish) for c in drawn)
    return cfg.BEAM_TIER_TO_STAGE.get(best_tier, cfg.DEFAULT_BEAM)


# --- Orchestrierung mit DB ---------------------------------------------------
def open_pack(user_id: str, pack_id: str, rng: random.Random | None = None) -> dict:
    """Öffnet ein Pack für einen User. Eine Transaktion, serverseitig."""
    with db.connection() as conn:
        # a) Sanduhr-Bestand prüfen
        row = conn.execute(
            "SELECT count FROM hourglasses WHERE user_id = ?", (user_id,)
        ).fetchone()
        have = row["count"] if row else 0
        if have < cfg.HOURGLASS_COST:
            raise PackError(
                400, f"Zu wenig Sanduhren: hast {have}, brauchst {cfg.HOURGLASS_COST}.",
            )

        # Pool + Würfel-Konfig laden (prüft auch, ob das Pack existiert)
        pool, draw_config = get_pack(conn, pack_id)

        # c) Karten nach Slot-System würfeln
        drawn = draw_pack(pool, draw_config, rng=rng)

        # b) Eine Sanduhr abziehen
        conn.execute(
            "UPDATE hourglasses SET count = count - ?, updated_at = datetime('now') "
            "WHERE user_id = ?",
            (cfg.HOURGLASS_COST, user_id),
        )
        remaining = have - cfg.HOURGLASS_COST

        # d) Gezogene Karten verbuchen (Duplikate aggregieren)
        counts: dict[str, int] = {}
        for c in drawn:
            counts[c.card_id] = counts.get(c.card_id, 0) + 1
        for card_id, n in counts.items():
            conn.execute(
                "INSERT INTO user_cards (user_id, card_id, count, updated_at) "
                "VALUES (?, ?, ?, datetime('now')) "
                "ON CONFLICT(user_id, card_id) DO UPDATE SET "
                "count = count + excluded.count, updated_at = datetime('now')",
                (user_id, card_id, n),
            )

    # e) Beam-Stufe aus der besten Karte
    beam_stage = determine_beam_stage(drawn)

    return {
        "pack_id": pack_id,
        "drawn_cards": [
            {
                "card_id": c.card_id,
                "name": c.name,
                "rarity": c.rarity,
                "finish": c.finish,
                "set_id": c.set_id,
                "asset": c.asset,
            }
            for c in drawn
        ],
        "beam_stage": beam_stage,
        "hourglasses_remaining": remaining,
    }
