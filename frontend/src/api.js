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
/** Aktueller Login-Status: { logged_in, user_id, username }. */
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

// --- DEV-ONLY ---
/** DEV: ohne Discord als Test-User einloggen (lokales Testen). */
export async function devLogin(userId = 'test_user_1') {
  return jsonOrThrow(await fetch(`/api/dev/login?user_id=${encodeURIComponent(userId)}`, { method: 'POST' }));
}
/** DEV: Sanduhren gutschreiben. */
export async function devGiveHourglasses(userId, amount) {
  return jsonOrThrow(await fetch('/api/dev/give-hourglasses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, amount }),
  }));
}
