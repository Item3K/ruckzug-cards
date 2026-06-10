# RuckZUG Cards — Projekt-Roadmap & Arbeitsanweisung für Claude Code

> **Diese Datei ist die Projekt-Bibel.** Claude Code liest sie zuerst und richtet sich
> in JEDEM Auftrag danach. Wenn ein Auftrag dieser Datei widerspricht, hat diese Datei
> Vorrang — im Zweifel nachfragen, nicht raten.

---

## 1. Vision (was wir bauen)

Ein **Sammelkarten-System** für den RuckZUG-Discord-Server. User sammeln im Discord
Währung und Items über den bestehenden Bot. Zusätzlich gibt es jetzt **Booster-Packs
mit Sammelkarten**, die man auf einer **Website** (gehostet auf einem Raspberry Pi)
in 3D öffnet — Pack drehen, auf Knopfdruck aufratschen, goldener Lichtstrahl, Karten-Reveal.

Das Kartensystem läuft **zusätzlich** zum bestehenden Lootbox-/Farm-System, nicht als Ersatz.

---

## 2. Kern-Architektur-Entscheidungen (final)

| Thema | Entscheidung |
|---|---|
| Hosting | **Alles auf dem Raspberry Pi**: Bot + Web-Backend + alle DBs + Assets |
| Alte Synology | Wird zu **Backup-Ziel** (nächtliches rsync). Keine Live-Daten mehr drauf. |
| Speicher Pi | SD-Karte zum Start (OK fürs Entwickeln + erste Live-Phase). SSD-Upgrade später empfohlen. |
| Web-Backend | **Python + FastAPI** (gleiche Sprache wie der Bot → geteilter DB-Code möglich) |
| Frontend | **Three.js** (3D-Pack im Browser), gebaut mit **Vite** |
| Datenbank (neu) | Eigene **`cards.db`** im **WAL-Modus** + `busy_timeout` (sicherer Parallel-Zugriff Bot ↔ Web) |
| Datenbanken (alt) | `database.db` und `farm_data.db` bleiben **inhaltlich unangetastet** |
| Verbindungsschlüssel | `user_id` (Discord-ID) — verbindet alle DBs |
| Login Website | **Discord OAuth** (liefert verifiziert die user_id) |
| Erreichbarkeit | **Cloudflare Tunnel** (kein Port-Forwarding, keine Heim-IP sichtbar, HTTPS) |
| Rendering-Last | 3D läuft im **Browser des Users** (WebGL), nicht auf dem Pi. Pi liefert nur Dateien + API. |

---

## 3. ⛔ LEITPLANKEN FÜR CLAUDE CODE — IMMER EINHALTEN

1. **Branches:** Arbeite NUR in Feature-Branches (`feature/...`). **Niemals direkt auf `main` pushen.**
   Falls ein `main`-Push wirklich nötig wird → **erst nachfragen**, Begründung nennen, auf Freigabe warten.
2. **`.env`:** Niemals lesen-ohne-zu-fragen, niemals committen, niemals pushen. Wenn du eine ID/ein
   Secret brauchst → sag dem User, welche Variable er in `.env` hinterlegen soll. Frag um Erlaubnis,
   bevor du `.env` überhaupt ansiehst.
3. **Datenbanken:** `*.db`-Dateien werden **nie verändert oder gepusht** (stehen in `.gitignore`).
   Du darfst Code schreiben, der NEUE Tabellen in `cards.db` anlegt. Du darfst KEINE bestehenden
   Tabellen/Spalten in `database.db` oder `farm_data.db` verändern oder löschen.
4. **Falls doch eine Spalte am Alten nötig wäre:** nur `ALTER TABLE ... ADD COLUMN` (non-destruktiv),
   und nur **nach ausdrücklicher Freigabe** des Users.
5. **Bestehendes nicht kaputtmachen:** Der Bot (`main.py`, alle aktiven Cogs) muss nach jeder
   Änderung weiterhin starten und alle alten Befehle (`!rz`, `!open`, `!craft`, `!top`, Admin-Befehle)
   müssen unverändert funktionieren.
6. **Tabu-Dateien:** `cogs/easter_event.py.disabled` bleibt deaktiviert (nicht löschen, nicht
   reaktivieren). `cogs/app_api.py.disabled` wird **ignoriert** (war ein anderer Ansatz — nicht als
   Vorlage verwenden, nicht reaktivieren).
7. **Separates Repo:** Das Kartenspiel-Web-Projekt lebt in einem **eigenen Repo**, nicht im Bot-Repo.
   Der Bot bekommt nur einen **neuen Cog** hinzu (für die Sammlungs-Anzeige im Channel).
8. **Iterativ:** Eine Phase = ein abgeschlossener, testbarer Brocken. Nach jeder Phase anhalten und
   dem User sagen, wie er es testen kann. Nicht mehrere Phasen auf einmal bauen.

---

## 4. Bestehendes System (Stand heute)

**Was es ist:** Discord-Bot (Python, `discord.py`), dockerisiert (Dockerfile vorhanden).

**Cogs (aktiv):**
- `lootbox.py` — User sammeln durch Schreiben in Track-Channels „Boxen", öffnen sie mit `!open` /
  `!open_golden` → bekommen **UnbelievaBoat-Währung** gutgeschrieben (via UnbelievaBoat-API,
  Methode `update_ub_balance`). `!craft` wandelt Boxen in Gold-Boxen.
- `farm_commands.py` + `farm_logic.py` — Farm-Minispiel (eigene DB).
- `fun_commands.py` — Kleinkram.

**Datenbanken:**
- `database.db` → Tabelle `users` (`user_id, msg_count, boxes, gold_boxes, opened_normal,
  opened_gold, last_claim`) + `settings`. **Hier stehen die Boxen-Bestände.**
- `farm_data.db` → `farm_inventory` (Farm-Items). Für Kartenspiel irrelevant.

**`.env` enthält** (Namen, keine Werte): `DISCORD_TOKEN`, `ADMIN_CHANNEL`, `UB_TOKEN`, `GUILD_ID`,
`TRACK_CHANNELS`, `COMMAND_CHANNEL`, `FARM_CHANNEL`. → Für das Kartenspiel kommt voraussichtlich
eine neue Channel-ID dazu (Sammlungs-Channel) + OAuth-Secrets.

---

## 5. Spielmechanik (Soll-Konzept)

- **Sets:** Mehrere Sets (Start: 5). Jedes Set hat **mehrere Packs**. Aus Packs kommen **Basis-Karten**
  (set-weit) + **pack-exklusive Karten** (nur aus diesem einen Pack ziehbar).
- **Öffnen kostet „Sanduhren"** (Arbeitstitel/Platzhalter — eigenes Item kommt später). Man bekommt
  begrenzt welche pro Tag (z.B. 2×/Tag) + zusätzlich aus Lootboxen / Quest-Belohnungen.
- **Karten kommen ZUSÄTZLICH** zur bestehenden UnbelievaBoat-Belohnung, nicht statt ihr.
- **Duplikate:** Ab 10 Stück einer Karte → eintauschbar in UnbelievaBoat-Währung.
- **Belohnungen:** Set komplett abschließen → Belohnung. Set-übergreifende Quests (z.B. „sammle 15
  Tiere") → Belohnung.
- **Sammlung ansehen:**
  - Auf der **Website**: eigene Sammlung komplett; nur **besessene** Karten sichtbar, fehlende als
    grauer Platzhalter mit `?`. Per Default sieht man, **wie viele Karten ein Set hat**. Fremde
    Sammlungen sind ebenfalls einsehbar (durchschauen erlaubt).
  - Im **Discord-Channel**: Befehl zeigt die Set-Sammlung, darunter Buttons zum Durchcyceln.
    Eigene + fremde Sammlungen einsehbar.

---

## 6. Optik / 3D (bereits erarbeitet — Stand & Regeln)

**In Blender (fertig bzw. in Arbeit):**
- Pack-Modell, Folie als **zweigeteiltes Mesh** (Ober-/Unterteil an gezackter Risskante).
- Oberteil-**Origin sitzt an der Risskante** (Scharnier-Punkt), Aufreiß-Animation = Oberteil
  hochziehen/kippen/ausblenden. **Keine Cloth-/Fracture-Sim.**
- Export als **ein GLB** inkl. Animation. Geometrie mit **Draco** komprimieren, Texturen als **WebP**.
- 5 Packs = **1 Master-Mesh + Texturtausch**, nicht 5 separate Modelle.

**Im Browser (Three.js — noch zu bauen):**
- Aufreißen per **Knopfdruck** (nicht interaktives Ziehen).
- **Light-Beam = PNG** (fertige Dateien existieren: golden + weiß, Kegelform, transparent).
  Regeln: Plane **hinter** dem Pack (Ursprung verstecken), **Spitze im Riss**, **AdditiveBlending**
  + `depthWrite:false`, zur Kamera ausgerichtet (Billboard), **im Riss-Moment** Opacity+Skalierung hoch.
- **Partikel** im Browser (THREE.Points), kein Blender.
- **Sound** beim Aufreißen + Peak (trägt halben Effekt).
- **Reveal getrennt:** Server würfelt die Karten → DANN Animation → DANN Karten anzeigen. Karten NICHT
  in die Blender-Animation backen.
- **3 Beam-Stufen** (eigene Logik, nicht TCG-Pocket kopieren): normal (kaum Partikel) / selten
  (weißer Beam + Partikel) / Jackpot (goldener Beam + Flash + Sound). Welche Stufe → entscheidet der Server.

---

## 7. Ziel-Datenmodell `cards.db` (Richtschnur, im Detail in Phase 1 finalisieren)

- `hourglasses` — Bestand pro User (user_id, count, last_daily_claim …)
- `card_defs` — Karten-Definitionen (card_id, set_id, name, rarity, pack_exclusive_to, asset …)
- `sets` — Set-Definitionen (set_id, name, total_cards …)
- `packs` — Pack-Definitionen (pack_id, set_id, name, asset …)
- `user_cards` — Besitz (user_id, card_id, count)
- `set_progress` — Fortschritt pro User & Set
- `quest_defs` / `quest_progress` — set-übergreifende Quests: Vorlagen (`quest_defs`,
  z.B. „sammle 15 Tiere") getrennt vom per-User-Fortschritt (`quest_progress`)

WAL aktivieren: `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`

---

## 8. Roadmap (Phasen)

> Jede Phase: **Ziel → Liefergegenstand → Definition of Done → Tabu.** Reihenfolge einhalten.

### Phase 0 — Setup & Sicherheit
- **Ziel:** Neues Repo + Projektgerüst, ohne Logik.
- **Liefergegenstand:** Vite+Three.js-Frontend-Gerüst, FastAPI-Backend-Gerüst, `.gitignore`
  (mit `.env`, `*.db`), `README`, diese `ROADMAP.md` im Repo, Branch-Struktur.
- **Definition of Done:** `npm run dev` zeigt leere Three.js-Szene; FastAPI antwortet auf `/health`.
- **Tabu:** Noch keine DB-Schreibzugriffe, kein Bot-Code.

### Phase 1 — Datenmodell `cards.db`
- **Ziel:** Schema + Zugriffs-Layer (gemeinsam nutzbar von Bot & Web).
- **Liefergegenstand:** Migrations-/Init-Skript, WAL-Setup, Seed-Daten für 1 Test-Set mit 2 Packs.
- **Definition of Done:** `cards.db` wird erzeugt, Testdaten lesbar; alte DBs unberührt.
- **Tabu:** `database.db`/`farm_data.db` nicht verändern.

### Phase 2 — Migration auf den Pi (Daten-Umzug)
- **Ziel:** Umzugs-Anleitung + Skripte (alte DBs + Assets von Synology → Pi).
- **Liefergegenstand:** `rsync`/`scp`-Anleitung, Backup-Cronjob (Pi → Synology nachts).
- **Definition of Done:** Bot läuft auf dem Pi mit migrierten Daten; nächtliches Backup getestet.

### Phase 3 — Backend: Auth + Pack-Öffnen
- **Ziel:** Discord-OAuth-Login + **serverseitiges** Pack-Öffnen (Würfeln + Bestände verbuchen).
- **Liefergegenstand:** OAuth-Flow, `/api/open-pack`-Endpoint (zieht Sanduhr, würfelt Karten,
  schreibt `user_cards`, bestimmt Beam-Stufe), Cheat-sicher (Client kennt Wahrscheinlichkeiten nicht).
- **Definition of Done:** Eingeloggter User kann via API ein Pack öffnen, Ergebnis landet in `cards.db`.
- **Tabu:** Keine Wahrscheinlichkeiten/Logik im Frontend.

### Phase 4 — Frontend: 3D-Pack-Opening
- **Ziel:** Pack laden → drehen → aufratschen → Beam → Reveal.
- **Liefergegenstand:** GLB-Loader, Knopf-Trigger für Animation, Beam-PNG nach den Regeln aus §6,
  Partikel, Sound, Reveal der vom Server gelieferten Karten, 3 Beam-Stufen.
- **Definition of Done:** Vollständiger Öffnungs-Flow im Browser, flüssig auf dem Handy.

### Phase 5 — Sammlung (Website)
- **Ziel:** Set-Ansicht mit eigenen/fremden Sammlungen.
- **Liefergegenstand:** Set-Übersicht, besessene Karten sichtbar / fehlende als `?`, Karten-Anzahl je
  Set, fremde Sammlungen einsehbar, Duplikat→Währung-Tausch (ab 10), Set-/Quest-Belohnungen.
- **Definition of Done:** User sieht seine Sammlung, kann fremde anschauen, Tausch funktioniert.

### Phase 6 — Bot-Erweiterung (neuer Cog)
- **Ziel:** Sammlung im Discord-Channel + Sanduhr-Ausgabe.
- **Liefergegenstand:** Neuer Cog `cards_cog.py`: Sammlungs-Befehl mit Cycle-Buttons (eigene/fremde),
  Sanduhr-Vergabe (täglich + aus Lootbox/Quest), Anbindung an `cards.db`. Neue Channel-ID via `.env`.
- **Definition of Done:** Befehl zeigt Sammlung im Channel; alte Bot-Befehle unverändert funktionsfähig.
- **Tabu:** Bestehende Cogs nicht umschreiben; nur additive Integration.

### Phase 7 — Deployment & Betrieb
- **Ziel:** Alles live auf dem Pi.
- **Liefergegenstand:** Cloudflare Tunnel, Auto-Start (systemd/Docker), Deploy-Skript
  (`git pull` → build → restart), Backup-Cron verifiziert.
- **Definition of Done:** Discord-Link öffnet die Website über HTTPS; voller Flow funktioniert end-to-end.

---

## 9. Tech-Stack (Kurzreferenz)
- Bot: Python, discord.py, aiosqlite, Docker
- Web-Backend: Python, FastAPI, (a)sqlite, Discord OAuth
- Frontend: Three.js + Vite, GLB (Draco), WebP-Texturen
- Infra: Raspberry Pi 4 (SD→SSD), Synology (Backup), Cloudflare Tunnel
- Externe API: UnbelievaBoat (bestehend, für Währungs-Gutschriften)

## 10. Glossar
- **Sanduhr** — Platzhalter-Item zum Öffnen von Packs (eigenes Item folgt später).
- **Box / Gold-Box** — bestehendes Lootbox-Item des Bots (UnbelievaBoat-Währung), NICHT die Karten-Packs.
- **Pack** — Booster mit Karten, wird auf der Website in 3D geöffnet.
