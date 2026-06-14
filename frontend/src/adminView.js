// Admin-Seite (Phase 13a).
// Erreichbar unter /admin, NUR für Admins. Die Zugangskontrolle wird serverseitig
// erzwungen (require_admin -> 403); dieses Frontend ist nur die Bedienoberfläche.
// Funktionen: User-Liste mit Beständen, Sanduhren setzen/ändern, Karten geben/nehmen.

import {
  getMe, adminListUsers, adminSetHourglasses, adminGiveCard, adminTakeCard,
} from './api.js';
import { loadAllSets } from './setLoader.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Admin {
  /** @param {{ onClose: ()=>void }} opts */
  constructor({ onClose } = {}) {
    this.onClose = onClose || (() => {});
    this.sets = null;        // wird beim ersten Öffnen geladen (für den Karten-Picker)
    this.users = [];

    this.root = el('div', 'admin-view');
    this.root.hidden = true;

    const bar = el('header', 'admin-bar');
    bar.appendChild(el('h2', 'admin-title', 'Admin'));
    const back = el('button', 'back-btn', 'Schließen');
    back.addEventListener('click', () => this.onClose());
    bar.appendChild(back);
    this.root.appendChild(bar);

    this.body = el('div', 'admin-body');
    this.root.appendChild(this.body);

    document.body.appendChild(this.root);
  }

  /** Anzeigen + Daten laden. Prüft selbst nochmal is_admin (serverseitig). */
  async open() {
    this.root.hidden = false;
    this.body.innerHTML = '';
    this.body.appendChild(el('p', 'admin-msg', 'Lädt …'));

    let me;
    try { me = await getMe(); } catch { me = { is_admin: false }; }
    if (!me.is_admin) {
      this.body.innerHTML = '';
      const box = el('div', 'admin-denied');
      box.appendChild(el('h3', null, 'Kein Zugriff'));
      box.appendChild(el('p', null, 'Diese Seite ist nur für Administratoren.'));
      const home = el('button', 'auth-btn', 'Zur Startseite');
      home.addEventListener('click', () => this.onClose());
      box.appendChild(home);
      this.body.appendChild(box);
      return;
    }

    try {
      if (!this.sets) this.sets = await loadAllSets();
      await this._render();
    } catch (e) {
      this.body.innerHTML = '';
      this.body.appendChild(el('p', 'admin-msg admin-err', `Fehler: ${e.message || e}`));
    }
  }

  hide() { this.root.hidden = true; }

  async _render() {
    this.body.innerHTML = '';
    this.body.appendChild(this._buildCardPanel());

    const usersSection = el('section', 'admin-section');
    usersSection.appendChild(el('h3', 'admin-h3', 'User'));
    this.usersEl = el('div', 'admin-users');
    usersSection.appendChild(this.usersEl);
    this.body.appendChild(usersSection);

    await this._loadUsers();
  }

  async _loadUsers() {
    this.usersEl.innerHTML = '';
    this.usersEl.appendChild(el('p', 'admin-msg', 'Lädt …'));
    let data;
    try { data = await adminListUsers(); } catch (e) {
      this.usersEl.innerHTML = '';
      this.usersEl.appendChild(el('p', 'admin-msg admin-err', `Fehler: ${e.message || e}`));
      return;
    }
    this.users = data.users || [];
    this.usersEl.innerHTML = '';
    if (!this.users.length) {
      this.usersEl.appendChild(el('p', 'admin-msg', 'Noch keine User.'));
      return;
    }
    for (const u of this.users) this.usersEl.appendChild(this._buildUserCard(u));
  }

  _buildUserCard(u) {
    const card = el('div', 'admin-user');

    const head = el('div', 'admin-user-head');
    head.appendChild(el('span', 'admin-user-name', u.username || '(ohne Namen)'));
    head.appendChild(el('span', 'admin-user-id', u.user_id));
    card.appendChild(head);

    const meta = el('div', 'admin-user-meta');
    const hg = el('span', 'admin-pill', `⌛ ${u.hourglasses}`);
    meta.appendChild(hg);
    meta.appendChild(el('span', 'admin-pill', `🃏 ${u.card_count}`));
    card.appendChild(meta);

    // Sanduhren: Betrag + Setzen (absolut) / Addieren (+/-).
    const hgRow = el('div', 'admin-row');
    const amount = el('input', 'admin-input');
    amount.type = 'number';
    amount.value = String(u.hourglasses);
    amount.setAttribute('aria-label', 'Sanduhren-Betrag');
    const setBtn = el('button', 'admin-btn', 'Setzen');
    const addBtn = el('button', 'admin-btn', 'Addieren ±');
    const apply = async (mode) => {
      const val = parseInt(amount.value, 10);
      if (Number.isNaN(val)) { this._flash(card, 'Bitte eine Zahl eingeben.', true); return; }
      this._busy(card, true);
      try {
        const r = await adminSetHourglasses(u.user_id, mode, val);
        u.hourglasses = r.hourglasses;
        hg.textContent = `⌛ ${r.hourglasses}`;
        if (mode === 'set') amount.value = String(r.hourglasses);
        this._flash(card, `Sanduhren: ${r.hourglasses}`);
      } catch (e) { this._flash(card, e.message || String(e), true); }
      finally { this._busy(card, false); }
    };
    setBtn.addEventListener('click', () => apply('set'));
    addBtn.addEventListener('click', () => apply('add'));
    hgRow.append(el('span', 'admin-label', 'Sanduhren'), amount, setBtn, addBtn);
    card.appendChild(hgRow);

    // Karten geben/nehmen für diesen User.
    const cardRow = el('div', 'admin-row');
    const pick = this._cardSelect();
    const count = el('input', 'admin-input admin-input-sm');
    count.type = 'number';
    count.min = '1';
    count.value = '1';
    count.setAttribute('aria-label', 'Karten-Anzahl');
    const giveBtn = el('button', 'admin-btn', 'Geben');
    const takeBtn = el('button', 'admin-btn admin-btn-warn', 'Nehmen');
    const cardAction = async (fn, verb) => {
      const cardId = pick.value;
      const n = parseInt(count.value, 10);
      if (!cardId) { this._flash(card, 'Bitte eine Karte wählen.', true); return; }
      if (Number.isNaN(n) || n < 1) { this._flash(card, 'Anzahl ≥ 1.', true); return; }
      this._busy(card, true);
      try {
        const r = await fn(u.user_id, cardId, n);
        this._flash(card, `${verb}: ${cardId} → Bestand ${r.count}`);
      } catch (e) { this._flash(card, e.message || String(e), true); }
      finally { this._busy(card, false); }
    };
    giveBtn.addEventListener('click', () => cardAction(adminGiveCard, 'Gegeben'));
    takeBtn.addEventListener('click', () => cardAction(adminTakeCard, 'Genommen'));
    cardRow.append(el('span', 'admin-label', 'Karten'), pick, count, giveBtn, takeBtn);
    card.appendChild(cardRow);

    const fb = el('div', 'admin-feedback');
    card.appendChild(fb);
    card._fb = fb;
    return card;
  }

  /** Info-Panel oben: erklärt die Karten-IDs (Picker steckt pro User-Karte). */
  _buildCardPanel() {
    const sec = el('section', 'admin-section admin-note');
    sec.appendChild(el('p', null,
      'Sanduhren: „Setzen" überschreibt den Wert absolut, „Addieren ±" rechnet den '
      + 'Betrag dazu (negativ zum Abziehen). Karten: Karte wählen, Anzahl, Geben/Nehmen '
      + '(Nehmen geht nicht unter 0).'));
    return sec;
  }

  /** <select> aller Karten, gruppiert nach Set. */
  _cardSelect() {
    const sel = el('select', 'admin-select');
    sel.appendChild(el('option', null, '– Karte wählen –')).value = '';
    for (const set of (this.sets || [])) {
      const group = document.createElement('optgroup');
      group.label = set.name;
      for (const c of set.cards) {
        const o = el('option', null, `${c.name} (${c.id})`);
        o.value = c.id;
        group.appendChild(o);
      }
      sel.appendChild(group);
    }
    return sel;
  }

  _busy(card, b) {
    card.querySelectorAll('button, input, select').forEach((n) => { n.disabled = b; });
  }

  _flash(card, msg, isErr = false) {
    if (!card._fb) return;
    card._fb.textContent = msg;
    card._fb.classList.toggle('admin-err', isErr);
    card._fb.classList.toggle('admin-ok', !isErr);
  }
}
