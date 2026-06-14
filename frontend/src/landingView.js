// Landing-Page (Phase 6).
// - Rendert JEDES Set aus der Registry (sets/index.json) automatisch als eigenen
//   Container; darin die Packs als Kacheln NEBENEINANDER. Sets untereinander.
// - Pro Pack das idle-GLB rotierend (über den geteilten IdlePacks-Renderer).
// - Fortschritt pro Pack (pack-exklusive) und pro Set (gesamt).
// - Klick auf ein Pack -> Opening-Flow (onPackClick).
// - Hamburger-Menü oben rechts mit Platzhaltern Dex/Freunde/Trading.

import { loadAllSets } from './setLoader.js';
import { getCollection, getMe, startLogin, logout } from './api.js';
import { IdlePacks } from './idlePacks.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Landing {
  /** @param {{ onPackClick: (pack:{id,label,file,backendPackId})=>void }} opts */
  constructor({ onPackClick }) {
    this.onPackClick = onPackClick;
    this.idle = new IdlePacks();
    this.me = { logged_in: false };
    this.onAuthChange = null; // (me) => void, gesetzt von main (für die Opening-Gate)
    this.onOpenAdmin = null;  // () => void, gesetzt von main (Admin-Menüpunkt)
    this.sets = [];
    this._packEls = []; // { setId, pack, progressEl }
    this._setEls = [];  // { set, progressEl }
    this._rows = [];    // .pack-row Elemente (für die Verteilungs-/Überlauf-Berechnung)
    this._layoutRaf = null;

    this.root = el('div', 'landing');
    this.root.appendChild(this._buildTopbar());
    this.setsEl = el('main', 'sets');
    this.root.appendChild(this.setsEl);
    document.body.appendChild(this.root);

    this.placeholder = this._buildPlaceholder();
    document.body.appendChild(this.placeholder);
  }

  _buildTopbar() {
    const bar = el('header', 'topbar');
    bar.appendChild(el('div', 'brand', 'RuckZUG Cards'));

    const right = el('div', 'topbar-right');
    this._userLabel = el('span', 'user-label', ''); // Username, wenn eingeloggt
    right.appendChild(this._userLabel);

    const burger = el('button', 'hamburger', '≡');
    burger.setAttribute('aria-label', 'Menü');
    const menu = el('nav', 'menu');
    menu.hidden = true;

    // Auth-Eintrag (Anmelden/Abmelden) — Text/Aktion abhängig vom Login-Status.
    this._authBtn = el('button', 'auth-btn', 'Mit Discord anmelden');
    this._authBtn.addEventListener('click', () => {
      menu.hidden = true;
      if (this.me.logged_in) logout().then(() => this.refreshAuth()).then(() => this.refresh());
      else startLogin();
    });
    menu.appendChild(this._authBtn);
    menu.appendChild(el('hr', 'menu-sep'));

    for (const label of ['Dex', 'Freunde', 'Trading']) {
      const b = el('button', null, label);
      b.addEventListener('click', () => { menu.hidden = true; this._openPlaceholder(label); });
      menu.appendChild(b);
    }

    // Admin-Eintrag — nur sichtbar, wenn der eingeloggte User Admin ist
    // (refreshAuth schaltet ihn frei). Der Zugriff selbst ist serverseitig erzwungen.
    this._adminBtn = el('button', 'admin-link', 'Admin');
    this._adminBtn.hidden = true;
    this._adminBtn.addEventListener('click', () => {
      menu.hidden = true;
      if (this.onOpenAdmin) this.onOpenAdmin();
    });
    menu.appendChild(this._adminBtn);

    burger.addEventListener('click', () => { menu.hidden = !menu.hidden; });

    right.appendChild(burger);
    bar.appendChild(right);
    bar.appendChild(menu);
    return bar;
  }

  /** Login-Status holen und Topbar/Menü aktualisieren. */
  async refreshAuth() {
    try { this.me = await getMe(); } catch { this.me = { logged_in: false }; }
    if (this.me.logged_in) {
      this._userLabel.textContent = this.me.username || 'Angemeldet';
      this._authBtn.textContent = 'Abmelden';
    } else {
      this._userLabel.textContent = '';
      this._authBtn.textContent = 'Mit Discord anmelden';
    }
    this._adminBtn.hidden = !this.me.is_admin; // Admin-Menüpunkt nur für Admins
    if (this.onAuthChange) this.onAuthChange(this.me);
    return this.me;
  }

  _buildPlaceholder() {
    const ov = el('div', 'placeholder');
    ov.hidden = true;
    this._phTitle = el('h2', null, '');
    this._phText = el('p', null, '');
    this._phLogin = el('button', 'auth-btn', 'Mit Discord anmelden');
    this._phLogin.hidden = true;
    this._phLogin.addEventListener('click', () => startLogin());
    const back = el('button', 'back-btn', 'Zurück');
    back.addEventListener('click', () => { ov.hidden = true; });
    ov.appendChild(this._phTitle);
    ov.appendChild(this._phText);
    ov.appendChild(this._phLogin);
    ov.appendChild(back);
    return ov;
  }

  _openPlaceholder(title) {
    this._phTitle.textContent = title;
    this._phText.textContent = 'kommt bald.';
    this._phLogin.hidden = true;
    this.placeholder.hidden = false;
  }

  /** Login-Aufforderung (z.B. wenn nicht eingeloggt ein Pack geöffnet werden soll). */
  promptLogin() {
    this._phTitle.textContent = 'Anmelden erforderlich';
    this._phText.textContent = 'Zum Öffnen von Packs bitte mit Discord anmelden.';
    this._phLogin.hidden = false;
    this.placeholder.hidden = false;
  }

  /** Sets laden + DOM aufbauen + Idle-Packs anhängen. Einmalig. */
  async build() {
    this.sets = await loadAllSets();
    for (const set of this.sets) {
      const container = el('section', 'set-container');
      container.appendChild(el('h2', 'set-title', set.name));

      const row = el('div', 'pack-row');
      this._rows.push(row);
      for (const pack of set.packs) {
        const tile = el('button', 'pack-tile');
        tile.type = 'button';
        const stage = el('div', 'pack-stage');
        const footer = el('div', 'pack-footer');
        footer.appendChild(el('div', 'pack-name', pack.label));
        const prog = el('div', 'pack-progress', '–');
        footer.appendChild(prog);
        tile.appendChild(stage);
        tile.appendChild(footer);
        tile.addEventListener('click', () => this.onPackClick({
          id: pack.id, label: pack.label, file: pack.ripUrl, backendPackId: pack.backendPackId,
        }));
        row.appendChild(tile);

        this._packEls.push({ setId: set.id, pack, progressEl: prog });
        // Idle-GLB asynchron anhängen (rendert, sobald geladen).
        this.idle.add(stage, pack.idleUrl).catch((e) => console.warn('idle-GLB:', e));
      }
      container.appendChild(row);

      const setProg = el('div', 'set-progress', 'Set: –');
      container.appendChild(setProg);
      this._setEls.push({ set, progressEl: setProg });

      this.setsEl.appendChild(container);
    }

    // Gleichmäßige Verteilung/Überlauf laufend neu berechnen: bei Größenänderung
    // der Reihen/Kacheln (ResizeObserver), Fensterwechsel und Layout-Panel-Änderung.
    this._ro = new ResizeObserver(() => this._scheduleLayout());
    for (const row of this._rows) {
      this._ro.observe(row);
      for (const t of row.children) this._ro.observe(t);
    }
    window.addEventListener('resize', () => this._scheduleLayout());
    window.addEventListener('landing-relayout', () => this._scheduleLayout());
    this._scheduleLayout();

    await this.refreshAuth(); // Login-Status (bestimmt, ob Fortschritt vorhanden ist)
    await this.refresh();
  }

  _scheduleLayout() {
    if (this._layoutRaf) return;
    this._layoutRaf = requestAnimationFrame(() => {
      this._layoutRaf = null;
      for (const row of this._rows) this._updateRowLayout(row);
    });
  }

  /** Passt alles in die Reihe? Sonst linksbündig + scrollbar (.overflowing). */
  _updateRowLayout(row) {
    const tiles = [...row.children];
    if (!tiles.length) return;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    let need = (tiles.length - 1) * gap;
    for (const t of tiles) need += t.offsetWidth;
    row.classList.toggle('overflowing', need > row.clientWidth + 0.5);
  }

  /** Fortschritts-Zahlen (neu) holen — nach jedem Opening aufrufen. */
  async refresh() {
    for (const { set, progressEl } of this._setEls) {
      let owned = new Set();
      if (this.me.logged_in) {
        try {
          owned = new Set((await getCollection(set.id)).owned);
        } catch (e) {
          console.warn('collection:', e);
        }
      }
      // Pro Pack: pack-exklusive Karten.
      for (const pe of this._packEls.filter((p) => p.setId === set.id)) {
        const excl = set.cards.filter((c) => c.packExclusiveTo === pe.pack.id);
        const have = excl.filter((c) => owned.has(c.id)).length;
        pe.progressEl.textContent = `${have}/${excl.length}`;
      }
      // Set gesamt.
      const total = set.cards.length;
      const have = set.cards.filter((c) => owned.has(c.id)).length;
      progressEl.textContent = `Set: ${have}/${total} gesammelt`;
    }
  }

  setActive(b) {
    this.root.style.display = b ? 'block' : 'none';
    if (!b) this.placeholder.hidden = true;
    this.idle.setActive(b);
  }
}
