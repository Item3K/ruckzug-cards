// Anbindung ans Backend (Phase 3a). Im Dev proxyt Vite '/api' an FastAPI
// (siehe vite.config.js), daher reicht der relative Pfad.
//
// WICHTIG: Das Frontend würfelt NICHT selbst — es zeigt nur, was der Server
// liefert (gezogene Karten + beam_stage). Cheat-Schutz laut ROADMAP §6.

/**
 * Öffnet ein Pack serverseitig.
 * @param {string} packId  Backend-pack_id (z.B. 'pack_wald')
 * @param {string} userId  Platzhalter bis OAuth (Phase 3b) — wie in 3a
 * @returns {Promise<{pack_id:string, drawn_cards:Array, beam_stage:string, hourglasses_remaining:number}>}
 */
export async function openPack(packId, userId) {
  const res = await fetch('/api/open-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack_id: packId, user_id: userId }),
  });
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).detail;
    } catch {
      detail = res.statusText;
    }
    const err = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Liefert die besessenen card_ids eines Users für ein Set (für Fortschritt).
 * @returns {Promise<{set_id:string, owned:string[]}>}
 */
export async function getCollection(userId, setId) {
  const url = `/api/collection?user_id=${encodeURIComponent(userId)}&set_id=${encodeURIComponent(setId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`collection HTTP ${res.status}`);
  return res.json();
}

/**
 * DEV-ONLY: Sanduhren gutschreiben (damit der Test-Flow nicht an leeren
 * Sanduhren scheitert). Spiegelt /api/dev/give-hourglasses aus 3a.
 * TODO: vor Live entfernen/absichern (gehört zum Dev-Endpoint).
 */
export async function devGiveHourglasses(userId, amount) {
  const res = await fetch('/api/dev/give-hourglasses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, amount }),
  });
  if (!res.ok) throw new Error(`give-hourglasses HTTP ${res.status}`);
  return res.json();
}
