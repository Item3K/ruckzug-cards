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


def _migrate_pre(conn) -> None:
    """Strukturmigrationen, die VOR dem (Neu-)Anlegen der Tabellen laufen müssen.

    Phase 9b: Trading wurde von 1:1 (Einzelspalten offered_card/requested_card)
    auf Mehrkarten (trade_items) umgestellt. Erkennt man das alte Schema an der
    Spalte trades.offered_card, werden die Trade-Tabellen verworfen, damit
    executescript() sie frisch im neuen Schema anlegt. Es betrifft NUR Trade-
    Tabellen (reine Test-Trades) — andere Tabellen bleiben unangetastet.
    """
    has_trades = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='trades'"
    ).fetchone()
    if not has_trades:
        return
    cols = {r[1] for r in conn.execute("PRAGMA table_info(trades);").fetchall()}
    if "offered_card" in cols:  # altes 1:1-Schema -> Trade-Tabellen neu aufbauen
        conn.execute("DROP TABLE IF EXISTS trade_items;")
        conn.execute("DROP TABLE IF EXISTS trade_history;")
        conn.execute("DROP TABLE IF EXISTS trades;")
        print("Migration: altes 1:1-Trade-Schema verworfen (Test-Trades entfernt).")


def _migrate_post(conn) -> None:
    """Additive, idempotente Spalten-Migrationen für bereits bestehende Tabellen.

    ``CREATE TABLE IF NOT EXISTS`` legt fehlende Tabellen an, ergänzt aber KEINE
    neuen Spalten in bereits existierenden Tabellen — das holen wir hier nach.
    """
    cols = {r[1] for r in conn.execute("PRAGMA table_info(app_users);").fetchall()}
    if cols and "avatar" not in cols:
        conn.execute("ALTER TABLE app_users ADD COLUMN avatar TEXT;")
        print("Migration: app_users.avatar ergänzt.")

    stat_cols = {r[1] for r in conn.execute("PRAGMA table_info(user_stats);").fetchall()}
    if stat_cols and "single_opened" not in stat_cols:
        conn.execute(
            "ALTER TABLE user_stats ADD COLUMN single_opened INTEGER NOT NULL DEFAULT 0;"
        )
        print("Migration: user_stats.single_opened ergänzt.")


def init_db() -> None:
    schema_sql = _SCHEMA_FILE.read_text(encoding="utf-8")

    with db.connection() as conn:
        # WAL wird bereits in db.connect() per PRAGMA gesetzt; hier nur bestätigen.
        mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        _migrate_pre(conn)              # ggf. veraltete Tabellen verwerfen ...
        conn.executescript(schema_sql)  # ... dann (neu) anlegen
        _migrate_post(conn)

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
