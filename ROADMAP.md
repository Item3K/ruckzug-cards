# RuckZUG Cards — Projekt-Roadmap & Arbeitsanweisung für Claude Code

> **Diese Datei ist die Projekt-Bibel.** Claude Code liest sie zuerst und richtet sich
> in JEDEM Auftrag danach. Wenn ein Auftrag dieser Datei widerspricht, hat diese Datei
> Vorrang — im Zweifel nachfragen, nicht raten.
>
> Stand: Phasen 0–4c erledigt. Aktueller Fokus danach: modulare Set-Struktur + Website.

---

## 1. Vision (was wir bauen)

Ein **Sammelkarten-System** für den RuckZUG-Discord-Server. User sammeln im Discord
Währung und Items über den bestehenden Bot. Zusätzlich gibt es **Booster-Packs mit
Sammelkarten**, die man auf einer **Website** (gehostet auf einem Raspberry Pi) in 3D
öffnet — Pack drehen, auf Knopfdruck aufratschen, Lichtstrahl, Karten-Reveal im TCG-Pocket-Stil.
Das Kartensystem läuft **zusätzlich** zum bestehenden Lootbox-/Farm-System.

---

## 2. Kern-Architektur-Entscheidungen (final)

| Thema | Entscheidung |
|---|---|
| Hosting | **Alles auf dem Raspberry Pi**: Bot + Web-Backend + alle DBs + Assets |
| Alte Synology | **Backup-Ziel** (nächtliches rsync). Keine Live-Daten. |
| Speicher Pi | SD-Karte zum Start, SSD-Upgrade vor Live empfohlen. Backup ist Pflicht. |
| Web-Backend | **Python + FastAPI** (gleiche Sprache wie Bot → geteilter DB-Code) |
| Frontend | **Three.js + Vite**, GLB-Modelle |
| Datenbank (neu) | **`cards.db`** im WAL-Modus + busy_timeout (sicherer Parallel-Zugriff Bot↔Web) |
| Datenbanken (alt) | `database.db`, `farm_data.db` bleiben **inhaltlich unangetastet** |
| Verbindungsschlüssel | `user_id` (Discord-ID) verbindet alle DBs |
| Login Website | **Discord OAuth** (liefert verifiziert die user_id) |
| Erreichbarkeit | **Cloudflare Tunnel** (kein Port-Forwarding, keine Heim-IP, HTTPS) |
| Rendering-Last | 3D läuft im **Browser des Users** (WebGL), Pi liefert nur Dateien + API |

---

## 3. ⛔ LEITPLANKEN FÜR CLAUDE CODE — IMMER EINHALTEN

1. **Branches:** NUR Feature-Branches (`feature/...`). **Nie direkt auf `main` pushen.**
   `main`-Push nur nach ausdrücklicher Freigabe mit Begründung.
2. **`.env`:** Nie ungefragt lesen, nie committen/pushen. Wenn ein Secret/eine ID gebraucht
   wird → dem User sagen, welche Variable er in `.env` setzen soll.
3. **Datenbanken:** `*.db` werden **nie verändert/gepusht** (in `.gitignore`). NEUE Tabellen
   nur in `cards.db`. KEINE bestehenden Tabellen/Spalten in `database.db`/`farm_data.db`
   ändern oder löschen. Falls am Alten doch eine Spalte nötig: nur `ALTER TABLE ADD COLUMN`
   und nur nach Freigabe.
4. **Bestehendes nicht kaputtmachen:** Bot (`main.py`, aktive Cogs) muss weiter starten;
   alle alten Befehle unverändert funktionieren.
5. **Tabu-Dateien:** `cogs/easter_event.py.disabled` bleibt deaktiviert (nicht löschen,
   nicht reaktivieren). `cogs/app_api.py.disabled` wird ignoriert (nicht als Vorlage nutzen).
6. **Separates Repo:** Das Web-Projekt (`ruckzug-cards`) ist getrennt vom Bot-Repo. Der Bot
   bekommt später nur einen NEUEN Cog dazu, kein Umbau des Alten.
7. **Iterativ:** Eine Phase = ein abgeschlossener, testbarer Brocken. Nach jeder Phase
   anhalten und sagen, wie der User testet. Nicht mehrere Phasen auf einmal.
8. **Dev-Only sauber markieren:** Test-/Dev-Endpoints und das Tuning-Panel dürfen nie im
   Live-Build/für Endnutzer aktiv sein. Klar markieren.

---

## 4. Bestehendes System (Bot, Stand heute)

Discord-Bot (Python, discord.py), dockerisiert.
- **lootbox.py** — User sammeln durch Schreiben „Boxen", öffnen mit `!open`/`!open_golden`
  → UnbelievaBoat-Währung (via UnbelievaBoat-API, Methode `update_ub_balance`). `!craft`
  wandelt Boxen → Gold-Boxen.
- **farm_commands.py / farm_logic.py** — Farm-Minispiel (eigene DB). Erwähnt Items:
  **Beeren, Muscheln, Kiesel** → diese sollen als Wertkarten ziehbar sein (siehe §7).
- **fun_commands.py** — Kleinkram.

**Datenbanken:**
- `database.db` → `users` (user_id, msg_count, boxes, gold_boxes, opened_normal,
  opened_gold, last_claim) + `settings`.
- `farm_data.db` → Farm-Inventar (u.a. Beeren/Muscheln/Kiesel).

**`.env`** (Namen): DISCORD_TOKEN, ADMIN_CHANNEL, UB_TOKEN, GUILD_ID, TRACK_CHANNELS,
COMMAND_CHANNEL, FARM_CHANNEL. → Neu hinzukommen: Sammlungs-Channel-ID, OAuth-Secrets.

**Hue-Tokens** = die UnbelievaBoat-Währung. Soll ebenfalls als Wertkarte ziehbar sein.

---

## 5. Optik / 3D (Stand: erledigt in Phase 4)

**Blender (vom User geliefert):**
- Pro Pack ZWEI GLBs: eine **Rip-Animation** (Aufreißen, Folie zweigeteilt, Frame 0 =
  geschlossen) und eine **Idle-Animation** (Rotation für die Landing-Page).
- Jede GLB hat genau EINE Animation → im Code immer über `animations[0]` ansprechen.
- 5 Test-Packs: green, pink, purple, rainbow, red.

**Three.js (gebaut):**
- Kamera fest, **Objekte rotieren** (nicht Kamera kreisen). Fester Abstand, kein Zoom.
- Pack-Phase: nur horizontal drehbar (360°), mit Schwung/Momentum-Ausdrehen.
- Beim Öffnen: Erkennung **vorne/hinten** (welche Seite zur Kamera), Kamera springt auf
  eine von zwei festen Positionen (frontal vorne/hinten), lockt für die Sequenz.
- Beam = PNG-Lichtkegel, hinter dem Pack (Ursprung verdeckt), Spitze am Riss,
  AdditiveBlending, Billboard. 3 Stufen je `beam_stage` vom Server: normal/selten(weiß)/
  jackpot(gold).
- Reveal: 10 Karten als **Stapel** (minimaler Versatz, kein Auffächern). Vorne-Modus zeigt
  Vorderseite sofort; Hinten-Modus zeigt Rückseite, Flip beim Vorrücken. Wegwischen per
  Drag auf der Karte ODER Klick links/rechts ODER Pfeiltasten ODER Space/Enter. Stapel
  drehen per Drag daneben (±Winkel, Feder-Rückkehr). Chevron-Pfeile als Nudge.
- **Dev-Tuning-Panel** (lil-gui, nur Dev-Build) für alle Feel-Konstanten in `config.js`.

---

## 6. Karten-Assets & Set-Struktur (Richtschnur für kommende Phasen)

**Ein Karten-Rohling (GLB) + PNG-Texturen** — NICHT pro Karte ein eigenes Modell.
- 1 generisches Karten-Modell (flach, „Plane", existiert: `filet.glb` als Testkarte).
- Pro Karte 1 Vorderseiten-PNG (Motiv). 1 gemeinsame Rückseiten-PNG pro Set (grüner Rücken).
- Alle Karten-PNGs einheitliche Auflösung/Seitenverhältnis.

**Modulare Ordnerstruktur (neues Set = neuer Ordner):**
```
frontend/public/sets/
  set_<name>/
    set_config.json          ← Packs, Karten-Zuordnung, Wahrscheinlichkeiten, Token-Rolls
    card_back.png            ← Rückseite für dieses Set
    packs/
      pack_<farbe>_rip.glb   ← Aufreiß-Animation
      pack_<farbe>_idle.glb  ← Idle-Rotation (Landing-Page)
    cards/
      shared/                ← Karten, aus JEDEM Pack des Sets ziehbar (PNG-Motive)
      pack_<farbe>/          ← nur aus diesem Pack ziehbar (PNG-Motive)
```

**Finish-System (5 Typen):** normal, holo, reverse_holo, full_art, full_art_holo(=rainbow).
- Finish ist eine **Eigenschaft der Karte** (eigener Sammeleintrag, höhere Rarität).
- **Holo & Reverse** brauchen KEIN neues Motiv → derselbe PNG, Effekt per Shader im Browser.
- **Full Art / Rainbow** sind eigene Motive (echte Neuzeichnungen).
- Regel (Pokémon-nah): **Holo nur für rares+**, **Reverse Holo breit (auch commons)**.
- **Holo-Shader später**: winkelabhängiger Glitzer/Iridescenz. ZWEI Masken-Typen —
  Holo = Motiv glänzt, Reverse = Rahmen/Hintergrund glänzt (alles außer Motiv). Maske =
  simples S/W-Bild pro Karte; ohne Maske glänzt grob alles.

**Set 1 (vom Kollegen konzipiert):** ~64 Basiskarten, Finish-Erweiterung in Abstimmung.
Rarität-Stufen: common → rare → ultra rare → rainbow rare.

---

## 7. Würfel-Logik & Wertkarten

**Slot-basiertes Würfeln (Pokémon-Stil), 10 Karten pro Pack:**
- Slot 1–6: garantiert Normal Common.
- Slot 7–8: Common, kleine Rare-Chance. **Wertkarten** (Hue-Tokens, Beeren, Muscheln,
  Kiesel) als gelegentliche Überraschung hier einstreuen (sie zählen zu den Commons).
- Slot 9: meist Rare, kleine Finish-Chance.
- Slot 10 = **Hit-Slot** (Spannungs-Moment): Finish-Tabelle, z.B. Normal Rare 70 / Holo 15
  / Reverse 10 / Full Art 4 / Rainbow 1 (Startwerte, justierbar). Die **ultra-rare
  1000-Hue-Token-Wertkarte** steht hier mit 1 % Chance.
- Alle Wahrscheinlichkeiten **pro Pack** in `set_config.json` (Packs können unterschiedlich sein).
- **Würfeln immer serverseitig** (Cheat-Schutz). Aktuell zieht das Backend 10 Karten
  (`CARDS_PER_PACK=10`) — muss auf das Slot-System umgestellt werden.

**Wertkarten-Mechanik (Idee 2 — Small/Big-Roll):**
- Kommt eine Wertkarte, wird serverseitig zuerst der Roll-Typ gewürfelt (small/big, mit
  Wahrscheinlichkeit), dann eine Zahl aus dem zugehörigen Von-Bis-Bereich „geprägt“ und auf
  der Karte angezeigt. Ranges pro Pack/Wertkarten-Typ in `set_config.json`.
- **Einlösung per API-Patch ins bestehende Minispiel:** Beeren/Muscheln/Kiesel → Farm-System
  (farm_data.db über Bot-API); Hue-Tokens → UnbelievaBoat (`update_ub_balance`).
- Auch das **muss serverseitig** verbucht werden.

---

## 8. Website-Aufbau (kommende Phasen)

- **Landing / Set-Seite:** Alle Packs eines Sets mit laufender **Idle-Rotation** (idle-GLB).
  Sets untereinander. Pro Pack Anzeige „X/Y Pack-Exklusive gesammelt“. Klick auf Pack →
  Opening-Modus (langfristig per Doppelklick nach dem Drehen). Pack-Animationen modular aus
  dem Set-Ordner laden.
- **Opening-Modus:** der fertige 3D-Flow aus Phase 4.
- **Dex / Sammlung:** pro Set; eigene Karten sichtbar, fehlende grau mit `?`; pro Karte
  Anzeige des Pack-Ursprungs („aus allen“ oder konkretes Pack); Anzeige „wie viele Karten
  hat das Set“. Duplikate ab 10 → UnbelievaBoat-Währung tauschen. Set-Abschluss- und
  set-übergreifende Quest-Belohnungen.
- **Friends-Reiter:** andere OAuth-User auflisten, deren Sammlung ansehen.
- **Trading-Reiter:** Trading-Requests zwischen Nutzern stellen/annehmen (Details später).
- **Profil-Card-Display:** persönliche Vitrine, 1–10 selbst gewählte Karten.

---

## 9. Roadmap (Phasen)

### ✅ ERLEDIGT
- **Phase 0** — Setup & Sicherheit (Repo, Vite+Three.js-Gerüst, FastAPI-Gerüst, .gitignore).
- **Phase 1** — Datenmodell `cards.db` (8 Tabellen inkl. quest_defs/quest_progress, WAL, Seed).
- **Phase 3a** — Backend Pack-Öffnen ohne OAuth (serverseitiges Würfeln, Cheat-Schutz,
  Beam-Stufe, Dev-Endpoint für Sanduhren). *Hinweis: aktuell 10 Karten unabhängig — muss in
  Phase 5 auf Slot-System (§7) umgestellt werden.*
- **Phase 4a** — 3D-Pack: laden, drehen, auf Knopfdruck aufreißen, Pack-Wechsel.
- **Phase 4b** — Beam + Karten-Reveal (Stapel, vorne/hinten, wischen, Pfeile, Tastatur).
- **Phase 4c** — Dev-Tuning-Panel (lil-gui, nur Dev-Build).

### 🔜 GEPLANT (Reihenfolge noch flexibel)
- **Phase 5 — Modulare Set-Struktur.** Ordnerstruktur §6 umsetzen; `set_config.json`-Format
  definieren; Loader, der Sets/Packs/Karten aus Ordnern liest; Test-Set sauber migrieren
  (idle+rip GLBs, card_back, shared/pack-Karten). Backend-Würfeln auf Slot-System (§7)
  umstellen. Karten-Rohling + austauschbare Front-Textur (Platzhalter bis echte Motive da).
- **Phase 6 — Landing-Page.** Sets/Packs mit Idle-Rotation, „X/Y Exklusive“, Klick → Opening.
  Dazu ein **UI-Tuning-Panel** (analog zum 3D-Dev-Panel aus 4c, nur Dev-Build): Position,
  Größe, Abstände der UI-Felder live per Regler justierbar, mit Export der Werte. Gilt für
  Landing-Page und später für Dex/Friends/Profil-Ansichten.
- **Phase 7 — Dex / Sammlung.** Ansicht §8, besessene/fehlende Karten, Pack-Ursprung,
  Duplikat-Tausch, Set-/Quest-Belohnungen.
- **Phase 8 — Discord OAuth.** Ersetzt den user_id-Platzhalter aus Phase 3a; echte
  Anmeldung; Grundlage für Friends & persönliche Daten. **Außerdem hier:** Dev-/Tuning-Panels
  (3D-Panel aus 4c, UI-Panel aus Phase 6) von „nur Dev-Build" umstellen auf „im Live-Build
  vorhanden, aber nur für die Admin-user_id sichtbar". Gleicher Admin-Gate-Mechanismus wie
  das Admin-Interface (Phase 13).
- **Phase 9 — Friends + Profil-Card-Display.** User-Liste, fremde Sammlungen ansehen,
  persönliche Vitrine (1–10 Karten).
- **Phase 9b — Trading.** Trading-Requests zwischen Nutzern (Karten tauschen). Mechanik/
  Regeln bei Phasenbeginn festlegen. Menüpunkt existiert ab Phase 6 als Platzhalter.
- **Phase 10 — Wertkarten & Minispiel-Anbindung.** Small/Big-Roll serverseitig; API-Patch
  zu Farm (Beeren/Muscheln/Kiesel) und UnbelievaBoat (Hue-Tokens).
- **Phase 11 — Holo-Shader.** Winkelabhängiger Glitzer; zwei Masken-Typen (Holo/Reverse).
- **Phase 12 — Bot-Erweiterung (neuer Cog).** Sammlung im Discord-Channel (Cycle-Buttons,
  eigene/fremde), Sanduhr-Vergabe (täglich + aus Lootbox/Quest). Nur additiv, altes unberührt.
- **Phase 13 — Admin-Interface.** Oberfläche zum Verwalten von Sets/Packs/Karten/
  Wahrscheinlichkeiten/Card-Display (statt Hand-Editieren der Configs). Offen: schreibt es
  Configs oder DB — bei Phasenbeginn klären.
- **Phase 13b — Sound.** Soundeffekte für Pack-Opening (Ratsch/Aufreißen, Beam-Peak,
  Jackpot) und UI (Klicks, Hover, Reveal). Sauberes Audio-Handling: Preload, Lautstärke,
  Mute-Option, mobil-tauglich (Audio erst nach User-Interaktion starten). Sounds modular
  ablegen (Ressourcen-Ordner), damit austauschbar.
- **Phase 13c — Theming & Polish.** White/Dark-Mode-Umschalter (Farben über CSS-Variablen,
  Auswahl gespeichert). Gestaltete Hintergründe (allgemein und/oder pro Set). Allgemeiner
  visueller Feinschliff der UI-Flächen.
- **Phase 14 — Migration auf den Pi & Deployment.** Bot+DBs+Assets auf den Pi; Cloudflare
  Tunnel; Auto-Start; Deploy-Skript; nächtliches Backup auf die Synology.

---

## 10. Tech-Stack (Kurzreferenz)
- Bot: Python, discord.py, aiosqlite, Docker
- Web-Backend: Python, FastAPI, sqlite (WAL), Discord OAuth
- Frontend: Three.js + Vite, GLB, lil-gui (Dev)
- Infra: Raspberry Pi 4 (SD→SSD), Synology (Backup), Cloudflare Tunnel
- Externe API: UnbelievaBoat (Hue-Tokens), bot-interne API (Farm-Items)

## 11. Glossar
- **Sanduhr** — Item zum Öffnen von Packs (Platzhalter; eigenes Item folgt). Begrenzt pro Tag
  + aus Lootbox/Quest.
- **Box / Gold-Box** — bestehendes Lootbox-Item des Bots (UnbelievaBoat-Währung), NICHT die
  Karten-Packs.
- **Pack** — Booster mit Karten, wird auf der Website in 3D geöffnet.
- **Hue-Tokens** — UnbelievaBoat-Währung; auch als Wertkarte ziehbar.
- **Wertkarte** — Sonderkarte (Hue-Tokens/Beeren/Muscheln/Kiesel) mit serverseitig
  geprägtem Wert, einlösbar ins Minispiel.
- **Finish** — Karten-Variante: normal/holo/reverse_holo/full_art/full_art_holo.