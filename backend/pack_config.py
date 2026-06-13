"""Zentrale Konfiguration fürs Pack-Öffnen (Phase 5b).

Die Slot-WAHRSCHEINLICHKEITEN liegen primär in der set_config.json (pro Pack,
per Seed in cards.db.packs.draw_config übertragen) — NICHT mehr hier. Hier
bleiben nur Kosten, die Beam-Stufen-Regeln und ein Fallback-Draw.

WICHTIG (ROADMAP §6, Cheat-Schutz): Wahrscheinlichkeiten bleiben serverseitig.
"""

from __future__ import annotations

# --- Kosten ------------------------------------------------------------------
HOURGLASS_COST: int = 1

# --- Beam-Stufen (ROADMAP §6): aus der BESTEN gezogenen Karte ----------------
# Stufen: "normal" / "selten" (weiß) / "jackpot" (gold).
BEAM_JACKPOT_FINISHES = {"full_art", "full_art_holo"}
BEAM_JACKPOT_RARITIES = {"ultra_rare", "rainbow_rare"}
BEAM_SELTEN_FINISHES = {"holo", "reverse_holo"}
# Bewusst leer: jedes Pack hat (Slot 9) garantiert eine rare. Würde "rare" hier
# stehen, wäre die Stufe fast immer "selten". Stattdessen markiert "selten" einen
# echten Finish-Treffer (holo/reverse), "jackpot" einen Hit (full_art/rainbow).
BEAM_SELTEN_RARITIES: set[str] = set()
DEFAULT_BEAM: str = "normal"


def card_beam_tier(rarity: str, finish: str) -> int:
    """Beam-Rang einer Karte: 2 = jackpot, 1 = selten, 0 = normal."""
    if finish in BEAM_JACKPOT_FINISHES or rarity in BEAM_JACKPOT_RARITIES:
        return 2
    if finish in BEAM_SELTEN_FINISHES or rarity in BEAM_SELTEN_RARITIES:
        return 1
    return 0


BEAM_TIER_TO_STAGE = {2: "jackpot", 1: "selten", 0: "normal"}

# --- Fallback-Draw -----------------------------------------------------------
# Nur falls ein Pack KEINE draw_config in der DB hat (sollte nicht vorkommen, da
# der Seed sie aus set_config.json schreibt). Gleiche Struktur wie default_draw.
FALLBACK_DRAW = {
    "cards_per_pack": 10,
    "slots": [
        {"repeat": 6, "outcomes": [{"w": 100, "rarity": "common", "finish": "normal"}]},
        {"repeat": 2, "outcomes": [
            {"w": 90, "rarity": "common", "finish": "normal"},
            {"w": 10, "rarity": "rare", "finish": "normal"},
        ]},
        {"repeat": 1, "outcomes": [
            {"w": 90, "rarity": "rare", "finish": "normal"},
            {"w": 7, "rarity": "rare", "finish": "holo"},
            {"w": 3, "rarity": "rare", "finish": "reverse_holo"},
        ]},
        {"repeat": 1, "outcomes": [
            {"w": 70, "rarity": "rare", "finish": "normal"},
            {"w": 15, "finish": "holo"},
            {"w": 10, "finish": "reverse_holo"},
            {"w": 4, "finish": "full_art"},
            {"w": 1, "finish": "full_art_holo"},
        ]},
    ],
}
