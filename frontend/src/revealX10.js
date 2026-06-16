// x10-Öffnen (Phase x10, korrektes Verhalten wie TCG Pocket):
//
// 1) EINMALIGER gemeinsamer Auftakt: alle 10 Packs (als Raster sichtbar) reißen
//    FAST gleichzeitig, nur leicht versetzt (Welle/Domino) auf. Pro Pack erscheint
//    dabei – falls es etwas Besonderes enthält – sein Beam (silber/gold) an seiner
//    Position. Mehrere Beams gleichzeitig möglich.
// 2) Danach werden die Packs ausgeblendet und man fliegt NUR noch durch die Karten:
//    10er-Blöcke (Pack für Pack) über den bestehenden CardStack, ohne weitere
//    Aufreiß-Animationen. Fortschritt „Pack i/10 · Karte r/10".
//
// Performance: das Pack-GLB wird EINMAL geladen und 10x geklont (geteilte Geometrie/
// Texturen; nur pro Instanz eigene Materialien für die Opazität). Karten teilen wie
// bisher das filet-Template (cardStack).
//
// Wiederverwendet: cardStack, ui, tweens. Für die mehreren gleichzeitigen Beams
// werden eigene Beam-Instanzen erzeugt (die geteilte beam-Instanz kann nur eine).

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Beam } from './beam.js';
import { openPackX10 } from './api.js';
import { resolveSetAsset } from './setLoader.js';
import {
  PACK_VIEW_HEIGHT,
  PACK_OPEN_TIMESCALE,
  PACK_FADE_DURATION,
  CARD_VIEW_HEIGHT,
  BEAM_RIP_HEIGHT_FACTOR,
  BEAM_RIP_X_FACTOR,
  AUTO_RETURN_DELAY,
  X10_RIP_STAGGER,
  X10_HOLD_AFTER_RIP,
} from './config.js';

const X10_COUNT = 10;
const GRID_COLS = 5;
const GRID_ROWS = 2;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export class RevealX10 {
  constructor({ scene, camera, cardStack, tweens, ui, onComplete }) {
    this.scene = scene;
    this.camera = camera;
    this.cardStack = cardStack;
    this.tweens = tweens;
    this.ui = ui;
    this.onComplete = onComplete; // () => void: Auto-Rückkehr zur Landing

    this.active = false;
    this.result = null;
    this.packsData = null;
    this.instances = null;       // [{ holder, obj, mixer, action, playing, gridPos, _onFinish }]
    this.rowGroup = null;
    this._beams = [];            // mehrere gleichzeitige Beams (Auftakt)
    this._base = null;           // { scene, center, scale, width, clip, clipDur }
    this._baseUrl = null;
    this._packScale = PACK_VIEW_HEIGHT;
    this._returnTimer = null;
    this._waitTimer = null;
    this._blockResolve = null;   // löst den aktuellen Karten-Block (Skip/Exit)
  }

  /** Pro Frame: laufende Rip-Mixer + aktive Beams aktualisieren. */
  update(delta) {
    if (this.instances) {
      for (const inst of this.instances) {
        if (inst.playing && inst.mixer) inst.mixer.update(delta);
      }
    }
    for (const b of this._beams) b.update(delta);
  }

  async start(packId, ripUrl) {
    if (this.active) return;
    this.active = true;
    this.ui.setMode('opening');
    this.ui.setStatus('Lädt …');
    this.ui.setHint('');

    // Karten PARALLEL holen (vor dem GLB-await), damit nichts wartet.
    const resultP = openPackX10(packId);
    resultP.catch(() => {});

    try {
      await this._ensureBase(ripUrl);
    } catch (e) {
      this._fail(e);
      return;
    }
    if (!this.active) return;
    this._buildRow();

    let result;
    try {
      result = await resultP;
    } catch (e) {
      this._fail(e);
      return;
    }
    if (!this.active) return;
    this.result = result;
    this.packsData = result.packs;

    this._run().catch((e) => { console.error('x10:', e); this._fail(e); });
  }

  async _run() {
    await this._openingAuftakt();          // alle Packs einmal gemeinsam aufreißen + Beams
    if (!this.active) return;
    this._fadeAllPacks();                   // Packs raus -> danach reiner Karten-Durchflug
    for (let i = 0; i < this.instances.length; i++) {
      if (!this.active) return;
      await this._revealCards(i);
    }
    this._finish();
  }

  /** Einmaliger gemeinsamer Aufreiß-Auftakt: alle Packs versetzt, Beams pro Pack. */
  async _openingAuftakt() {
    const dur = this._base.clipDur > 0 ? this._base.clipDur / PACK_OPEN_TIMESCALE : 0;
    const ripPromises = [];
    for (let i = 0; i < this.instances.length; i++) {
      const inst = this.instances[i];
      ripPromises.push(new Promise((resolve) => { inst._onFinish = resolve; }));
      const delay = i * X10_RIP_STAGGER;
      this.tweens.add({
        delay, duration: 0.001, onUpdate() {},
        onComplete: () => { if (this.active) this._playRip(i); },
      });
      const stage = this.packsData[i].beam_stage;
      if (stage && stage !== 'normal') {
        this.tweens.add({
          delay: delay + dur * 0.35, duration: 0.001, onUpdate() {},
          onComplete: () => { if (this.active) this._showBeam(i, stage); },
        });
      }
    }
    await Promise.all(ripPromises);
    await this._wait(X10_HOLD_AFTER_RIP); // kurz halten, damit man offene Packs + Beams sieht
  }

  /** Die 10 Karten eines Packs über den bestehenden CardStack durchgehen. */
  async _revealCards(i) {
    const total = this.instances.length;
    const cards = this.packsData[i].drawn_cards.map((c) => ({
      ...c, assetUrl: resolveSetAsset(c.set_id, c.asset),
    }));

    this.cardStack.build(cards, 'vorne', CARD_VIEW_HEIGHT, true);

    const doneP = new Promise((resolve) => { this._blockResolve = resolve; });
    this.cardStack.onDone = () => { if (this._blockResolve) this._blockResolve(); };
    this.cardStack.onProgress = (r, t) =>
      this.ui.setStatus(`Pack ${i + 1}/${total} · Karte ${Math.min(r + 1, t)}/${t}`);

    this.cardStack.begin();
    this.cardStack.enableInput();

    this.ui.setMode('reveal');
    this.ui.setStatus(`Pack ${i + 1}/${total} · Karte 1/${cards.length}`);
    this.ui.setHint('Karte ziehen/klicken: weiter');
    this.ui.onSkip = () => { if (this._blockResolve) this._blockResolve(); }; // Pack überspringen
    this.ui.showSkip(true);

    await doneP;

    this._blockResolve = null;
    this.ui.onSkip = null;
    this.ui.showSkip(false);
    this.cardStack.disableInput();
    this.cardStack.dispose();
  }

  _playRip(i) {
    const inst = this.instances[i];
    if (!inst.action) { // kein Clip -> sofort "fertig"
      const cb = inst._onFinish; inst._onFinish = null;
      if (cb) cb();
      return;
    }
    inst.action.reset();
    inst.action.paused = false;
    inst.action.setLoop(THREE.LoopOnce, 1);
    inst.action.clampWhenFinished = true;
    inst.action.timeScale = PACK_OPEN_TIMESCALE;
    inst.action.play();
    inst.playing = true;
  }

  _showBeam(i, stage) {
    const inst = this.instances[i];
    const beam = new Beam(this.scene, this.camera);
    beam.show(stage, this._ripPosFor(inst), this._packScale);
    this._beams.push(beam);
  }

  _ripPosFor(inst) {
    // Riss-Position relativ zur (skalierten) Pack-Position im Raster.
    return new THREE.Vector3(
      inst.gridPos.x + this._packScale * BEAM_RIP_X_FACTOR,
      inst.gridPos.y + this._packScale * BEAM_RIP_HEIGHT_FACTOR,
      inst.gridPos.z,
    );
  }

  _fadeAllPacks() {
    const insts = this.instances;
    this.tweens.add({
      duration: PACK_FADE_DURATION,
      onUpdate: (p) => { for (const inst of insts) this._setInstOpacity(inst, 1 - p); },
      onComplete: () => { for (const inst of insts) this._setInstOpacity(inst, 0); },
    });
  }

  _setInstOpacity(inst, op) {
    inst.holder.traverse((node) => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (!m) continue;
        m.transparent = true;
        m.opacity = op;
        m.depthWrite = op >= 0.99;
      }
    });
    inst.holder.visible = op > 0.001;
  }

  _wait(seconds) {
    return new Promise((resolve) => {
      this._waitResolve = resolve;
      this._waitTimer = setTimeout(() => { this._waitTimer = null; resolve(); }, seconds * 1000);
    });
  }

  // --- Pack-Raster (laden / klonen / aufräumen) -----------------------------
  async _ensureBase(url) {
    if (this._base && this._baseUrl === url) return;
    this._disposeBase();
    const gltf = await gltfLoader.loadAsync(url);
    const scene = gltf.scene;
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const clip = gltf.animations[0] || null;
    const scale = PACK_VIEW_HEIGHT / size.y;
    this._base = {
      scene, center, scale, width: size.x * scale,
      clip, clipDur: clip ? clip.duration : 0,
    };
    this._baseUrl = url;
  }

  /** 10 Packs als zentriertes 5x2-Raster, skaliert auf den sichtbaren Bereich. */
  _buildRow() {
    this._disposeRow();
    this.rowGroup = new THREE.Group();
    this.instances = [];
    const b = this._base;

    // Sichtbarer Bereich bei z = 0 (feste Kamera).
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * Math.abs(this.camera.position.z);
    const visW = visH * this.camera.aspect;
    const cellW = (visW * 0.92) / GRID_COLS;
    const cellH = (visH * 0.80) / GRID_ROWS;
    const gap = 0.16; // Rand pro Zelle
    const fit = Math.min((cellW * (1 - gap)) / b.width, (cellH * (1 - gap)) / PACK_VIEW_HEIGHT);
    this._packScale = PACK_VIEW_HEIGHT * fit;
    const gridScale = b.scale * fit;

    for (let k = 0; k < X10_COUNT; k++) {
      const col = k % GRID_COLS;
      const rowIdx = Math.floor(k / GRID_COLS);
      const inst = this._makeInstance(gridScale);
      inst.holder.position.set(
        (col - (GRID_COLS - 1) / 2) * cellW,
        ((GRID_ROWS - 1) / 2 - rowIdx) * cellH,
        0,
      );
      inst.gridPos = inst.holder.position.clone();
      this.rowGroup.add(inst.holder);
      this.instances.push(inst);
    }
    this.scene.add(this.rowGroup);
  }

  _makeInstance(scale) {
    const b = this._base;
    const obj = skeletonClone(b.scene);
    obj.position.copy(b.center).multiplyScalar(-1); // Mittelpunkt in den Holder-Ursprung
    // Eigene Materialien je Instanz (unabhängige Opazität); Texturen bleiben geteilt.
    obj.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => m.clone())
          : o.material.clone();
      }
    });
    const holder = new THREE.Group();
    holder.add(obj);
    holder.scale.setScalar(scale);

    const inst = { holder, obj, mixer: null, action: null, playing: false, gridPos: null, _onFinish: null };
    if (b.clip) {
      inst.mixer = new THREE.AnimationMixer(obj);
      inst.action = inst.mixer.clipAction(b.clip);
      inst.action.setLoop(THREE.LoopOnce, 1);
      inst.action.clampWhenFinished = true;
      inst.action.play();
      inst.action.paused = true;
      inst.mixer.setTime(0); // Frame 0 = geschlossen
      inst.mixer.addEventListener('finished', () => {
        inst.playing = false;
        const cb = inst._onFinish; inst._onFinish = null;
        if (cb) cb();
      });
    }
    return inst;
  }

  _finish() {
    this.active = false;
    this.cardStack.disableInput();
    this.ui.showSkip(false);
    this.ui.setMode('done');
    this.ui.setStatus(`Fertig — Sanduhren übrig: ${this.result.hourglasses_remaining}`);
    if (this.onComplete) {
      this._returnTimer = setTimeout(() => {
        this._returnTimer = null;
        this.onComplete();
      }, AUTO_RETURN_DELAY * 1000);
    }
  }

  _fail(e) {
    this.active = false;
    const msg = e && e.status === 401
      ? 'Bitte zuerst mit Discord anmelden (Menü oben rechts).'
      : e && e.status === 400
        ? 'Zu wenig Sanduhren für x10.'
        : `Fehler beim Öffnen: ${e?.message || e}`;
    this.ui.showSkip(false);
    this.ui.setMode('done');
    this.ui.setStatus(msg);
    if (this.onComplete) {
      this._returnTimer = setTimeout(() => {
        this._returnTimer = null;
        this.onComplete();
      }, 2200);
    }
  }

  reset() {
    if (this._returnTimer) { clearTimeout(this._returnTimer); this._returnTimer = null; }
    if (this._waitTimer) { clearTimeout(this._waitTimer); this._waitTimer = null; }
    this.active = false;
    // Laufenden Karten-Block/Wartepunkt entsperren, damit _run sauber endet.
    if (this._blockResolve) { const r = this._blockResolve; this._blockResolve = null; r(); }
    if (this._waitResolve) { const r = this._waitResolve; this._waitResolve = null; r(); }
    this.ui.onSkip = null;
    this.ui.showSkip(false);
    this.cardStack.disableInput();
    this.cardStack.dispose();
    for (const b of this._beams) b.dispose();
    this._beams = [];
    this._disposeRow();
    this.result = null;
    this.packsData = null;
  }

  _disposeRow() {
    if (this.rowGroup) {
      this.scene.remove(this.rowGroup);
      for (const inst of (this.instances || [])) {
        if (inst.mixer) inst.mixer.stopAllAction();
        inst.holder.traverse((node) => {
          if (!node.isMesh) return;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) if (m) m.dispose(); // nur die per-Instanz geklonten Materialien
        });
      }
      this.rowGroup = null;
    }
    this.instances = null;
  }

  _disposeBase() {
    if (!this._base) return;
    this._base.scene.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
    this._base = null;
    this._baseUrl = null;
  }
}
