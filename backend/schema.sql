-- RuckZUG Cards — Schema für cards.db (Phase 1)
-- Tabellen gemäß ROADMAP §7. Nur additiv, nur cards.db.
-- IDs der Definitions-Tabellen sind TEXT-Slugs (z.B. 'set_animals'),
-- damit Seed-Daten lesbar und über Umgebungen hinweg stabil sind.
-- user_id ist TEXT (Discord-Schneeflocken-IDs sind 64-bit -> als Text sicher).

-- =====================================================================
-- sets — Set-Definitionen
-- =====================================================================
CREATE TABLE IF NOT EXISTS sets (
    set_id       TEXT PRIMARY KEY,
    name         TEXT    NOT NULL,
    description  TEXT,
    total_cards  INTEGER NOT NULL DEFAULT 0,   -- Anzahl Karten im Set (für "x/y"-Anzeige)
    sort_order   INTEGER NOT NULL DEFAULT 0,   -- Reihenfolge in der UI
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- packs — Pack-Definitionen (mehrere Packs pro Set)
-- =====================================================================
CREATE TABLE IF NOT EXISTS packs (
    pack_id     TEXT PRIMARY KEY,
    set_id      TEXT NOT NULL,
    name        TEXT NOT NULL,
    asset       TEXT,                          -- Pfad/Key zu GLB + Texturen
    draw_config TEXT,                          -- JSON: Slot-Würfel-Konfig (aus set_config.json)
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (set_id) REFERENCES sets (set_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_packs_set ON packs (set_id);

-- =====================================================================
-- card_defs — Karten-Definitionen
--   pack_exclusive_to = NULL  -> Basis-Karte (set-weit aus jedem Pack des Sets)
--   pack_exclusive_to = pack_id -> nur aus genau diesem Pack ziehbar
-- =====================================================================
CREATE TABLE IF NOT EXISTS card_defs (
    card_id            TEXT PRIMARY KEY,
    set_id             TEXT NOT NULL,
    name               TEXT NOT NULL,
    rarity             TEXT NOT NULL DEFAULT 'common',  -- common | rare | ultra_rare | rainbow_rare
    finish             TEXT NOT NULL DEFAULT 'normal',  -- normal | holo | reverse_holo | full_art | full_art_holo
    pack_exclusive_to  TEXT,                            -- NULL = Basis-Karte (set-weit)
    asset              TEXT,                            -- Pfad zur Front-PNG (relativ zum Set-Ordner)
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (set_id)            REFERENCES sets  (set_id)  ON DELETE CASCADE,
    FOREIGN KEY (pack_exclusive_to) REFERENCES packs (pack_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_carddefs_set  ON card_defs (set_id);
CREATE INDEX IF NOT EXISTS idx_carddefs_pack ON card_defs (pack_exclusive_to);

-- =====================================================================
-- hourglasses — Sanduhr-Bestand pro User (Währung zum Pack-Öffnen)
-- =====================================================================
CREATE TABLE IF NOT EXISTS hourglasses (
    user_id           TEXT PRIMARY KEY,
    count             INTEGER NOT NULL DEFAULT 0,
    last_daily_claim  TEXT,                            -- ISO-Zeit des letzten Tages-Claims
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- user_cards — Besitz: wie viele Exemplare einer Karte hat ein User
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_cards (
    user_id    TEXT    NOT NULL,
    card_id    TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, card_id),
    FOREIGN KEY (card_id) REFERENCES card_defs (card_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_usercards_card ON user_cards (card_id);

-- =====================================================================
-- set_progress — Fortschritt eines Users pro Set (für Set-Belohnungen)
-- =====================================================================
CREATE TABLE IF NOT EXISTS set_progress (
    user_id         TEXT    NOT NULL,
    set_id          TEXT    NOT NULL,
    owned_count     INTEGER NOT NULL DEFAULT 0,   -- distinkte besessene Karten dieses Sets
    completed       INTEGER NOT NULL DEFAULT 0,   -- 0/1: Set vollständig
    reward_claimed  INTEGER NOT NULL DEFAULT 0,   -- 0/1: Abschluss-Belohnung abgeholt
    completed_at    TEXT,
    PRIMARY KEY (user_id, set_id),
    FOREIGN KEY (set_id) REFERENCES sets (set_id) ON DELETE CASCADE
);

-- =====================================================================
-- quest_defs — set-übergreifende Quest-VORLAGEN (z.B. "sammle 15 Tiere")
--   Reine Definition, ohne User-Bezug.
-- =====================================================================
CREATE TABLE IF NOT EXISTS quest_defs (
    quest_id       TEXT PRIMARY KEY,
    name           TEXT    NOT NULL,
    description    TEXT,
    goal_count     INTEGER NOT NULL DEFAULT 1,    -- Zielmenge (z.B. 15)
    reward_type    TEXT,                          -- z.B. 'hourglasses' | 'currency'
    reward_amount  INTEGER NOT NULL DEFAULT 0,
    active         INTEGER NOT NULL DEFAULT 1,    -- 0/1: Quest aktiv
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- quest_progress — per-User-FORTSCHRITT zu einer Quest-Vorlage
-- =====================================================================
CREATE TABLE IF NOT EXISTS quest_progress (
    user_id         TEXT    NOT NULL,
    quest_id        TEXT    NOT NULL,
    progress_count  INTEGER NOT NULL DEFAULT 0,   -- aktueller Stand des Users
    completed       INTEGER NOT NULL DEFAULT 0,   -- 0/1
    reward_claimed  INTEGER NOT NULL DEFAULT 0,   -- 0/1
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, quest_id),
    FOREIGN KEY (quest_id) REFERENCES quest_defs (quest_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_questprogress_quest ON quest_progress (quest_id);

-- =====================================================================
-- app_users — wer hat sich je auf der Website eingeloggt (Phase 8/13a)
--   Wird bei jedem Login (OAuth + Dev) per UPSERT aktualisiert. Basis für die
--   Admin-User-Liste. (Nicht zu verwechseln mit der alten database.db.users.)
-- =====================================================================
CREATE TABLE IF NOT EXISTS app_users (
    user_id      TEXT PRIMARY KEY,
    username     TEXT,
    avatar       TEXT,                            -- Discord-Avatar-Hash (für die Avatar-URL)
    first_login  TEXT NOT NULL DEFAULT (datetime('now')),
    last_login   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- user_stats — einfache Pro-User-Statistiken (Profil-Grundlage, Phase 9/Quests)
--   Wird serverseitig im selben Vorgang wie das Pack-Öffnen hochgezählt.
--   packs_opened  = ALLE geöffneten Booster (Einzel +1, x10 +10).
--   single_opened = nur Einzel-Booster (+1 je Einzelöffnung; x10 zählt NICHT mit).
--   Erweiterbar um weitere Statistik-Spalten.
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_stats (
    user_id       TEXT PRIMARY KEY,
    packs_opened  INTEGER NOT NULL DEFAULT 0,
    single_opened INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- trades — Mehrkarten-Tausch zwischen zwei Usern (Phase 9b, Website)
--   from_user (A) bietet 1–5 Karten; to_user (B) gibt 1–5 Karten. Die konkreten
--   Karten stehen in trade_items (eine Zeile je Karte+Seite), NICHT mehr als
--   Einzelspalten. Rollen A/B sind über den ganzen Trade FEST; Gegenvorschläge
--   ändern nur die Karten-Listen + wer am Zug ist (turn_user).
--   status: open | accepted | rejected | cancelled.
--   turn_user = wer als Nächstes annehmen/ablehnen/kontern darf (NULL wenn beendet).
--   Die Tausch-Logik liegt in backend/trade_logic.py (auch vom Bot nutzbar).
-- =====================================================================
CREATE TABLE IF NOT EXISTS trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user       TEXT    NOT NULL,                 -- A (Ersteller)
    to_user         TEXT    NOT NULL,                 -- B (Empfänger)
    status          TEXT    NOT NULL DEFAULT 'open',  -- open|accepted|rejected|cancelled
    turn_user       TEXT,                             -- wer ist am Zug (NULL = beendet)
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trades_from   ON trades (from_user);
CREATE INDEX IF NOT EXISTS idx_trades_to     ON trades (to_user);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status);

-- =====================================================================
-- trade_items — die Karten eines Trades, je Seite (Verknüpfungstabelle)
--   side = 'from' (A bietet) | 'to' (B gibt). Der PK (trade_id, side, card_id)
--   verhindert seiteninterne Duplikate bereits auf DB-Ebene. Reihenfolge der
--   Slots = Einfügereihenfolge (rowid).
-- =====================================================================
CREATE TABLE IF NOT EXISTS trade_items (
    trade_id  INTEGER NOT NULL,
    side      TEXT    NOT NULL,                       -- 'from' | 'to'
    card_id   TEXT    NOT NULL,
    PRIMARY KEY (trade_id, side, card_id),
    FOREIGN KEY (trade_id) REFERENCES trades (id)      ON DELETE CASCADE,
    FOREIGN KEY (card_id)  REFERENCES card_defs (card_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tradeitems_trade ON trade_items (trade_id);

-- =====================================================================
-- trade_history — Verlauf eines Trades (Erstellung + jeder Gegenvorschlag etc.)
--   Für die Verhandlungs-Anzeige; ein Eintrag je Aktion. Die Karten-Listen
--   werden als JSON-Array (card_ids) je Seite als Schnappschuss gespeichert.
-- =====================================================================
CREATE TABLE IF NOT EXISTS trade_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id        INTEGER NOT NULL,
    actor           TEXT    NOT NULL,                 -- wer die Aktion ausgelöst hat
    action          TEXT    NOT NULL,                 -- create|counter|accept|reject|cancel
    from_cards      TEXT,                             -- JSON-Array card_ids (A-Seite, nach Aktion)
    to_cards        TEXT,                             -- JSON-Array card_ids (B-Seite, nach Aktion)
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (trade_id) REFERENCES trades (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tradehist_trade ON trade_history (trade_id);
