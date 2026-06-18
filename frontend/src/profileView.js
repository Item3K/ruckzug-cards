// Profil-View (Phase 9, Grundgerüst).
// Erreichbar per Klick auf den eigenen Avatar/Namen oben rechts. Zeigt aktuell
// Avatar + Name + "Geöffnete Packs: N".
//
// BEWUSST ERWEITERBAR: Der Body wird aus einer Liste von "Sektionen" aufgebaut
// (_buildSections). Spätere Blöcke (Top-10-Schaukasten, Wertkarten-Einlösung,
// Primal-Essence-Bracelet) einfach als weitere Sektion ergänzen — kein Umbau nötig.

import { getMe, getProfileStats } from './api.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Profile {
  /** @param {{ onClose: ()=>void }} opts */
  constructor({ onClose } = {}) {
    this.onClose = onClose || (() => {});

    this.root = el('div', 'profile-view');
    this.root.hidden = true;

    const bar = el('header', 'admin-bar');
    bar.appendChild(el('h2', 'admin-title', 'Profil'));
    const back = el('button', 'back-btn', 'Schließen');
    back.addEventListener('click', () => this.onClose());
    bar.appendChild(back);
    this.root.appendChild(bar);

    this.body = el('div', 'profile-body');
    this.root.appendChild(this.body);
    document.body.appendChild(this.root);
  }

  hide() { this.root.hidden = true; }

  async open() {
    this.root.hidden = false;
    this.body.innerHTML = '';
    this.body.appendChild(el('p', 'profile-msg', 'Lädt …'));

    let me;
    let stats;
    try {
      [me, stats] = await Promise.all([getMe(), getProfileStats()]);
    } catch {
      me = { logged_in: false };
      stats = {};
    }

    this.body.innerHTML = '';
    if (!me.logged_in) {
      const box = el('div', 'admin-denied');
      box.appendChild(el('h3', null, 'Nicht angemeldet'));
      box.appendChild(el('p', null, 'Bitte zuerst mit Discord anmelden.'));
      this.body.appendChild(box);
      return;
    }

    // Kopf: Avatar + Name.
    const head = el('div', 'profile-head');
    const av = el('img', 'profile-avatar');
    av.alt = '';
    if (me.avatar_url) av.src = me.avatar_url;
    head.appendChild(av);
    head.appendChild(el('div', 'profile-name', me.username || 'Discord-User'));
    this.body.appendChild(head);

    // Sektionen (erweiterbar).
    for (const section of this._buildSections(me, stats)) this.body.appendChild(section);
  }

  /** Liefert die Profil-Sektionen. Hier später weitere Blöcke ergänzen. */
  _buildSections(me, stats) {
    return [
      this._statSection('Geöffnete Packs', String(stats.packs_opened ?? 0)),
      this._statSection('Davon Einzel-Booster', String(stats.single_opened ?? 0)),
      // z.B. später:
      // this._showcaseSection(me),   // Top-10-Karten-Schaukasten
      // this._valueCardsSection(me), // Wertkarten einlösen
      // this._braceletSection(me),   // Primal Essence Bracelet
    ];
  }

  /** Einfache Statistik-Kachel (Label + großer Wert). */
  _statSection(label, value) {
    const sec = el('section', 'profile-section');
    sec.appendChild(el('div', 'profile-stat-label', label));
    sec.appendChild(el('div', 'profile-stat-value', value));
    return sec;
  }
}
