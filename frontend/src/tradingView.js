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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Trading {
  /** @param {{ onClose: ()=>void, onIncomingCount?: (n:number)=>void }} opts */
  constructor({ onClose, onIncomingCount } = {}) {
    this.onClose = onClose || (() => {});
    this._onIncoming = onIncomingCount || null;
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
    if (this.root.hidden || document.hidden) return;
    let data;
    try { data = await listTrades(); } catch { return; } // transiente Fehler ignorieren
    if (this._onIncoming) this._onIncoming(data.incoming.length);
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
      (t) => `${t.id}:${t.status}:${t.turn_user}:${t.offered_card}:${t.requested_card}:${t.updated_at}`,
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
    // Im Hintergrund-Tab pausieren (Ressourcen schonen), bei Rückkehr weiterlaufen.
    this._visHandler = () => { if (document.hidden) this._clearTimer(); else this._ensureTimer(); };
    document.addEventListener('visibilitychange', this._visHandler);
    this._ensureTimer();
  }

  _ensureTimer() {
    if (this._pollTimer || document.hidden || this.root.hidden) return;
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

    const myPicker = this._cardPicker(this.myCollection, null, 'Deine Karte (du gibst)');
    const theirWrap = el('div', 'trade-their');
    theirWrap.appendChild(el('p', 'trade-msg', 'Erst einen Partner wählen.'));
    let theirPicker = null;

    pSel.addEventListener('change', async () => {
      theirWrap.innerHTML = '';
      theirPicker = null;
      if (!pSel.value) { theirWrap.appendChild(el('p', 'trade-msg', 'Erst einen Partner wählen.')); return; }
      theirWrap.appendChild(el('p', 'trade-msg', 'Lädt Sammlung …'));
      try {
        const coll = await getUserCollection(pSel.value);
        const name = pSel.options[pSel.selectedIndex].text;
        theirWrap.innerHTML = '';
        theirPicker = this._cardPicker(coll.cards || {}, null, `Karte von ${name} (du bekommst)`);
        theirWrap.appendChild(theirPicker);
      } catch (e) {
        theirWrap.innerHTML = '';
        theirWrap.appendChild(el('p', 'trade-msg trade-err', `Sammlung konnte nicht geladen werden: ${e.message || e}`));
      }
    });

    const send = el('button', 'trade-btn trade-btn-primary', 'Vorschlag senden');
    const fb = el('div', 'trade-fb');
    send.addEventListener('click', async () => {
      const partner = pSel.value;
      const mine = myPicker._select.value;
      const theirs = theirPicker && theirPicker._select.value;
      if (!partner) { this._flash(fb, 'Bitte einen Partner wählen.', true); return; }
      if (!mine) { this._flash(fb, 'Bitte deine Karte wählen.', true); return; }
      if (!theirs) { this._flash(fb, 'Bitte die gewünschte Karte wählen.', true); return; }
      send.disabled = true;
      try {
        await createTrade(partner, mine, theirs);
        await this._hardRefresh();
      } catch (e) { this._flash(fb, e.message || String(e), true); send.disabled = false; }
    });

    panel.append(partnerRow, myPicker, theirWrap, send, fb);
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

    // Tausch-Paar: A (from) gibt offered_card  ⇄  B (to) gibt requested_card.
    const pair = el('div', 'trade-pair');
    pair.appendChild(this._sideBlock(t.from_username || t.from_user, t.offered_card, t.from_user === meId));
    pair.appendChild(el('div', 'trade-swap', '⇄'));
    pair.appendChild(this._sideBlock(t.to_username || t.to_user, t.requested_card, t.to_user === meId));
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

  _sideBlock(name, cardId, isMe) {
    const block = el('div', 'trade-side');
    block.appendChild(el('div', 'trade-side-name', isMe ? `${name} (du)` : name));
    block.appendChild(this._cardChip(cardId));
    return block;
  }

  /** Gegenvorschlag-Editor unter der Karte: beide Seiten neu zusammenstellen. */
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
    const pickA = this._cardPicker(collA.cards || {}, t.offered_card, `${t.from_username || t.from_user} gibt`);
    const pickB = this._cardPicker(collB.cards || {}, t.requested_card, `${t.to_username || t.to_user} gibt`);
    const send = el('button', 'trade-btn trade-btn-primary', 'Gegenvorschlag senden');
    const close = el('button', 'trade-btn', 'Verwerfen');
    send.addEventListener('click', () => {
      const a = pickA._select.value; const b = pickB._select.value;
      if (!a || !b) { this._flash(fb, 'Bitte beide Karten wählen.', true); return; }
      run(() => counterTrade(t.id, a, b));
    });
    close.addEventListener('click', () => { ed.remove(); counterBtn.disabled = false; });
    const row = el('div', 'trade-row'); row.append(send, close);
    ed.append(pickA, pickB, row);
  }

  // --- Karten-Bausteine -----------------------------------------------------
  _cardPicker(collection, presetId, label) {
    const wrap = el('div', 'trade-picker');
    if (label) wrap.appendChild(el('div', 'trade-picker-label', label));
    const select = el('select', 'trade-select');
    this._fillCardSelect(select, collection);
    if (presetId) select.value = presetId;
    const preview = el('div', 'trade-chip-wrap');
    const renderPrev = () => {
      preview.innerHTML = '';
      if (select.value) preview.appendChild(this._cardChip(select.value));
    };
    select.addEventListener('change', renderPrev);
    renderPrev();
    wrap.append(select, preview);
    wrap._select = select;
    return wrap;
  }

  _fillCardSelect(select, collection) {
    select.innerHTML = '';
    const o0 = el('option', null, '– Karte wählen –'); o0.value = '';
    select.appendChild(o0);
    for (const set of (this.sets || [])) {
      const owned = set.cards.filter((c) => (collection[c.id] || 0) > 0);
      if (!owned.length) continue;
      const g = document.createElement('optgroup');
      g.label = set.name;
      for (const c of owned) {
        const o = el('option', null, `${c.name} ×${collection[c.id]} (${c.rarity}/${c.finish})`);
        o.value = c.id;
        g.appendChild(o);
      }
      select.appendChild(g);
    }
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
