# Datenbank-Schema — `cards.db`

Die `cards.db` ist die **neue, eigene** Datenbank des Kartensystems (WAL-Modus).
Die alten Bot-DBs (`database.db`, `farm_data.db`) bleiben unangetastet
(ROADMAP §3). Verbindungsschlüssel zwischen allen DBs ist die **Discord-`user_id`**.

Definiert in [`backend/schema.sql`](backend/schema.sql), erzeugt durch
[`backend/init_db.py`](backend/init_db.py).

## Konventionen

- **IDs der Definitions-Tabellen** (`set_id`, `pack_id`, `card_id`) sind sprechende
  **TEXT-Slugs** (z.B. `set_tiere`, `pack_wald`, `card_fuchs`) — lesbar und stabil.
- **`user_id`** ist **TEXT** (Discord-IDs sind 64-bit-Snowflakes → als Text sicher).
- Booleans als `INTEGER` `0/1`. Zeitstempel als `TEXT` (`datetime('now')`, ISO-8601).
- `PRAGMA foreign_keys=ON` ist pro Verbindung aktiv (siehe `db.py`).

## Tabellen

### `sets` — Set-Definitionen
| Spalte | Typ | Bedeutung |
|---|---|---|
| `set_id` | TEXT PK | Slug, z.B. `set_tiere` |
| `name` | TEXT | Anzeigename |
| `description` | TEXT | optional |
| `total_cards` | INTEGER | Anzahl Karten im Set (für „x/y"-Anzeige) |
| `sort_order` | INTEGER | Reihenfolge in der UI |
| `created_at` | TEXT | Anlagezeit |

### `packs` — Pack-Definitionen (mehrere pro Set)
| Spalte | Typ | Bedeutung |
|---|---|---|
| `pack_id` | TEXT PK | Slug, z.B. `pack_wald` |
| `set_id` | TEXT FK→`sets` | zugehöriges Set |
| `name` | TEXT | Anzeigename |
| `asset` | TEXT | Pfad/Key zu GLB + Texturen |
| `created_at` | TEXT | Anlagezeit |

### `card_defs` — Karten-Definitionen
| Spalte | Typ | Bedeutung |
|---|---|---|
| `card_id` | TEXT PK | Slug, z.B. `card_fuchs` |
| `set_id` | TEXT FK→`sets` | zugehöriges Set |
| `name` | TEXT | Anzeigename |
| `rarity` | TEXT | `common` / `rare` / `epic` / `legendary` |
| `pack_exclusive_to` | TEXT FK→`packs` | **NULL = Basis-Karte** (set-weit). Sonst nur aus genau diesem Pack ziehbar. |
| `asset` | TEXT | Pfad/Key zum Kartenbild (WebP) |
| `created_at` | TEXT | Anlagezeit |

### `hourglasses` — Sanduhr-Bestand pro User
Sanduhren sind das Platzhalter-Item zum Öffnen von Packs (ROADMAP §10).
| Spalte | Typ | Bedeutung |
|---|---|---|
| `user_id` | TEXT PK | Discord-ID |
| `count` | INTEGER | aktueller Bestand |
| `last_daily_claim` | TEXT | Zeit des letzten Tages-Claims (für „2×/Tag") |
| `updated_at` | TEXT | letzte Änderung |

### `user_cards` — Besitz
| Spalte | Typ | Bedeutung |
|---|---|---|
| `user_id` | TEXT | Discord-ID |
| `card_id` | TEXT FK→`card_defs` | Karte |
| `count` | INTEGER | Anzahl Exemplare (Duplikate ab 10 tauschbar) |
| `updated_at` | TEXT | letzte Änderung |
| | | **PK = (`user_id`, `card_id`)** |

### `set_progress` — Fortschritt pro User & Set
| Spalte | Typ | Bedeutung |
|---|---|---|
| `user_id` | TEXT | Discord-ID |
| `set_id` | TEXT FK→`sets` | Set |
| `owned_count` | INTEGER | distinkte besessene Karten dieses Sets |
| `completed` | INTEGER 0/1 | Set vollständig |
| `reward_claimed` | INTEGER 0/1 | Abschluss-Belohnung abgeholt |
| `completed_at` | TEXT | Abschlusszeit |
| | | **PK = (`user_id`, `set_id`)** |

### `quest_defs` — set-übergreifende Quest-Vorlagen
Reine **Definitionen** (ohne User-Bezug), z.B. „sammle 15 Tiere".
| Spalte | Typ | Bedeutung |
|---|---|---|
| `quest_id` | TEXT PK | Slug der Quest, z.B. `quest_tiere_sammler` |
| `name` | TEXT | Anzeigename |
| `description` | TEXT | z.B. „Sammle 15 verschiedene Tiere." |
| `goal_count` | INTEGER | Zielmenge (z.B. 15) |
| `reward_type` | TEXT | z.B. `hourglasses` / `currency` |
| `reward_amount` | INTEGER | Höhe der Belohnung |
| `active` | INTEGER 0/1 | Quest aktiv |
| `created_at` | TEXT | Anlagezeit |

### `quest_progress` — per-User-Fortschritt zu einer Quest
Pro User und Quest **eine** Zeile; verweist auf die Vorlage in `quest_defs`.
| Spalte | Typ | Bedeutung |
|---|---|---|
| `user_id` | TEXT | Discord-ID |
| `quest_id` | TEXT FK→`quest_defs` | Quest |
| `progress_count` | INTEGER | aktueller Stand des Users |
| `completed` | INTEGER 0/1 | erfüllt |
| `reward_claimed` | INTEGER 0/1 | Belohnung abgeholt |
| `updated_at` | TEXT | letzte Änderung |
| | | **PK = (`user_id`, `quest_id`)** |
