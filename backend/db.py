"""Gemeinsamer DB-Zugriffs-Layer für RuckZUG Cards.

Dieses Modul ist die EINE Stelle, an der eine Verbindung zur ``cards.db``
geöffnet wird. Sowohl das Web-Backend (FastAPI) als auch später der Discord-Bot
(Phase 6) importieren ``get_connection()`` von hier, damit überall dieselben
PRAGMAs gelten (WAL + busy_timeout + Foreign Keys).

Bewusst mit dem Standard-``sqlite3`` (synchron) gehalten, damit es ohne
Zusatzpakete von jedem Teil importierbar ist. Eine async-Variante (aiosqlite)
kann später additiv ergänzt werden, ohne dieses Modul zu brechen.

WICHTIG (siehe ROADMAP §3): Dieses Modul fasst NUR ``cards.db`` an.
``database.db`` und ``farm_data.db`` werden hier nie geöffnet oder verändert.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# --- Pfad zur Datenbank -------------------------------------------------------
# Override per Umgebungsvariable CARDS_DB_PATH (siehe .env.example).
# Default: cards.db neben diesem Modul (also backend/cards.db).
_DEFAULT_DB_PATH = Path(__file__).resolve().parent / "cards.db"


def get_db_path() -> Path:
    """Liefert den konfigurierten Pfad zur cards.db als ``Path``."""
    return Path(os.environ.get("CARDS_DB_PATH", str(_DEFAULT_DB_PATH)))


# --- Verbindungsaufbau --------------------------------------------------------
def _apply_pragmas(conn: sqlite3.Connection) -> None:
    """Setzt die für sicheren Parallel-Zugriff nötigen PRAGMAs.

    - ``journal_mode=WAL``  : Leser blockieren Schreiber nicht (Bot ↔ Web).
                              WAL ist persistent pro Datei (einmal gesetzt bleibt es).
    - ``busy_timeout=5000`` : Wartet bis zu 5 s auf eine gesperrte DB, statt
                              sofort mit "database is locked" abzubrechen.
    - ``foreign_keys=ON``   : Erzwingt unsere FK-Beziehungen (per Verbindung nötig).
    """
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA foreign_keys=ON;")


def connect() -> sqlite3.Connection:
    """Öffnet eine neue Verbindung zur cards.db mit gesetzten PRAGMAs.

    ``row_factory`` ist auf ``sqlite3.Row`` gesetzt, sodass man Spalten per Name
    ansprechen kann (``row["count"]``). Aufrufer ist fürs Schließen zuständig —
    oder nutzt bequemer den ``connection()``-Kontextmanager.
    """
    path = get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn)
    return conn


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    """Kontextmanager: öffnet eine Verbindung, committet bei Erfolg, schließt immer.

    Beispiel::

        from db import connection

        with connection() as conn:
            conn.execute("INSERT INTO sets (...) VALUES (...)", (...))
        # commit + close passieren automatisch
    """
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# get_connection als sprechender Alias (so im Auftrag/der Roadmap genannt).
get_connection = connect
