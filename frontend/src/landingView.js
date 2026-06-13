// Landing-Page (Phase 6).
// - Rendert JEDES Set aus der Registry (sets/index.json) automatisch als eigenen
//   Container; darin die Packs als Kacheln NEBENEINANDER. Sets untereinander.
// - Pro Pack das idle-GLB rotierend (über den geteilten IdlePacks-Renderer).
// - Fortschritt pro Pack (pack-exklusive) und pro Set (gesamt).
// - Klick auf ein Pack -> Opening-Flow (onPackClick).
// - Hamburger-Menü oben rechts mit Platzhaltern Dex/Freunde/Trading.

import { loadAllSets } from './setLoader.js';
import { getCollection } from './api.js';
import { IdlePacks } from './idlePacks.js';

const USER_ID = 'test_user_1'; // Platzhalter bis OAuth (Phase 8)

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
    const burger = el('button', 'hamburger', '≡');
    burger.setAttribute('aria-label', 'Menü');
    const menu = el('nav', 'menu');
    menu.hidden = true;
    const items = [
      ['dex', 'Dex'], ['friends', 'Freunde'], ['trading', 'Trading'],
    ];
    for (const [key, label] of items) {
      const b = el('button', null, label);
      b.addEventListener('click', () => { menu.hidden = true; this._openPlaceholder(label); });
      menu.appendChild(b);
    }
    burger.addEventListener('click', () => { menu.hidden = !menu.hidden; });
    bar.appendChild(burger);
    bar.appendChild(menu);
    return bar;
  }

  _buildPlaceholder() {
    const ov = el('div', 'placeholder');
    ov.hidden = true;
    this._phTitle = el('h2', null, '');
    const sub = el('p', null, 'kommt bald.');
    const back = el('button', 'back-btn', 'Zurück');
    back.addEventListener('click', () => { ov.hidden = true; });
    ov.appendChild(this._phTitle);
    ov.appendChild(sub);
    ov.appendChild(back);
    return ov;
  }

  _openPlaceholder(title) {
    this._phTitle.textContent = title;
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
      try {
        owned = new Set((await getCollection(USER_ID, set.id)).owned);
      } catch (e) {
        console.warn('collection:', e);
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
