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

### `app_users` — wer hat sich je auf der Website eingeloggt (Phase 8/13a)
Wird bei jedem Login (Discord-OAuth) per UPSERT aktualisiert. Basis für Admin-User-
und Handelspartner-Listen sowie Avatar-Anzeige. (Nicht zu verwechseln mit der alten
`database.db.users` des Bots.)
| Spalte | Typ | Bedeutung |
|---|---|---|
| `user_id` | TEXT PK | Discord-ID |
| `username` | TEXT | zuletzt gesehener Anzeigename |
| `avatar` | TEXT | Discord-Avatar-Hash (→ CDN-URL, Fallback Default-Avatar) |
| `first_login` | TEXT | erster Login |
| `last_login` | TEXT | letzter Login |

### `trades` — Mehrkarten-Tausch zwischen zwei Usern (Phase 9b)
A (`from_user`) bietet 1–5 Karten, B (`to_user`) gibt 1–5 Karten. Die konkreten Karten
stehen in **`trade_items`** (nicht mehr als Einzelspalten). Rollen A/B sind über den
ganzen Trade **fest**; Gegenvorschläge ändern nur die Karten-Listen und `turn_user`.
Ausführung atomar in [`backend/trade_logic.py`](backend/trade_logic.py) (auch vom
Discord-Bot wiederverwendbar).
| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | INTEGER PK AI | Trade-ID |
| `from_user` | TEXT | A — Ersteller |
| `to_user` | TEXT | B — Empfänger |
| `status` | TEXT | `open` / `accepted` / `rejected` / `cancelled` |
| `turn_user` | TEXT | wer ist am Zug (NULL = beendet) |
| `created_at` | TEXT | Erstellzeit |
| `updated_at` | TEXT | letzte Änderung |

### `trade_items` — Karten eines Trades je Seite (Verknüpfungstabelle)
Eine Zeile je Karte und Seite. Der PK verhindert seiteninterne Duplikate; die Logik
stellt zusätzlich 1–5 Karten/Seite und **keine Überschneidung** zwischen den Seiten sicher.
| Spalte | Typ | Bedeutung |
|---|---|---|
| `trade_id` | INTEGER FK→`trades` | zugehöriger Trade |
| `side` | TEXT | `from` (A bietet) / `to` (B gibt) |
| `card_id` | TEXT FK→`card_defs` | Karte |
| | | **PK = (`trade_id`, `side`, `card_id`)** |

### `trade_history` — Verlauf eines Trades (Verhandlung)
Ein Eintrag je Aktion (Erstellung, jeder Gegenvorschlag, Abschluss) für die Anzeige.
Die Karten-Listen werden als **JSON-Array** (`card_id`s) je Seite als Schnappschuss abgelegt.
| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | INTEGER PK AI | |
| `trade_id` | INTEGER FK→`trades` | zugehöriger Trade |
| `actor` | TEXT | wer die Aktion ausgelöst hat |
| `action` | TEXT | `create` / `counter` / `accept` / `reject` / `cancel` |
| `from_cards` | TEXT (JSON) | A-Seite-Karten nach der Aktion |
| `to_cards` | TEXT (JSON) | B-Seite-Karten nach der Aktion |
| `created_at` | TEXT | Zeit der Aktion |
