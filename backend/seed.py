"""Seed-Skript für RuckZUG Cards (Phase 5b).

Quelle der Wahrheit für Set/Packs/Karten ist die set_config.json im Frontend
(frontend/public/sets/<set>/set_config.json). Dieses Skript liest sie ein und
überträgt Set, Packs (inkl. Slot-Würfel-Konfig als draw_config) und card_defs
(inkl. finish) in die cards.db. Die alten "Tiere"-Testdaten entfallen.

Aufruf::

    python seed.py        # aus dem backend-Ordner

Hinweis: Wenn sich das Schema geändert hat (neue Spalten finish/draw_config),
die cards.db neu erzeugen: alte Datei löschen, dann python init_db.py + python seed.py.
"""

from __future__ import annotations

import json
from pathlib import Path

import db

# Welche(s) Set(s) in die DB gespiegelt werden (Ordnernamen unter sets/).
SET_IDS = ["set_ruckzug1"]

# Pfad zur Set-Struktur im Frontend (Quelle der Wahrheit).
_SETS_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public" / "sets"

# Test-User mit Sanduhren, damit /api/open-pack lokal sofort testbar ist.
TEST_USERS = [{"user_id": "test_user_1", "count": 10}]


def _load_set_config(set_id: str) -> dict:
    path = _SETS_DIR / set_id / "set_config.json"
    return json.loads(path.read_text(encoding="utf-8"))


def seed_set(conn, set_id: str) -> tuple[int, int]:
    cfg = _load_set_config(set_id)
    cards = cfg.get("cards", [])
    packs = cfg.get("packs", [])
    default_draw = cfg.get("default_draw")

    conn.execute(
        "INSERT OR REPLACE INTO sets (set_id, name, description, total_cards, sort_order) "
        "VALUES (?, ?, ?, ?, ?)",
        (cfg["set_id"], cfg["name"], cfg.get("description", cfg["name"]), len(cards), 1),
    )

    for p in packs:
        # Effektive Würfel-Konfig: eigenes pack['draw'] sonst set-weites default_draw.
        draw = p.get("draw") or default_draw
        conn.execute(
            "INSERT OR REPLACE INTO packs (pack_id, set_id, name, asset, draw_config) "
            "VALUES (?, ?, ?, ?, ?)",
            (p["pack_id"], cfg["set_id"], p["name"], p.get("rip"),
             json.dumps(draw) if draw is not None else None),
        )

    for c in cards:
        conn.execute(
            "INSERT OR REPLACE INTO card_defs "
            "(card_id, set_id, name, rarity, finish, pack_exclusive_to, asset) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (c["card_id"], c.get("set_id", cfg["set_id"]), c["name"],
             c.get("rarity", "common"), c.get("finish", "normal"),
             c.get("pack_exclusive_to"), c.get("asset")),
        )

    return len(packs), len(cards)


def seed() -> None:
    with db.connection() as conn:
        total_packs = total_cards = 0
        for set_id in SET_IDS:
            np, nc = seed_set(conn, set_id)
            total_packs += np
            total_cards += nc
            print(f"Set '{set_id}': {np} Packs, {nc} Karten-Defs eingespielt.")

        conn.executemany(
            "INSERT OR REPLACE INTO hourglasses (user_id, count, updated_at) "
            "VALUES (:user_id, :count, datetime('now'))",
            TEST_USERS,
        )

    users_desc = ", ".join(f"{u['user_id']}={u['count']} Sanduhren" for u in TEST_USERS)
    print(f"Gesamt: {total_packs} Packs, {total_cards} Karten-Defs.")
    print(f"Test-User: {users_desc}")


if __name__ == "__main__":
    seed()
