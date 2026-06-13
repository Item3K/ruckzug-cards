# Set-Struktur & `set_config.json` (Phase 5a)

Sets, Packs und Karten werden **modular aus Ordnern** geladen (nicht im Code verdrahtet).
Geladen vom Frontend über [`frontend/src/setLoader.js`](frontend/src/setLoader.js).

## Ordnerstruktur

```
frontend/public/sets/
  index.json                 ← Registry: Liste der Set-Ordner
  set_ruckzug1/
    set_config.json          ← Metadaten, Packs, Karten, (Platzhalter-)Wahrscheinlichkeiten
    card_back.png            ← Rückseite dieses Sets (grüner RuckZUG-Rücken)
    packs/
      pack_<farbe>_rip.glb   ← Aufreiß-Animation (Opening)
      pack_<farbe>_idle.glb  ← Idle-Rotation (Landing-Page, Phase 6)
    cards/
      shared/                ← set-weite Karten-PNGs (aus jedem Pack ziehbar)
      pack_<farbe>/          ← pack-exklusive Karten-PNGs
```

Der generische **Karten-Rohling** liegt global unter
`frontend/public/models/cards/filet.glb` (1 Modell für alle Karten; pro Karte wird
später nur die Front-Textur getauscht).

## Set-Discovery (wie Sets gefunden werden)

Über die **Registry** `sets/index.json`:
```json
{ "sets": ["set_ruckzug1"] }
```
Ein echtes Verzeichnis-Auto-Scan ist im Browser über HTTP nicht möglich. Die Registry
ist der einfache, robuste Weg. **Neues Set hinzufügen:**
1. Ordner `frontend/public/sets/set_<name>/` mit `set_config.json` + Assets anlegen.
2. `"set_<name>"` in `sets/index.json` eintragen.
→ Danach lädt der Loader es **ohne Code-Änderung**.

## `set_config.json` — Format

```jsonc
{
  "set_id": "set_ruckzug1",
  "name": "RuckZUG Set 1",
  "card_back": "card_back.png",                 // relativ zum Set-Ordner
  "card_blank_model": "/models/cards/filet.glb",// absolut = globaler Rohling

  "rarities": ["common","rare","ultra_rare","rainbow_rare"],
  "finishes": ["normal","holo","reverse_holo","full_art","full_art_holo"],

  // Platzhalter — echte Logik in Phase 5b/10 (Wertkarten Small/Big-Roll, §7)
  "value_card_rolls": { "hue_tokens": { "small": {"chance":0.8,"min":5,"max":50}, ... } },

  "packs": [
    {
      "pack_id": "pack_green",
      "name": "Grün",
      "rip": "packs/pack_green_rip.glb",        // relativ zum Set-Ordner
      "idle": "packs/pack_green_idle.glb",
      "backend_pack_id": "pack_wald",           // provisorisch: Pack im Backend (cards.db)
      // Platzhalter — Slot-System (§7) kommt in Phase 5b
      "draw": { "cards_per_pack": 10, "slots": [ /* … */ ] }
    }
  ],

  "cards": [
    {
      "card_id": "rz1_shared_01",
      "name": "Testkarte Shared 1",
      "set_id": "set_ruckzug1",
      "rarity": "common",                       // aus "rarities"
      "finish": "normal",                       // aus "finishes"
      "pack_exclusive_to": null,                // null = aus allen Packs / sonst pack_id
      "asset": "cards/shared/filet_placeholder.png" // Front-PNG, relativ zum Set-Ordner
    }
  ]
}
```

**Pfad-Auflösung:** Pfade ohne führenden `/` sind **relativ zum Set-Ordner**
(`/sets/<set>/…`); Pfade mit `/` (z.B. der globale Rohling) bleiben absolut.

## Was der Loader liefert (`loadSet(setId)`)

Ein normalisiertes Objekt: `{ id, name, base, cardBackUrl, cardBlankModelUrl,
rarities, finishes, valueCardRolls, packs[], cards[], raw }` — alle Pfade bereits zu
ladbaren URLs aufgelöst (`ripUrl`, `idleUrl`, `assetUrl`, …). `loadSetIndex()` liefert
die Set-Namen, `loadAllSets()` alle Sets.

## Status Phase 5a (was schon greift)

- **Pack-GLBs** kommen aus der Set-Struktur (Opening lädt `*_rip.glb` aus dem Set-Ordner).
- **Karten-Katalog** wird aus `set_config.json` geladen und steht bereit.
- **Noch wie gehabt:** Der Reveal nutzt weiter den `filet.glb`-Rohling für alle 10 Karten
  (Platzhalter), und die gezogenen Karten kommen weiter vom Backend (kein Slot-Würfeln).
  Das Mapping „Server-Karte → Set-Karte" + per-Karte-Front-Textur und das Slot-System
  folgen in **Phase 5b**. `idle`-GLBs werden erst in **Phase 6** (Landing-Page) genutzt.
