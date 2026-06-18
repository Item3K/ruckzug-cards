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
  /** @param {{ onPackClick: (pack)=>void, onPackX10?: (pack)=>void }} opts */
  constructor({ onPackClick, onPackX10 }) {
    this.onPackClick = onPackClick;
    this.onPackX10 = onPackX10 || (() => {});
    this.idle = new IdlePacks();
    this.me = { logged_in: false };
    this.onAuthChange = null;   // (me) => void, gesetzt von main (für die Opening-Gate)
    this.onOpenAdmin = null;    // () => void, gesetzt von main (Admin-Menüpunkt)
    this.onOpenTrading = null;  // () => void, gesetzt von main (Trading-Menüpunkt)
    this.onOpenProfile = null;  // () => void, gesetzt von main (Klick auf Avatar/Name)
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
    // Sanduhr-Stand (nur eingeloggt sichtbar).
    this._hgLabel = el('span', 'hg-label', '');
    this._hgLabel.hidden = true;
    right.appendChild(this._hgLabel);
    // Avatar + Username als KLICKBARER Profil-Button (nur eingeloggt sichtbar).
    this._profileBtn = el('button', 'profile-btn');
    this._profileBtn.hidden = true;
    this._profileBtn.setAttribute('aria-label', 'Profil');
    this._avatarImg = el('img', 'avatar-img');
    this._avatarImg.alt = '';
    this._userLabel = el('span', 'user-label', ''); // Username, wenn eingeloggt
    this._profileBtn.append(this._avatarImg, this._userLabel);
    this._profileBtn.addEventListener('click', () => {
      if (this.me.logged_in && this.onOpenProfile) this.onOpenProfile();
    });
    right.appendChild(this._profileBtn);

    const burger = el('button', 'hamburger', '≡');
    burger.setAttribute('aria-label', 'Menü');
    // Roter Punkt am Hamburger, wenn ein Trade auf mich wartet (auch ohne geöffnetes Menü).
    this._burgerDot = el('span', 'burger-dot');
    this._burgerDot.hidden = true;
    burger.appendChild(this._burgerDot);
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
      const b = el('button', label === 'Trading' ? 'menu-trade' : null, label);
      if (label === 'Trading') {
        // Zähler eingehender Trades (ich bin am Zug).
        this._tradeBadge = el('span', 'menu-badge', '0');
        this._tradeBadge.hidden = true;
        b.appendChild(this._tradeBadge);
      }
      b.addEventListener('click', () => {
        menu.hidden = true;
        if (label === 'Trading') {
          if (this.me.logged_in) { if (this.onOpenTrading) this.onOpenTrading(); }
          else this.promptLogin();
        } else {
          this._openPlaceholder(label);
        }
      });
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
      if (this.me.avatar_url) this._avatarImg.src = this.me.avatar_url;
      this._avatarImg.hidden = !this.me.avatar_url;
      this._profileBtn.hidden = false; // Profil per Klick auf Avatar/Name
      this._hgLabel.textContent = `⌛ ${this.me.hourglasses ?? 0}`;
      this._hgLabel.hidden = false;
    } else {
      this._userLabel.textContent = '';
      this._authBtn.textContent = 'Mit Discord anmelden';
      this._profileBtn.hidden = true;
      this._hgLabel.hidden = true;
    }
    this._adminBtn.hidden = !this.me.is_admin; // Admin-Menüpunkt nur für Admins
    this._applyPackGate();                     // Packs bei 0 Sanduhren sperren
    if (!this.me.logged_in) this.setTradeBadge(0); // ausgeloggt -> kein Badge
    if (this.onAuthChange) this.onAuthChange(this.me);
    return this.me;
  }

  /** Badge am Trading-Menüpunkt + roter Punkt am Hamburger (Anzahl eingehender Trades). */
  setTradeBadge(n) {
    const show = n > 0;
    if (this._tradeBadge) { this._tradeBadge.textContent = String(n); this._tradeBadge.hidden = !show; }
    if (this._burgerDot) this._burgerDot.hidden = !show;
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
        const cell = el('div', 'pack-cell');
        const packInfo = {
          id: pack.id, label: pack.label, file: pack.ripUrl, backendPackId: pack.backendPackId,
        };

        const tile = el('button', 'pack-tile');
        tile.type = 'button';
        const stage = el('div', 'pack-stage');
        const footer = el('div', 'pack-footer');
        footer.appendChild(el('div', 'pack-name', pack.label));
        const prog = el('div', 'pack-progress', '–');
        footer.appendChild(prog);
        const lock = el('div', 'pack-lock', 'Keine Sanduhren');
        lock.hidden = true;
        footer.appendChild(lock);
        tile.appendChild(stage);
        tile.appendChild(footer);
        tile.addEventListener('click', () => {
          if (tile.classList.contains('locked')) return; // 0 Sanduhren -> nicht öffenbar
          this.onPackClick(packInfo);
        });
        cell.appendChild(tile);

        // x10-Button (öffnet 10 Packs, kostet 10 Sanduhren).
        const x10 = el('button', 'pack-x10-btn', '×10');
        x10.type = 'button';
        x10.title = '10 Packs auf einmal (10 Sanduhren)';
        x10.addEventListener('click', () => {
          if (x10.classList.contains('locked')) return; // < 10 Sanduhren
          this.onPackX10(packInfo);
        });
        cell.appendChild(x10);

        row.appendChild(cell);

        this._packEls.push({
          setId: set.id, pack, progressEl: prog, tileEl: tile, lockEl: lock, x10El: x10,
        });
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

  /** Packs sperren: Einzel ab 0 Sanduhren, x10 ab < 10 (jeweils nur eingeloggt). */
  _applyPackGate() {
    const hg = this.me.hourglasses ?? 0;
    const single = this.me.logged_in && hg <= 0;
    const x10 = this.me.logged_in && hg < 10;
    for (const pe of this._packEls) {
      pe.tileEl.classList.toggle('locked', single);
      pe.lockEl.hidden = !single;
      pe.x10El.classList.toggle('locked', x10);
      pe.x10El.title = x10 ? 'Mind. 10 Sanduhren nötig' : '10 Packs auf einmal (10 Sanduhren)';
    }
  }

  setActive(b) {
    this.root.style.display = b ? 'block' : 'none';
    if (!b) this.placeholder.hidden = true;
    this.idle.setActive(b);
  }
}
