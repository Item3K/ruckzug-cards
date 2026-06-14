// Admin-Seite (Phase 13a, erweitert).
// Erreichbar unter /admin, NUR für Admins. Die Zugangskontrolle wird serverseitig
// erzwungen (require_admin -> 403); dieses Frontend ist nur die Bedienoberfläche.
//
// Funktionen:
// - Einstellung: Tuning-Panels (3D/Layout) ein/aus, persistent (localStorage).
// - User-Liste mit Avatar + Beständen, Sanduhren setzen/ändern.
// - Karten-Verwaltung pro gewähltem User: Liste aller Karten mit Vorschaubild,
//   Besitz-Anzahl, Mengenfeld + Geben/Nehmen direkt in der Zeile.

import {
  getMe, adminListUsers, adminUserCards,
  adminSetHourglasses, adminGiveCard, adminTakeCard,
} from './api.js';
import { loadAllSets } from './setLoader.js';

// localStorage-Schlüssel für den Tuning-Panel-Schalter (auch in main.js genutzt).
export const TUNING_LS_KEY = 'ruckzug.adminTuning';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Admin {
  /**
   * @param {{ onClose: ()=>void, onTuningToggle?: (enabled:boolean)=>void }} opts
   */
  constructor({ onClose, onTuningToggle } = {}) {
    this.onClose = onClose || (() => {});
    this.onTuningToggle = onTuningToggle || (() => {});
    this.sets = null;          // loadAllSets() (für Karten-Picker, beim ersten Öffnen)
    this.users = [];
    this.selectedUser = null;  // { user_id, username, avatar_url }
    this.ownedMap = {};        // card_id -> Besitz-Anzahl des gewählten Users
    this._cardRows = [];       // { cardId, haveEl }

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
    this.body.appendChild(this._buildSettings());
    this.body.appendChild(this._buildNote());

    const usersSection = el('section', 'admin-section');
    usersSection.appendChild(el('h3', 'admin-h3', 'User'));
    this.usersEl = el('div', 'admin-users');
    usersSection.appendChild(this.usersEl);
    this.body.appendChild(usersSection);

    // Karten-Verwaltung (gefüllt, sobald ein User gewählt ist).
    this.cardsSection = el('section', 'admin-section');
    this.body.appendChild(this.cardsSection);
    this._renderCardPanelEmpty();

    await this._loadUsers();
  }

  // --- Einstellungen: Tuning-Panel-Schalter --------------------------------
  _buildSettings() {
    const sec = el('section', 'admin-section');
    sec.appendChild(el('h3', 'admin-h3', 'Einstellungen'));
    const row = el('label', 'admin-toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = localStorage.getItem(TUNING_LS_KEY) === '1';
    cb.addEventListener('change', () => {
      localStorage.setItem(TUNING_LS_KEY, cb.checked ? '1' : '0');
      this.onTuningToggle(cb.checked);
    });
    row.append(cb, el('span', null, 'Tuning-Panels anzeigen (3D- & Layout-Regler)'));
    sec.appendChild(row);
    sec.appendChild(el('p', 'admin-hint-sm',
      'Standardmäßig aus — als Admin spielst du normal. Einschalten zum Justieren; '
      + 'die Einstellung bleibt im Browser gespeichert.'));
    return sec;
  }

  _buildNote() {
    const sec = el('section', 'admin-section admin-note');
    sec.appendChild(el('p', null,
      'Sanduhren: „Setzen" überschreibt absolut, „Addieren ±" rechnet den Betrag dazu '
      + '(negativ zum Abziehen). Karten: erst einen User „verwalten", dann pro Karte '
      + 'Anzahl + Geben/Nehmen (Nehmen geht nicht unter 0).'));
    return sec;
  }

  // --- User-Liste -----------------------------------------------------------
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
    const av = el('img', 'admin-avatar');
    av.alt = '';
    if (u.avatar_url) av.src = u.avatar_url;
    head.appendChild(av);
    const idbox = el('div', 'admin-user-idbox');
    idbox.appendChild(el('span', 'admin-user-name', u.username || '(ohne Namen)'));
    idbox.appendChild(el('span', 'admin-user-id', u.user_id));
    head.appendChild(idbox);
    card.appendChild(head);

    const meta = el('div', 'admin-user-meta');
    const hg = el('span', 'admin-pill', `⌛ ${u.hourglasses}`);
    meta.appendChild(hg);
    const cc = el('span', 'admin-pill', `🃏 ${u.card_count}`);
    meta.appendChild(cc);
    u._ccEl = cc; // Karten-Zähler-Pille (wird nach Geben/Nehmen aktualisiert)
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

    // Karten verwalten -> öffnet die Karten-Verwaltung für diesen User.
    const manage = el('button', 'admin-btn admin-btn-primary', 'Karten verwalten →');
    manage.addEventListener('click', () => this._selectUser(u));
    card.appendChild(manage);

    const fb = el('div', 'admin-feedback');
    card.appendChild(fb);
    card._fb = fb;
    return card;
  }

  // --- Karten-Verwaltung ----------------------------------------------------
  _renderCardPanelEmpty() {
    this.cardsSection.innerHTML = '';
    this.cardsSection.appendChild(el('h3', 'admin-h3', 'Karten-Verwaltung'));
    this.cardsSection.appendChild(el('p', 'admin-msg',
      'Oben bei einem User „Karten verwalten" wählen.'));
  }

  async _selectUser(u) {
    this.selectedUser = u;
    this.cardsSection.innerHTML = '';
    this.cardsSection.appendChild(el('h3', 'admin-h3', 'Karten-Verwaltung'));

    const head = el('div', 'admin-sel-head');
    const av = el('img', 'admin-avatar');
    av.alt = '';
    if (u.avatar_url) av.src = u.avatar_url;
    head.appendChild(av);
    head.appendChild(el('span', 'admin-user-name', u.username || u.user_id));
    this.cardsSection.appendChild(head);

    const filter = el('input', 'admin-input admin-filter');
    filter.type = 'search';
    filter.placeholder = 'Karte suchen (Name oder ID) …';
    filter.addEventListener('input', () => this._filterCards(filter.value));
    this.cardsSection.appendChild(filter);

    const listWrap = el('div', 'admin-cardlist');
    this.cardsSection.appendChild(listWrap);
    listWrap.appendChild(el('p', 'admin-msg', 'Lädt Besitz …'));

    // Besitz-Anzahlen des Users holen, dann die Kartenliste rendern.
    try {
      const data = await adminUserCards(u.user_id);
      this.ownedMap = data.cards || {};
    } catch (e) {
      this.ownedMap = {};
      listWrap.innerHTML = '';
      listWrap.appendChild(el('p', 'admin-msg admin-err', `Besitz konnte nicht geladen werden: ${e.message || e}`));
      return;
    }
    this._renderCardList(listWrap);
  }

  _renderCardList(listWrap) {
    listWrap.innerHTML = '';
    this._cardRows = [];
    for (const set of (this.sets || [])) {
      const group = el('div', 'admin-cardgroup');
      group.appendChild(el('div', 'admin-cardgroup-title', set.name));
      for (const c of set.cards) group.appendChild(this._buildCardRow(c));
      listWrap.appendChild(group);
    }
  }

  _buildCardRow(c) {
    const row = el('div', 'admin-card');
    row.dataset.search = `${c.name} ${c.id}`.toLowerCase();

    const img = el('img', 'admin-card-img');
    img.alt = '';
    img.loading = 'lazy';
    if (c.assetUrl) img.src = c.assetUrl;
    // Fallback bei fehlendem/kaputtem Motiv: Platzhalter-Klasse statt Broken-Image.
    img.addEventListener('error', () => { img.removeAttribute('src'); img.classList.add('is-missing'); });
    row.appendChild(img);

    const info = el('div', 'admin-card-info');
    info.appendChild(el('div', 'admin-card-name', c.name));
    const sub = [c.rarity, c.finish].filter(Boolean).join(' · ')
      + (c.packExclusiveTo ? ` · exkl. ${c.packExclusiveTo}` : '');
    info.appendChild(el('div', 'admin-card-sub', sub));
    row.appendChild(info);

    const have = el('div', 'admin-card-have', `hat ${this.ownedMap[c.id] || 0}×`);
    row.appendChild(have);
    this._cardRows.push({ cardId: c.id, haveEl: have });

    const qty = el('input', 'admin-input admin-input-sm');
    qty.type = 'number';
    qty.min = '1';
    qty.value = '1';
    qty.setAttribute('aria-label', 'Anzahl');
    row.appendChild(qty);

    const give = el('button', 'admin-btn', 'Geben');
    const take = el('button', 'admin-btn admin-btn-warn', 'Nehmen');
    const act = async (fn) => {
      const n = parseInt(qty.value, 10);
      if (Number.isNaN(n) || n < 1) { this._cardFlash(row, 'Anzahl ≥ 1.', true); return; }
      this._busyRow(row, true);
      try {
        const r = await fn(this.selectedUser.user_id, c.id, n);
        this.ownedMap[c.id] = r.count;
        have.textContent = `hat ${r.count}×`;
        this._updateUserCardCount();
        this._cardFlash(row, `→ ${r.count}×`);
      } catch (e) { this._cardFlash(row, e.message || String(e), true); }
      finally { this._busyRow(row, false); }
    };
    give.addEventListener('click', () => act(adminGiveCard));
    take.addEventListener('click', () => act(adminTakeCard));
    row.append(give, take);

    const fb = el('div', 'admin-card-fb');
    row.appendChild(fb);
    row._fb = fb;
    return row;
  }

  _filterCards(q) {
    const term = q.trim().toLowerCase();
    for (const group of this.cardsSection.querySelectorAll('.admin-cardgroup')) {
      let any = false;
      for (const row of group.querySelectorAll('.admin-card')) {
        const match = !term || row.dataset.search.includes(term);
        row.hidden = !match;
        if (match) any = true;
      }
      group.hidden = !any; // leere Set-Gruppe ausblenden
    }
  }

  /** Karten-Zähler-Pille des gewählten Users neu berechnen (distinkte Karten > 0). */
  _updateUserCardCount() {
    const u = this.selectedUser;
    if (!u || !u._ccEl) return;
    const distinct = Object.values(this.ownedMap).filter((n) => n > 0).length;
    u.card_count = distinct;
    u._ccEl.textContent = `🃏 ${distinct}`;
  }

  // --- Helfer ---------------------------------------------------------------
  _busy(card, b) {
    card.querySelectorAll('button, input').forEach((n) => { n.disabled = b; });
  }

  _busyRow(row, b) {
    row.querySelectorAll('button, input').forEach((n) => { n.disabled = b; });
  }

  _flash(card, msg, isErr = false) {
    if (!card._fb) return;
    card._fb.textContent = msg;
    card._fb.classList.toggle('admin-err', isErr);
    card._fb.classList.toggle('admin-ok', !isErr);
  }

  _cardFlash(row, msg, isErr = false) {
    if (!row._fb) return;
    row._fb.textContent = msg;
    row._fb.classList.toggle('admin-err', isErr);
    row._fb.classList.toggle('admin-ok', !isErr);
  }
}
