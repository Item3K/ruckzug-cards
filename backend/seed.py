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

# Quest-VORLAGEN (ohne User-Bezug). Per-User-Fortschritt entsteht später in
# quest_progress, sobald echte User mitspielen — daher hier nur Definitionen.
QUEST_DEFS = [
    {"quest_id": "quest_tiere_sammler", "name": "Tier-Sammler", "description": "Sammle 15 verschiedene Tiere.",
     "goal_count": 15, "reward_type": "hourglasses", "reward_amount": 3, "active": 1},
]

# Test-User mit Sanduhren, damit man /api/open-pack lokal sofort testen kann.
# INSERT OR REPLACE setzt den Bestand bei jedem Seed-Lauf auf diesen Baseline-Wert.
# (Echte User entstehen später per OAuth in Phase 3b.)
TEST_USERS = [
    {"user_id": "test_user_1", "count": 10},
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
        conn.executemany(
            "INSERT OR REPLACE INTO quest_defs "
            "(quest_id, name, description, goal_count, reward_type, reward_amount, active) "
            "VALUES (:quest_id, :name, :description, :goal_count, :reward_type, :reward_amount, :active)",
            QUEST_DEFS,
        )
        conn.executemany(
            "INSERT OR REPLACE INTO hourglasses (user_id, count, updated_at) "
            "VALUES (:user_id, :count, datetime('now'))",
            TEST_USERS,
        )

    print("Seed eingespielt:")
    print(f"  Sets : 1  ({SET['name']})")
    print(f"  Packs: {len(PACKS)}  ({', '.join(p['name'] for p in PACKS)})")
    base = sum(1 for c in CARDS if c['pack_exclusive_to'] is None)
    excl = len(CARDS) - base
    print(f"  Karten: {len(CARDS)}  ({base} Basis, {excl} pack-exklusiv)")
    print(f"  Quest-Vorlagen: {len(QUEST_DEFS)}  ({', '.join(q['name'] for q in QUEST_DEFS)})")
    users_desc = ', '.join(f"{u['user_id']}={u['count']} Sanduhren" for u in TEST_USERS)
    print(f"  Test-User: {len(TEST_USERS)}  ({users_desc})")


if __name__ == "__main__":
    seed()
