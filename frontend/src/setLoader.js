// Modularer Set-Loader (Phase 5a).
// Lädt Sets/Packs/Karten aus frontend/public/sets/<set>/set_config.json.
//
// Set-Discovery: über die Registry-Datei sets/index.json (Liste der Set-Ordner).
// Ein echtes Auto-Scan eines Ordners ist im Browser über HTTP nicht möglich
// (man kann keine Verzeichnisse auflisten). index.json ist der einfache, robuste
// Weg: NEUES Set = Ordner + set_config.json anlegen UND den Ordnernamen in
// sets/index.json eintragen — danach wird es ohne Code-Änderung geladen.

const SETS_BASE = '/sets';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Löst einen (set-relativen) Asset-Pfad zu einer ladbaren URL auf. */
export function resolveSetAsset(setId, path) {
  if (!path) return null;
  return path.startsWith('/') ? path : `${SETS_BASE}/${setId}/${path}`;
}

/** Liste der registrierten Set-Ordnernamen. */
export async function loadSetIndex() {
  const idx = await fetchJson(`${SETS_BASE}/index.json`);
  return idx.sets || [];
}

/**
 * Lädt EIN Set anhand seines Ordnernamens. Löst alle Asset-Pfade relativ zum
 * Set-Ordner auf (absolute Pfade mit führendem "/" bleiben unverändert).
 */
export async function loadSet(setId) {
  const base = `${SETS_BASE}/${setId}/`;
  const cfg = await fetchJson(`${base}set_config.json`);
  const resolve = (p) => (p && p.startsWith('/') ? p : base + p);

  // Anzeige-Reihenfolge: Array-Reihenfolge, optionales "order" überschreibt sie.
  const packs = (cfg.packs || [])
    .map((p, i) => ({
      id: p.pack_id,
      label: p.name,
      order: typeof p.order === 'number' ? p.order : i,
      ripUrl: resolve(p.rip),
      idleUrl: resolve(p.idle),
      // Das Pack heißt im Backend wie seine pack_id (Seed schreibt sie aus dieser Config).
      backendPackId: p.backend_pack_id || p.pack_id,
      raw: p,
    }))
    .sort((a, b) => a.order - b.order);

  const cards = (cfg.cards || []).map((c) => ({
    id: c.card_id,
    name: c.name,
    setId: c.set_id,
    rarity: c.rarity,
    finish: c.finish,
    packExclusiveTo: c.pack_exclusive_to ?? null,
    assetUrl: resolve(c.asset),
    raw: c,
  }));

  return {
    id: cfg.set_id,
    name: cfg.name,
    base,
    cardBackUrl: resolve(cfg.card_back),
    cardBlankModelUrl: resolve(cfg.card_blank_model),
    rarities: cfg.rarities || [],
    finishes: cfg.finishes || [],
    valueCardRolls: cfg.value_card_rolls || null,
    packs,
    cards,
    raw: cfg,
  };
}

/** Lädt alle registrierten Sets. */
export async function loadAllSets() {
  const ids = await loadSetIndex();
  return Promise.all(ids.map(loadSet));
}
