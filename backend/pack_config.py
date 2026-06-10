"""Zentrale Konfiguration fürs Pack-Öffnen (Phase 3a).

WICHTIG (ROADMAP §6 / Phase 3, Cheat-Schutz): Diese Wahrscheinlichkeiten leben
AUSSCHLIESSLICH im Backend und werden NIE ans Frontend ausgeliefert. Der Client
erfährt nur das fertige Ergebnis (gezogene Karten + Beam-Stufe), nie die Chancen.

Alles an EINER Stelle gebündelt, damit Balancing später leicht anpassbar ist.
"""

from __future__ import annotations

# --- Kosten ------------------------------------------------------------------
# Sanduhren, die ein Pack-Öffnen kostet.
HOURGLASS_COST: int = 1

# --- Zuglogik ----------------------------------------------------------------
# Wie viele Karten ein Pack ausgibt (TCG-Pocket-Stil: 10 Karten pro Pack).
CARDS_PER_PACK: int = 10

# Bekannte Raritäten, von niedrig nach hoch (Reihenfolge bestimmt "beste Karte").
RARITY_ORDER: tuple[str, ...] = ("common", "rare", "epic", "legendary")

# Relative Gewichte je Rarität für eine einzelne gezogene Karte.
# (Keine Prozente nötig — werden intern normalisiert.)
RARITY_WEIGHTS: dict[str, float] = {
    "common": 70.0,
    "rare": 22.0,
    "epic": 7.0,
    "legendary": 1.0,
}

# Wahrscheinlichkeit, dass eine gezogene Karte aus dem PACK-EXKLUSIVEN Pool
# kommt statt aus dem set-weiten Basis-Pool — sofern für die gewürfelte Rarität
# in beiden Pools Karten existieren. Existiert nur einer der Pools, wird dieser
# zwingend genutzt.
PACK_EXCLUSIVE_CHANCE: float = 0.20

# --- Beam-Stufen (ROADMAP §6) ------------------------------------------------
# Der Server bestimmt die Beam-Stufe anhand der BESTEN gezogenen Karte.
# Stufen: "normal" (kaum Partikel) / "selten" (weißer Beam) / "jackpot" (golden).
RARITY_TO_BEAM: dict[str, str] = {
    "common": "normal",
    "rare": "selten",
    "epic": "selten",
    "legendary": "jackpot",
}

# Fallback-Beam, falls (unerwartet) keine Karte gezogen wurde.
DEFAULT_BEAM: str = "normal"
