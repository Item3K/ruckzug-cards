// x10-Öffnen (Phase x10, wie TCG Pocket):
//
// 1) Die 10 Packs liegen als EIN STAPEL IN DIE TIEFE — vorderstes Pack groß/zentriert
//    (wie beim Einzel-Opening), die anderen 9 dahinter gestaffelt (leicht nach hinten
//    + oben versetzt, sodass man die Kanten der hinteren Packs sieht). KEIN Raster.
// 2) EINMALIGER gemeinsamer Auftakt: alle Packs reißen fast gleichzeitig auf, als
//    leicht versetzte Welle (vorne zuerst -> nach hinten). Pro Pack erscheint dabei –
//    falls es etwas Besonderes enthält – sein Beam (silber/gold) an seiner Position.
// 3) Danach arbeitet man sich nach vorne durch: das vorderste Pack blendet aus und
//    zeigt seine 10 Karten (CardStack), dann rückt der Stapel ein Pack nach vorne –
//    OHNE erneute Aufreiß-Animation. Fortschritt „Pack i/10".
//
// Performance: das Pack-GLB wird EINMAL geladen und 10x geklont (geteilte Geometrie/
// Texturen; nur pro Instanz eigene Materialien für die Opazität). Karten teilen wie
// bisher das filet-Template (cardStack).
//
// Wiederverwendet: cardStack, ui, tweens. Für die mehreren gleichzeitigen Beams werden
// eigene Beam-Instanzen erzeugt (die geteilte beam-Instanz kann nur eine gleichzeitig).

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Beam } from './beam.js';
import { openPackX10 } from './api.js';
import { resolveSetAsset } from './setLoader.js';
import { easeInOutCubic } from './tween.js';
import {
  PACK_VIEW_HEIGHT,
  PACK_OPEN_TIMESCALE,
  PACK_FADE_DURATION,
  CARD_VIEW_HEIGHT,
  BEAM_RIP_HEIGHT_FACTOR,
  BEAM_RIP_X_FACTOR,
  AUTO_RETURN_DELAY,
  X10_STACK_DEPTH,
  X10_STACK_RISE,
  X10_ADVANCE,
  X10_RIP_STAGGER,
  X10_HOLD_AFTER_RIP,
} from './config.js';

const X10_COUNT = 10;

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
    this.instances = null;       // [{ holder, obj, mixer, action, playing, stackPos, _onFinish }]
    this.stackGroup = null;
    this._beams = [];            // mehrere gleichzeitige Beams (Auftakt)
    this._base = null;           // { scene, center, scale, clip, clipDur }
    this._baseUrl = null;
    this._packScale = PACK_VIEW_HEIGHT;
    this._returnTimer = null;
    this._waitTimer = null;
    this._waitResolve = null;
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
    this._buildStack();

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
    await this._openingAuftakt();           // alle Packs einmal gemeinsam aufreißen + Beams
    if (!this.active) return;
    for (let i = 0; i < this.instances.length; i++) {
      if (!this.active) return;
      await this._revealCards(i);            // vorderstes Pack ausblenden + Karten durchgehen
      if (!this.active) return;
      if (i < this.instances.length - 1) await this._advanceStack(); // nächstes Pack nach vorn
    }
    this._finish();
  }

  /** Einmaliger gemeinsamer Aufreiß-Auftakt: Welle durch den Stapel, Beams pro Pack. */
  async _openingAuftakt() {
    const dur = this._base.clipDur > 0 ? this._base.clipDur / PACK_OPEN_TIMESCALE : 0;
    const ripPromises = [];
    for (let i = 0; i < this.instances.length; i++) {
      const inst = this.instances[i];
      ripPromises.push(new Promise((resolve) => { inst._onFinish = resolve; }));
      const delay = i * X10_RIP_STAGGER; // vorne zuerst -> Welle nach hinten
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
    await this._wait(X10_HOLD_AFTER_RIP); // kurz halten: offene Packs + Beams zeigen
  }

  /** Vorderstes Pack ausblenden und seine 10 Karten über den CardStack durchgehen. */
  async _revealCards(i) {
    const inst = this.instances[i];
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

    // Cross-Fade: vorderstes (offenes) Pack ausblenden, Karten erscheinen.
    this.tweens.add({
      duration: PACK_FADE_DURATION,
      onUpdate: (p) => this._setInstOpacity(inst, 1 - p),
      onComplete: () => this._setInstOpacity(inst, 0),
    });

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

  /** Stapel ein Pack nach vorne rücken (das verbrauchte vorderste ist schon ausgeblendet). */
  _advanceStack() {
    return new Promise((resolve) => {
      const g = this.stackGroup;
      const from = g.position.clone();
      const to = from.clone().add(new THREE.Vector3(0, -X10_STACK_RISE, X10_STACK_DEPTH));
      this.tweens.add({
        duration: X10_ADVANCE,
        ease: easeInOutCubic,
        onUpdate: (p) => { g.position.lerpVectors(from, to, p); },
        onComplete: resolve,
      });
    });
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
    // Riss-Position relativ zur Pack-Position im Stapel (Stapel steht im Auftakt im Ursprung).
    return new THREE.Vector3(
      inst.stackPos.x + this._packScale * BEAM_RIP_X_FACTOR,
      inst.stackPos.y + this._packScale * BEAM_RIP_HEIGHT_FACTOR,
      inst.stackPos.z,
    );
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

  // --- Pack-Stapel (laden / klonen / aufräumen) -----------------------------
  async _ensureBase(url) {
    if (this._base && this._baseUrl === url) return;
    this._disposeBase();
    const gltf = await gltfLoader.loadAsync(url);
    const scene = gltf.scene;
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const clip = gltf.animations[0] || null;
    this._base = {
      scene, center, scale: PACK_VIEW_HEIGHT / size.y,
      clip, clipDur: clip ? clip.duration : 0,
    };
    this._baseUrl = url;
  }

  /**
   * 10 Packs als Stapel in die Tiefe: vorderstes (k=0) groß im Ursprung (wie Einzel-
   * Opening), die hinteren je weiter nach hinten (-z) und leicht nach oben (+y), damit
   * man ihre Kanten sieht. Alle gleich skaliert -> Perspektive macht hintere kleiner.
   */
  _buildStack() {
    this._disposeStack();
    this.stackGroup = new THREE.Group();
    this.instances = [];
    this._packScale = PACK_VIEW_HEIGHT; // Skala = base.scale -> Pack-Höhe == PACK_VIEW_HEIGHT
    for (let k = 0; k < X10_COUNT; k++) {
      const inst = this._makeInstance();
      inst.holder.position.set(0, k * X10_STACK_RISE, -k * X10_STACK_DEPTH);
      inst.stackPos = inst.holder.position.clone();
      // Vordere Packs zuletzt zeichnen (sauberes Überdecken der hinteren Kanten).
      inst.holder.traverse((o) => { if (o.isMesh) o.renderOrder = X10_COUNT - k; });
      this.stackGroup.add(inst.holder);
      this.instances.push(inst);
    }
    this.scene.add(this.stackGroup);
  }

  _makeInstance() {
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
    holder.scale.setScalar(b.scale);

    const inst = { holder, obj, mixer: null, action: null, playing: false, stackPos: null, _onFinish: null };
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
    this._disposeStack();
    this.result = null;
    this.packsData = null;
  }

  _disposeStack() {
    if (this.stackGroup) {
      this.scene.remove(this.stackGroup);
      for (const inst of (this.instances || [])) {
        if (inst.mixer) inst.mixer.stopAllAction();
        inst.holder.traverse((node) => {
          if (!node.isMesh) return;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) if (m) m.dispose(); // nur die per-Instanz geklonten Materialien
        });
      }
      this.stackGroup = null;
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
