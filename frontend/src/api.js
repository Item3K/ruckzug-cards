// Anbindung ans Backend. Im Dev proxyt Vite '/api' und '/auth' ans FastAPI
// (same-origin -> die Session-Cookies fließen automatisch). Der eingeloggte User
// kommt aus der Server-Session, daher KEINE user_id mehr vom Client.
//
// WICHTIG: Das Frontend würfelt NICHT selbst — nur Anzeige des Server-Ergebnisses
// (Cheat-Schutz, ROADMAP §6).

async function jsonOrThrow(res) {
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).detail; } catch { detail = res.statusText; }
    const err = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// --- Auth ---
/** Aktueller Login-Status: { logged_in, user_id, username, is_admin, avatar_url, hourglasses }. */
export async function getMe() {
  return jsonOrThrow(await fetch('/api/me'));
}
/** Startet den Discord-Login (volle Navigation zum Backend-Login-Endpoint). */
export function startLogin() {
  window.location.href = '/auth/login';
}
export async function logout() {
  return jsonOrThrow(await fetch('/auth/logout', { method: 'POST' }));
}

// --- Spiel ---
/** Öffnet ein Pack (user_id kommt aus der Session). */
export async function openPack(packId) {
  return jsonOrThrow(await fetch('/api/open-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pack_id: packId }),
  }));
}

/** Besessene card_ids des eingeloggten Users für ein Set. */
export async function getCollection(setId) {
  return jsonOrThrow(await fetch(`/api/collection?set_id=${encodeURIComponent(setId)}`));
}

// --- Admin (Phase 13a, nur für Admins — serverseitig erzwungen) ---
function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(jsonOrThrow);
}
/** Liste aller bekannten User mit Sanduhr-/Karten-Beständen + Avatar. */
export async function adminListUsers() {
  return jsonOrThrow(await fetch('/api/admin/users'));
}
/** Besitz-Anzahl je Karte für EINEN User: { cards: { card_id: count } }. */
export async function adminUserCards(userId) {
  return jsonOrThrow(await fetch(`/api/admin/user-cards?user_id=${encodeURIComponent(userId)}`));
}
/** Sanduhren setzen (mode 'set', absolut) oder ändern (mode 'add', +/-). */
export async function adminSetHourglasses(userId, mode, amount) {
  return postJson('/api/admin/hourglasses', { user_id: userId, mode, amount });
}
/** Einem User eine Karte (Anzahl) gutschreiben. */
export async function adminGiveCard(userId, cardId, count) {
  return postJson('/api/admin/cards/give', { user_id: userId, card_id: cardId, count });
}
/** Einem User eine Karte (Anzahl) abziehen (nicht unter 0). */
export async function adminTakeCard(userId, cardId, count) {
  return postJson('/api/admin/cards/take', { user_id: userId, card_id: cardId, count });
}
