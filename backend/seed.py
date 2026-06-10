"""Seed-Skript für RuckZUG Cards (Phase 1).

Füllt die cards.db mit Testdaten, damit wir etwas zum Anschauen/Entwickeln haben:
- 1 Test-Set ("Tiere")
- 2 Packs in diesem Set
- ein paar Karten: Basis-Karten (set-weit) + pro Pack eine pack-exklusive Karte

Idempotent dank ``INSERT OR REPLACE`` auf festen Slug-IDs — mehrfaches Ausführen
erzeugt keine Duplikate. Setzt voraus, dass init_db.py vorher lief (Tabellen da).

Aufruf::

    python backend/seed.py        # oder aus dem backend-Ordner: python seed.py
"""

from __future__ import annotations

import db

# --- Testdaten ---------------------------------------------------------------
SET = {
    "set_id": "set_tiere",
    "name": "Tiere",
    "description": "Test-Set für Phase 1 (Entwicklung).",
    "total_cards": 6,
    "sort_order": 1,
}

PACKS = [
    {"pack_id": "pack_wald", "set_id": "set_tiere", "name": "Waldpack", "asset": "packs/wald.glb"},
    {"pack_id": "pack_meer", "set_id": "set_tiere", "name": "Meerpack", "asset": "packs/meer.glb"},
]

# pack_exclusive_to = None -> Basis-Karte (aus jedem Pack des Sets ziehbar)
CARDS = [
    # Basis-Karten (set-weit)
    {"card_id": "card_fuchs",  "set_id": "set_tiere", "name": "Fuchs",  "rarity": "common", "pack_exclusive_to": None,        "asset": "cards/fuchs.webp"},
    {"card_id": "card_hase",   "set_id": "set_tiere", "name": "Hase",   "rarity": "common", "pack_exclusive_to": None,        "asset": "cards/hase.webp"},
    {"card_id": "card_eule",   "set_id": "set_tiere", "name": "Eule",   "rarity": "rare",   "pack_exclusive_to": None,        "asset": "cards/eule.webp"},
    # Pack-exklusiv: nur aus dem Waldpack
    {"card_id": "card_hirsch", "set_id": "set_tiere", "name": "Hirsch", "rarity": "epic",   "pack_exclusive_to": "pack_wald", "asset": "cards/hirsch.webp"},
    # Pack-exklusiv: nur aus dem Meerpack
    {"card_id": "card_hai",    "set_id": "set_tiere", "name": "Hai",    "rarity": "epic",      "pack_exclusive_to": "pack_meer", "asset": "cards/hai.webp"},
    {"card_id": "card_wal",    "set_id": "set_tiere", "name": "Blauwal","rarity": "legendary", "pack_exclusive_to": "pack_meer", "asset": "cards/wal.webp"},
]


def seed() -> None:
    with db.connection() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO sets (set_id, name, description, total_cards, sort_order) "
            "VALUES (:set_id, :name, :description, :total_cards, :sort_order)",
            SET,
        )
        conn.executemany(
            "INSERT OR REPLACE INTO packs (pack_id, set_id, name, asset) "
            "VALUES (:pack_id, :set_id, :name, :asset)",
            PACKS,
        )
        conn.executemany(
            "INSERT OR REPLACE INTO card_defs "
            "(card_id, set_id, name, rarity, pack_exclusive_to, asset) "
            "VALUES (:card_id, :set_id, :name, :rarity, :pack_exclusive_to, :asset)",
            CARDS,
        )

    print("Seed eingespielt:")
    print(f"  Sets : 1  ({SET['name']})")
    print(f"  Packs: {len(PACKS)}  ({', '.join(p['name'] for p in PACKS)})")
    base = sum(1 for c in CARDS if c['pack_exclusive_to'] is None)
    excl = len(CARDS) - base
    print(f"  Karten: {len(CARDS)}  ({base} Basis, {excl} pack-exklusiv)")


if __name__ == "__main__":
    seed()
