"""Init-/Migrations-Skript für RuckZUG Cards (Phase 1).

Legt die ``cards.db`` an (falls noch nicht vorhanden), schaltet sie in den
WAL-Modus und erstellt alle Tabellen aus ``schema.sql``. Idempotent: mehrfaches
Ausführen schadet nicht (CREATE TABLE IF NOT EXISTS).

Aufruf::

    python backend/init_db.py        # oder aus dem backend-Ordner: python init_db.py

Fasst ausschließlich ``cards.db`` an (siehe ROADMAP §3). ``database.db`` /
``farm_data.db`` werden nicht berührt.
"""

from __future__ import annotations

from pathlib import Path

import db  # gemeinsamer Zugriffs-Layer (setzt WAL + busy_timeout + foreign_keys)

_SCHEMA_FILE = Path(__file__).resolve().parent / "schema.sql"


def init_db() -> None:
    schema_sql = _SCHEMA_FILE.read_text(encoding="utf-8")

    with db.connection() as conn:
        # WAL wird bereits in db.connect() per PRAGMA gesetzt; hier nur bestätigen.
        mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        conn.executescript(schema_sql)

    print(f"cards.db initialisiert unter: {db.get_db_path()}")
    print(f"journal_mode = {mode}")

    # Kontrolle: welche Tabellen existieren jetzt?
    with db.connection() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name;"
        ).fetchall()
    tables = [r[0] for r in rows]
    print(f"Tabellen ({len(tables)}): {', '.join(tables)}")


if __name__ == "__main__":
    init_db()
