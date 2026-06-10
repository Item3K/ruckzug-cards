"""Serverseitige Pack-Öffnen-Logik (Phase 3a).

Die GESAMTE Zufalls-/Wahrscheinlichkeitslogik liegt hier im Backend
(ROADMAP §6, Cheat-Schutz). Das Frontend ruft nur den Endpoint auf und bekommt
das fertige Ergebnis.

Aufbau:
- ``draw_cards()``  : reine Funktion (Pool rein -> gezogene Karten raus), testbar
                      ohne DB. Nutzt das injizierbare ``rng`` für Reproduzierbarkeit.
- ``open_pack()``   : Orchestrierung mit DB (Sanduhr prüfen/abziehen, würfeln,
                      user_cards verbuchen) — alles in EINER Transaktion.
"""

from __future__ import annotations

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
    pack_exclusive_to: str | None
    asset: str | None


# --- Pool-Aufbau -------------------------------------------------------------
def get_pack_pool(conn, pack_id: str) -> tuple[list[CardDef], list[CardDef]]:
    """Liefert (basis_pool, exklusiv_pool) für ein Pack.

    - basis_pool   : set-weite Karten (pack_exclusive_to IS NULL) des Sets, zu dem
                     das Pack gehört.
    - exklusiv_pool: Karten, die NUR aus genau diesem Pack ziehbar sind.

    Wirft PackError(404), wenn das Pack nicht existiert.
    """
    pack = conn.execute(
        "SELECT pack_id, set_id FROM packs WHERE pack_id = ?", (pack_id,)
    ).fetchone()
    if pack is None:
        raise PackError(404, f"Pack '{pack_id}' existiert nicht.")
    set_id = pack["set_id"]

    base_rows = conn.execute(
        "SELECT card_id, set_id, name, rarity, pack_exclusive_to, asset "
        "FROM card_defs WHERE set_id = ? AND pack_exclusive_to IS NULL",
        (set_id,),
    ).fetchall()
    excl_rows = conn.execute(
        "SELECT card_id, set_id, name, rarity, pack_exclusive_to, asset "
        "FROM card_defs WHERE pack_exclusive_to = ?",
        (pack_id,),
    ).fetchall()

    to_def = lambda r: CardDef(
        r["card_id"], r["set_id"], r["name"], r["rarity"],
        r["pack_exclusive_to"], r["asset"],
    )
    return [to_def(r) for r in base_rows], [to_def(r) for r in excl_rows]


# --- Reine Würfel-Logik (ohne DB) --------------------------------------------
def _weighted_rarity(rarities_present: set[str], rng: random.Random) -> str:
    """Wählt eine Rarität gemäß RARITY_WEIGHTS, beschränkt auf vorhandene."""
    choices = [r for r in cfg.RARITY_ORDER if r in rarities_present]
    weights = [cfg.RARITY_WEIGHTS.get(r, 0.0) for r in choices]
    # Falls alle Gewichte 0 (z.B. unbekannte Rarität), gleichverteilt wählen.
    if sum(weights) <= 0:
        return rng.choice(choices)
    return rng.choices(choices, weights=weights, k=1)[0]


def draw_cards(
    base_pool: list[CardDef],
    exclusive_pool: list[CardDef],
    rng: random.Random | None = None,
) -> list[CardDef]:
    """Zieht ``CARDS_PER_PACK`` Karten aus den beiden Pools.

    Pro Zug:
      1) Rarität gemäß Gewichten würfeln (nur Raritäten, die im Pool existieren).
      2) Pool wählen: gibt es die Rarität in beiden Pools, entscheidet
         PACK_EXCLUSIVE_CHANCE; sonst der Pool, der sie hat.
      3) Gleichverteilt eine Karte dieser Rarität aus dem gewählten Pool ziehen.

    Duplikate sind möglich (mit Zurücklegen). Reine Funktion — keine DB.
    """
    rng = rng or random.Random()
    combined = base_pool + exclusive_pool
    if not combined:
        raise PackError(500, "Karten-Pool des Packs ist leer — Seed-Daten fehlen?")

    rarities_present = {c.rarity for c in combined}
    drawn: list[CardDef] = []

    for _ in range(cfg.CARDS_PER_PACK):
        rarity = _weighted_rarity(rarities_present, rng)
        base_of_rarity = [c for c in base_pool if c.rarity == rarity]
        excl_of_rarity = [c for c in exclusive_pool if c.rarity == rarity]

        if base_of_rarity and excl_of_rarity:
            use_excl = rng.random() < cfg.PACK_EXCLUSIVE_CHANCE
            pool = excl_of_rarity if use_excl else base_of_rarity
        elif excl_of_rarity:
            pool = excl_of_rarity
        else:
            pool = base_of_rarity

        drawn.append(rng.choice(pool))

    return drawn


def determine_beam_stage(drawn: list[CardDef]) -> str:
    """Beam-Stufe aus der BESTEN gezogenen Karte (ROADMAP §6)."""
    if not drawn:
        return cfg.DEFAULT_BEAM
    best = max(drawn, key=lambda c: cfg.RARITY_ORDER.index(c.rarity)
               if c.rarity in cfg.RARITY_ORDER else -1)
    return cfg.RARITY_TO_BEAM.get(best.rarity, cfg.DEFAULT_BEAM)


# --- Orchestrierung mit DB ---------------------------------------------------
def open_pack(user_id: str, pack_id: str, rng: random.Random | None = None) -> dict:
    """Öffnet ein Pack für einen User. Eine Transaktion, serverseitig.

    Ablauf: Sanduhr prüfen -> Pool laden -> würfeln -> Sanduhr abziehen ->
    user_cards verbuchen -> Beam-Stufe bestimmen. Gibt das Ergebnis-Dict zurück.

    Wirft PackError bei fachlichen Fehlern (zu wenig Sanduhren, Pack unbekannt …).
    """
    with db.connection() as conn:
        # a) Sanduhr-Bestand prüfen
        row = conn.execute(
            "SELECT count FROM hourglasses WHERE user_id = ?", (user_id,)
        ).fetchone()
        have = row["count"] if row else 0
        if have < cfg.HOURGLASS_COST:
            raise PackError(
                400,
                f"Zu wenig Sanduhren: hast {have}, brauchst {cfg.HOURGLASS_COST}.",
            )

        # Pool laden (prüft auch, ob das Pack existiert)
        base_pool, excl_pool = get_pack_pool(conn, pack_id)

        # c) Karten würfeln (reine Logik)
        drawn = draw_cards(base_pool, excl_pool, rng=rng)

        # b) Eine Sanduhr abziehen
        conn.execute(
            "UPDATE hourglasses SET count = count - ?, updated_at = datetime('now') "
            "WHERE user_id = ?",
            (cfg.HOURGLASS_COST, user_id),
        )
        remaining = have - cfg.HOURGLASS_COST

        # d) Gezogene Karten in user_cards verbuchen (Duplikate aggregieren)
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

    # e) Beam-Stufe
    beam_stage = determine_beam_stage(drawn)

    return {
        "pack_id": pack_id,
        "drawn_cards": [
            {
                "card_id": c.card_id,
                "name": c.name,
                "rarity": c.rarity,
                "set_id": c.set_id,
                "asset": c.asset,
            }
            for c in drawn
        ],
        "beam_stage": beam_stage,
        "hourglasses_remaining": remaining,
    }
