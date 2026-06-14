"""Einmal-Cleanup: entfernt Dev-/Test-User aus cards.db (Phase 13a-Nachzug).

Seit der Dev-Login (`/api/dev/login`) abgeschafft ist, sollen die damit erzeugten
Test-User (Standard: ``test_user_1``) aus allen cards.db-Tabellen verschwinden,
damit sie nicht mehr in der Admin-User-Liste auftauchen.

Aufruf::

    py -3 backend/cleanup_dev_users.py                # entfernt test_user_1
    py -3 backend/cleanup_dev_users.py test_user_1 foo  # mehrere user_ids

Fasst NUR cards.db an (siehe ROADMAP §3). Idempotent.
"""

from __future__ import annotations

import sys

import db

# Tabellen mit einer user_id-Spalte, aus denen der User entfernt wird.
_USER_TABLES = (
    "app_users",
    "hourglasses",
    "user_cards",
    "set_progress",
    "quest_progress",
)


def cleanup(user_ids: list[str]) -> None:
    with db.connection() as conn:
        for uid in user_ids:
            removed = 0
            for table in _USER_TABLES:
                cur = conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (uid,))
                removed += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
            print(f"'{uid}': {removed} Zeile(n) entfernt.")
    print("Cleanup fertig.")


if __name__ == "__main__":
    ids = sys.argv[1:] or ["test_user_1"]
    cleanup(ids)
