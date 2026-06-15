// Trading-Tab (Phase 9b) — 1:1-Kartentausch auf der Website.
// Übersicht (eingehend = ich am Zug / ausgehend = warten / abgeschlossen),
// neuen Trade vorschlagen, sowie Annehmen / Ablehnen / Gegenvorschlag.
// Die Tausch-Logik + Validierung liegt serverseitig (trade_logic.py); hier nur UI.

import {
  getMe, startLogin, listUsers, getUserCollection,
  listTrades, createTrade, counterTrade, acceptTrade, rejectTrade, cancelTrade,
} from './api.js';
import { loadAllSets } from './setLoader.js';

const STATUS_LABEL = {
  open: 'offen', accepted: 'angenommen', rejected: 'abgelehnt', cancelled: 'abgebrochen',
};

// Auto-Aktualisierung der Trade-Liste, solange der Tab offen + sichtbar ist.
const POLL_INTERVAL_MS = 4000;
// Max. Karten pro Seite (muss zur Backend-Regel in trade_logic.py passen).
const MAX_PER_SIDE = 5;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Trading {
  /**
   * @param {{ onClose: ()=>void, onIncomingCount?: (n:number)=>void,
   *           onNotificationClick?: ()=>void }} opts
   */
  constructor({ onClose, onIncomingCount, onNotificationClick } = {}) {
    this.onClose = onClose || (() => {});
    this._onIncoming = onIncomingCount || null;
    this._onNotifClick = onNotificationClick || null;
    this.sets = null;
    this.cardMap = {};      // card_id -> { id, name, rarity, finish, assetUrl }
    this.me = null;
    this.users = [];
    this.myCollection = {}; // card_id -> count

    // Polling-State
    this._pollTimer = null;
    this._visHandler = null;
    this._lastSig = null;   // Signatur der zuletzt gerenderten Trade-Liste
    this._newPanel = null;  // Referenz aufs „Neuer Trade"-Panel (Busy-Erkennung)

    // Notification-State
    this._known = null;     // Map(trade_id -> { status, incoming }) für Event-Dedup
    this._notifyAsked = false;

    this.root = el('div', 'trading-view');
    this.root.hidden = true;

    const bar = el('header', 'admin-bar');
    bar.appendChild(el('h2', 'admin-title', 'Trading'));
    const back = el('button', 'back-btn', 'Schließen');
    back.addEventListener('click', () => this.onClose());
    bar.appendChild(back);
    this.root.appendChild(bar);

    this.body = el('div', 'trading-body');
    this.root.appendChild(this.body);
    document.body.appendChild(this.root);
  }

  hide() {
    this._stopPolling();
    this.root.hidden = true;
  }

  async open() {
    this.root.hidden = false;
    this.body.innerHTML = '';
    this.body.appendChild(el('p', 'trade-msg', 'Lädt …'));

    let me;
    try { me = await getMe(); } catch { me = { logged_in: false }; }
    if (!me.logged_in) {
      this.body.innerHTML = '';
      const box = el('div', 'admin-denied');
      box.appendChild(el('h3', null, 'Anmelden erforderlich'));
      box.appendChild(el('p', null, 'Zum Handeln bitte mit Discord anmelden.'));
      const b = el('button', 'auth-btn', 'Mit Discord anmelden');
      b.addEventListener('click', () => startLogin());
      box.appendChild(b);
      this.body.appendChild(box);
      return;
    }
    this.me = me;

    try {
      if (!this.sets) {
        this.sets = await loadAllSets();
        for (const set of this.sets) {
          for (const c of set.cards) {
            this.cardMap[c.id] = { id: c.id, name: c.name, rarity: c.rarity, finish: c.finish, assetUrl: c.assetUrl };
          }
        }
      }
      const [u, mine] = await Promise.all([listUsers(), getUserCollection(me.user_id)]);
      this.users = u.users || [];
      this.myCollection = mine.cards || {};
      await this._hardRefresh();
      this._startPolling();
      this._maybeRequestPermission(); // höflich beim ersten Öffnen (User-Geste), einmalig
    } catch (e) {
      this.body.innerHTML = '';
      this.body.appendChild(el('p', 'trade-msg trade-err', `Fehler: ${e.message || e}`));
    }
  }

  /** Holt Trades (+ eigene Sammlung) und rendert hart neu. Für Start/Button/Aktionen. */
  async _hardRefresh() {
    let data;
    try { data = await listTrades(); } catch (e) {
      this.body.innerHTML = '';
      this.body.appendChild(el('p', 'trade-msg trade-err', `Fehler: ${e.message || e}`));
      return;
    }
    try {
      const mine = await getUserCollection(this.me.user_id);
      this.myCollection = mine.cards || {};
    } catch { /* eigene Sammlung optional */ }
    this._render(data);
    this._lastSig = this._signature(data);
    if (this._onIncoming) this._onIncoming(data.incoming.length);
    this._recordKnown(data); // Baseline still setzen (eigene Aktionen lösen keine Notification aus)
  }

  /** Baut die Ansicht aus bereits geladenen Daten auf (kein Netz-Zugriff). */
  _render(data) {
    this.body.innerHTML = '';

    const top = el('div', 'trade-top');
    const newBtn = el('button', 'trade-btn trade-btn-primary', '+ Neuer Trade');
    const reload = el('button', 'trade-btn', 'Aktualisieren');
    reload.addEventListener('click', () => this._hardRefresh());
    top.append(newBtn, reload);
    this.body.appendChild(top);

    const newPanel = this._buildNewTrade();
    this._newPanel = newPanel;
    this.body.appendChild(newPanel);
    newBtn.addEventListener('click', () => { newPanel.hidden = !newPanel.hidden; });

    this.body.appendChild(this._section('Du bist am Zug', data.incoming, 'incoming'));
    this.body.appendChild(this._section('Warten auf Antwort', data.outgoing, 'outgoing'));
    this.body.appendChild(this._section('Abgeschlossen', data.closed, 'closed'));
  }

  // --- Auto-Polling ---------------------------------------------------------
  /**
   * Pollt die Trade-Liste. Re-Rendert NUR, wenn der Tab sichtbar ist, der Nutzer
   * gerade nichts bearbeitet (Busy-Guard) UND sich wirklich etwas geändert hat
   * (Signatur-Vergleich) — so werden offene Eingaben nie zerstört und es gibt
   * keine unnötigen „Sprünge". Den Badge-Zähler aktualisieren wir aber immer.
   */
  async _poll() {
    if (this.root.hidden) return;
    let data;
    try { data = await listTrades(); } catch { return; } // transiente Fehler ignorieren
    if (this._onIncoming) this._onIncoming(data.incoming.length);
    // Notifications IMMER prüfen (auch bei Busy/keinem Re-Render): erst erkennen,
    // dann bekannte Zustände fortschreiben -> jedes Ereignis löst genau einmal aus.
    this._detectAndNotify(data);
    this._recordKnown(data);
    if (this._isBusy()) return;
    if (this._signature(data) === this._lastSig) return;
    try {
      const mine = await getUserCollection(this.me.user_id);
      this.myCollection = mine.cards || {};
    } catch { /* optional */ }
    this._render(data);
    this._lastSig = this._signature(data);
  }

  _signature(data) {
    const rows = [...data.incoming, ...data.outgoing, ...data.closed].map(
      (t) => `${t.id}:${t.status}:${t.turn_user}:${(t.from_cards || []).join(',')}:${(t.to_cards || []).join(',')}:${t.updated_at}`,
    );
    return rows.sort().join('|');
  }

  /** Bearbeitet der Nutzer gerade etwas? Dann NICHT automatisch neu rendern. */
  _isBusy() {
    if (this._newPanel && !this._newPanel.hidden) return true;   // „Neuer Trade" offen
    if (this.root.querySelector('.trade-counter')) return true;  // Gegenvorschlag-Editor offen
    const a = document.activeElement;                            // ein Feld ist fokussiert
    if (a && this.root.contains(a) && ['SELECT', 'INPUT', 'TEXTAREA'].includes(a.tagName)) return true;
    return false;
  }

  _startPolling() {
    this._stopPolling();
    // Läuft weiter, auch wenn der Browser-Tab im Hintergrund ist — sonst kämen die
    // Notifications nie an, wenn man woanders ist. Gestoppt wird erst beim Verlassen
    // der Trading-Ansicht (hide()). Bei Rückkehr in den Vordergrund sofort aktualisieren.
    this._visHandler = () => { if (!document.hidden) this._poll(); };
    document.addEventListener('visibilitychange', this._visHandler);
    this._ensureTimer();
  }

  _ensureTimer() {
    if (this._pollTimer || this.root.hidden) return;
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  _clearTimer() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _stopPolling() {
    this._clearTimer();
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
  }

  // --- Browser-Notifications ------------------------------------------------
  /** Einmalig (und nur im 'default'-Zustand) höflich nach Erlaubnis fragen. */
  _maybeRequestPermission() {
    if (!('Notification' in window) || this._notifyAsked) return;
    if (Notification.permission === 'default') {
      this._notifyAsked = true;
      try { Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
    }
  }

  /** Bekannte Zustände aller Trades festhalten (Basis fürs Einmal-Auslösen). */
  _recordKnown(data) {
    const m = new Map();
    for (const t of data.incoming) m.set(t.id, { status: t.status, incoming: true });
    for (const t of data.outgoing) m.set(t.id, { status: t.status, incoming: false });
    for (const t of data.closed) m.set(t.id, { status: t.status, incoming: false });
    this._known = m;
  }

  /**
   * Vergleicht den neuen Stand mit den zuletzt bekannten Zuständen und löst je
   * Ereignis GENAU EINMAL eine Notification aus: neue eingehende Anfrage (bzw.
   * Gegenvorschlag, der den Zug zu mir dreht) sowie Statuswechsel offen->accepted/
   * rejected bei einem meiner Trades. Eigene Aktionen aktualisieren die Baseline
   * über _hardRefresh und lösen daher nichts aus.
   */
  _detectAndNotify(data) {
    if (this._known === null) return; // erster Durchlauf: nur Baseline, kein Spam
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    for (const t of data.incoming) {
      const prev = this._known.get(t.id);
      if (!prev || !prev.incoming) {
        this._notify('Neue Trade-Anfrage', `${this._otherName(t)} ist am Zug — du bist dran`, `trade-${t.id}-in`);
      }
    }
    for (const t of data.closed) {
      const prev = this._known.get(t.id);
      if (prev && prev.status === 'open') {
        if (t.status === 'accepted') {
          this._notify('Trade angenommen', `${this._otherName(t)} hat deinen Trade angenommen`, `trade-${t.id}-acc`);
        } else if (t.status === 'rejected') {
          this._notify('Trade abgelehnt', `${this._otherName(t)} hat deinen Trade abgelehnt`, `trade-${t.id}-rej`);
        }
      }
    }
  }

  _otherName(t) {
    const me = this.me.user_id;
    return t.from_user === me ? (t.to_username || t.to_user) : (t.from_username || t.from_user);
  }

  _notify(title, body, tag) {
    try {
      const n = new Notification(title, { body, tag });
      n.onclick = () => {
        window.focus();
        if (this._onNotifClick) this._onNotifClick();
        n.close();
      };
    } catch { /* ignore */ }
  }

  _section(title, trades, kind) {
    const sec = el('section', 'trade-section');
    sec.appendChild(el('h3', 'trade-h3', `${title} (${trades.length})`));
    if (!trades.length) sec.appendChild(el('p', 'trade-msg', '—'));
    else for (const t of trades) sec.appendChild(this._tradeCard(t, kind));
    return sec;
  }

  // --- Neuer Trade ----------------------------------------------------------
  _buildNewTrade() {
    const panel = el('div', 'trade-new');
    panel.hidden = true;

    const pSel = el('select', 'trade-select');
    const opt0 = el('option', null, '– Partner wählen –'); opt0.value = '';
    pSel.appendChild(opt0);
    for (const u of this.users) {
      const o = el('option', null, u.username || u.user_id);
      o.value = u.user_id;
      pSel.appendChild(o);
    }
    const partnerRow = el('div', 'trade-row');
    partnerRow.append(el('div', 'trade-picker-label', 'Partner'), pSel);

    const editorWrap = el('div', 'trade-editor-wrap');
    editorWrap.appendChild(el('p', 'trade-msg', 'Erst einen Partner wählen.'));
    let editor = null;

    pSel.addEventListener('change', async () => {
      editor = null;
      editorWrap.innerHTML = '';
      if (!pSel.value) { editorWrap.appendChild(el('p', 'trade-msg', 'Erst einen Partner wählen.')); return; }
      editorWrap.appendChild(el('p', 'trade-msg', 'Lädt Sammlung …'));
      try {
        const coll = await getUserCollection(pSel.value);
        const name = pSel.options[pSel.selectedIndex].text;
        editorWrap.innerHTML = '';
        editor = this._buildEditor({
          fromColl: this.myCollection, toColl: coll.cards || {},
          fromName: 'Du', toName: name,
        });
        editorWrap.appendChild(editor.el);
      } catch (e) {
        editorWrap.innerHTML = '';
        editorWrap.appendChild(el('p', 'trade-msg trade-err', `Sammlung konnte nicht geladen werden: ${e.message || e}`));
      }
    });

    const send = el('button', 'trade-btn trade-btn-primary', 'Vorschlag senden');
    const fb = el('div', 'trade-fb');
    send.addEventListener('click', async () => {
      if (!pSel.value) { this._flash(fb, 'Bitte einen Partner wählen.', true); return; }
      if (!editor) { this._flash(fb, 'Bitte Karten wählen.', true); return; }
      const from = editor.getFrom(); const to = editor.getTo();
      if (!from.length || !to.length) { this._flash(fb, 'Beide Seiten brauchen mindestens 1 Karte.', true); return; }
      send.disabled = true;
      try {
        await createTrade(pSel.value, from, to);
        await this._hardRefresh();
      } catch (e) { this._flash(fb, e.message || String(e), true); send.disabled = false; }
    });

    panel.append(partnerRow, editorWrap, send, fb);
    return panel;
  }

  // --- Eine Trade-Karte -----------------------------------------------------
  _tradeCard(t, kind) {
    const card = el('div', 'trade-card');
    const meId = this.me.user_id;
    const iAmFrom = t.from_user === meId;
    const partnerName = iAmFrom ? (t.to_username || t.to_user) : (t.from_username || t.from_user);
    const partnerAvatar = iAmFrom ? t.to_avatar_url : t.from_avatar_url;

    const head = el('div', 'trade-card-head');
    const av = el('img', 'trade-avatar'); av.alt = '';
    if (partnerAvatar) av.src = partnerAvatar;
    head.append(av, el('span', 'trade-partner', `mit ${partnerName}`));
    head.appendChild(el('span', `trade-status status-${t.status}`, STATUS_LABEL[t.status] || t.status));
    card.appendChild(head);

    // Tausch-Listen: A (from) gibt seine Karten  ⇄  B (to) gibt seine Karten.
    const pair = el('div', 'trade-pair');
    pair.appendChild(this._sideBlock(t.from_username || t.from_user, t.from_cards || [], t.from_user === meId));
    pair.appendChild(el('div', 'trade-swap', '⇄'));
    pair.appendChild(this._sideBlock(t.to_username || t.to_user, t.to_cards || [], t.to_user === meId));
    card.appendChild(pair);

    const fb = el('div', 'trade-fb');
    const actions = el('div', 'trade-actions');
    const run = async (fn) => {
      actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try { await fn(); await this._hardRefresh(); }
      catch (e) {
        this._flash(fb, e.message || String(e), true);
        actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    };

    if (kind === 'incoming') {
      const accept = el('button', 'trade-btn trade-btn-primary', 'Annehmen');
      const reject = el('button', 'trade-btn trade-btn-warn', 'Ablehnen');
      const counter = el('button', 'trade-btn', 'Gegenvorschlag');
      accept.addEventListener('click', () => run(() => acceptTrade(t.id)));
      reject.addEventListener('click', () => run(() => rejectTrade(t.id)));
      counter.addEventListener('click', () => this._openCounter(card, t, fb, run, counter));
      actions.append(accept, reject, counter);
    } else if (kind === 'outgoing') {
      actions.appendChild(el('span', 'trade-wait', `wartet auf ${partnerName} …`));
      const cancel = el('button', 'trade-btn trade-btn-warn', 'Abbrechen');
      cancel.addEventListener('click', () => run(() => cancelTrade(t.id)));
      actions.appendChild(cancel);
    }

    card.appendChild(actions);
    card.appendChild(fb);
    return card;
  }

  _sideBlock(name, cardIds, isMe) {
    const block = el('div', 'trade-side');
    block.appendChild(el('div', 'trade-side-name', isMe ? `${name} (du)` : name));
    const list = el('div', 'trade-side-cards');
    if (!cardIds.length) list.appendChild(el('div', 'trade-msg', '—'));
    else for (const id of cardIds) list.appendChild(this._cardChip(id));
    block.appendChild(list);
    return block;
  }

  /** Gegenvorschlag-Editor unter der Karte: beide Listen vorbefüllt, frei anpassbar. */
  async _openCounter(card, t, fb, run, counterBtn) {
    if (card.querySelector('.trade-counter')) return; // schon offen
    counterBtn.disabled = true;
    const ed = el('div', 'trade-counter');
    ed.appendChild(el('p', 'trade-msg', 'Lädt Sammlungen …'));
    card.appendChild(ed);
    let collA, collB;
    try {
      [collA, collB] = await Promise.all([
        getUserCollection(t.from_user), getUserCollection(t.to_user),
      ]);
    } catch (e) {
      ed.innerHTML = '';
      ed.appendChild(el('p', 'trade-msg trade-err', `Fehler: ${e.message || e}`));
      counterBtn.disabled = false;
      return;
    }
    ed.innerHTML = '';
    const editor = this._buildEditor({
      fromColl: collA.cards || {}, toColl: collB.cards || {},
      fromName: t.from_username || t.from_user, toName: t.to_username || t.to_user,
      fromPreset: t.from_cards || [], toPreset: t.to_cards || [],
    });
    const send = el('button', 'trade-btn trade-btn-primary', 'Gegenvorschlag senden');
    const close = el('button', 'trade-btn', 'Verwerfen');
    send.addEventListener('click', () => {
      const from = editor.getFrom(); const to = editor.getTo();
      if (!from.length || !to.length) { this._flash(fb, 'Beide Seiten brauchen mindestens 1 Karte.', true); return; }
      run(() => counterTrade(t.id, from, to));
    });
    close.addEventListener('click', () => { ed.remove(); counterBtn.disabled = false; });
    const row = el('div', 'trade-row'); row.append(send, close);
    ed.append(editor.el, row);
  }

  // --- Mehr-Slot-Editor (beide Seiten, 1–5 Karten, mit Ausschluss) ----------
  /**
   * Baut einen Editor für beide Seiten. Jede Seite hat 1–5 Slots (Select + Vorschau
   * + Entfernen) und einen „+ Karte"-Button. Optionen je Slot = besessene Karten der
   * Seite OHNE Karten, die anderswo (gleiche oder andere Seite) schon gewählt sind
   * -> keine Duplikate, keine Überschneidung. Rückgabe: { el, getFrom(), getTo() }.
   */
  _buildEditor({ fromColl, toColl, fromName, toName, fromPreset = [], toPreset = [] }) {
    const colls = { from: fromColl, to: toColl };
    const names = { from: fromName, to: toName };
    const state = { from: [], to: [] };       // je Seite: Array von { select, preview, row }
    const containers = {};
    const addButtons = {};
    const wrap = el('div', 'trade-editor');

    const usedSet = (exceptSlot) => {
      const s = new Set();
      for (const side of ['from', 'to']) {
        for (const slot of state[side]) {
          if (slot === exceptSlot) continue;
          if (slot.select.value) s.add(slot.select.value);
        }
      }
      return s;
    };

    const refreshAll = () => {
      for (const side of ['from', 'to']) {
        for (const slot of state[side]) {
          this._fillSideSelect(slot.select, colls[side], usedSet(slot), slot.select.value);
          this._updateSlotPreview(slot);
        }
        addButtons[side].disabled = state[side].length >= MAX_PER_SIDE;
      }
    };

    const addSlot = (side, presetId = '') => {
      if (state[side].length >= MAX_PER_SIDE) return;
      const row = el('div', 'trade-slot');
      const select = el('select', 'trade-select');
      const preview = el('div', 'trade-chip-wrap');
      const rm = el('button', 'trade-slot-rm', '✕');
      rm.title = 'Entfernen';
      rm.type = 'button';
      const slot = { side, row, select, preview };
      select.addEventListener('change', refreshAll);
      rm.addEventListener('click', () => {
        const i = state[side].indexOf(slot);
        if (i >= 0) state[side].splice(i, 1);
        row.remove();
        refreshAll();
      });
      row.append(select, preview, rm);
      containers[side].appendChild(row);
      state[side].push(slot);
      this._fillSideSelect(select, colls[side], usedSet(slot), presetId);
      if (presetId) select.value = presetId;
      refreshAll();
    };

    for (const side of ['from', 'to']) {
      const col = el('div', 'trade-editor-side');
      col.appendChild(el('div', 'trade-editor-title', `${names[side]} gibt`));
      const slots = el('div', 'trade-slots');
      containers[side] = slots;
      col.appendChild(slots);
      const add = el('button', 'trade-btn trade-add', '+ Karte');
      add.type = 'button';
      add.addEventListener('click', () => addSlot(side));
      addButtons[side] = add;
      col.appendChild(add);
      wrap.appendChild(col);
    }

    // Vorbefüllen: Presets, sonst je Seite ein leerer Slot.
    const presets = { from: fromPreset, to: toPreset };
    for (const side of ['from', 'to']) {
      if (presets[side].length) presets[side].forEach((id) => addSlot(side, id));
      else addSlot(side);
    }

    return {
      el: wrap,
      getFrom: () => state.from.map((s) => s.select.value).filter(Boolean),
      getTo: () => state.to.map((s) => s.select.value).filter(Boolean),
    };
  }

  /** Füllt ein Slot-Select mit besessenen Karten der Seite, ohne die ausgeschlossenen. */
  _fillSideSelect(select, coll, excludeSet, current) {
    select.innerHTML = '';
    const o0 = el('option', null, '– Karte wählen –'); o0.value = '';
    select.appendChild(o0);
    for (const set of (this.sets || [])) {
      const owned = set.cards.filter(
        (c) => (coll[c.id] || 0) > 0 && (c.id === current || !excludeSet.has(c.id)),
      );
      if (!owned.length) continue;
      const g = document.createElement('optgroup');
      g.label = set.name;
      for (const c of owned) {
        const o = el('option', null, `${c.name} (${c.rarity}/${c.finish})`);
        o.value = c.id;
        g.appendChild(o);
      }
      select.appendChild(g);
    }
    select.value = current || '';
  }

  _updateSlotPreview(slot) {
    slot.preview.innerHTML = '';
    if (slot.select.value) slot.preview.appendChild(this._cardChip(slot.select.value));
  }

  _cardChip(cardId) {
    const c = this.cardMap[cardId] || { name: cardId };
    const chip = el('div', 'trade-chip');
    const img = el('img', 'trade-chip-img'); img.alt = ''; img.loading = 'lazy';
    if (c.assetUrl) img.src = c.assetUrl;
    img.addEventListener('error', () => { img.removeAttribute('src'); img.classList.add('is-missing'); });
    chip.appendChild(img);
    const info = el('div', 'trade-chip-info');
    info.appendChild(el('div', 'trade-chip-name', c.name || cardId));
    const sub = [c.rarity, c.finish].filter(Boolean).join(' · ');
    if (sub) info.appendChild(el('div', 'trade-chip-sub', sub));
    chip.appendChild(info);
    return chip;
  }

  _flash(node, msg, isErr = false) {
    node.textContent = msg;
    node.classList.toggle('trade-err', isErr);
    node.classList.toggle('trade-ok', !isErr);
  }
}
