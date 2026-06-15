// x10-Öffnen (Phase x10): 10 Packs in EINER Reihe, durchfliegen, Pack für Pack.
//
// - KEINE Dreh-Phase. Die 10 Packs stehen hintereinander (Tiefe), eins vorne,
//   die anderen dahinter angedeutet (Perspektive).
// - Pro Pack: Aufreiß-Animation (versetzt/Domino, weil der Rip beim Vorrücken
//   startet), Beam ERST wenn dieses Pack dran ist, dann die 10 Karten über den
//   bestehenden CardStack (gleiche Wisch-Mechanik wie Einzel-Opening).
// - Performance: das Pack-GLB wird EINMAL geladen und 10x geklont (geteilte
//   Geometrie/Texturen; nur pro Instanz eigene Materialien für die Opazität).
//   Die 100 Karten teilen sich – wie im Einzel-Opening – das filet-Template.
//
// Wiederverwendet: cardStack, beam, ui, tweens. Eigene leichte Pack-Reihe statt
// PackViewer (der ist auf genau ein Modell ausgelegt).

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
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
  X10_SPACING,
  X10_TRANSITION,
  X10_RIP_DELAY,
} from './config.js';

const X10_COUNT = 10;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export class RevealX10 {
  constructor({ scene, camera, beam, cardStack, tweens, ui, onComplete }) {
    this.scene = scene;
    this.camera = camera;
    this.beam = beam;
    this.cardStack = cardStack;
    this.tweens = tweens;
    this.ui = ui;
    this.onComplete = onComplete; // () => void: Auto-Rückkehr zur Landing

    this.active = false;
    this.result = null;
    this.packsData = null;
    this.instances = null;       // [{ holder, obj, mixer, action, playing, _onFinish }]
    this.rowGroup = null;
    this._base = null;           // { scene, center, scale, clip, clipDur }
    this._baseUrl = null;
    this._spacing = X10_SPACING;
    this._returnTimer = null;
  }

  /** Pro Frame: laufende Rip-Mixer der Pack-Reihe aktualisieren. */
  update(delta) {
    if (!this.instances) return;
    for (const inst of this.instances) {
      if (inst.playing && inst.mixer) inst.mixer.update(delta);
    }
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
    for (let i = 0; i < this.instances.length; i++) {
      if (!this.active) return;
      await this._advanceAndOpen(i);
      if (!this.active) return;
      await this._revealCards(i);
    }
    this._finish();
  }

  /** Pack i nach vorn bringen (Slide) + aufreißen (versetzt) + Beam, bis Rip fertig. */
  async _advanceAndOpen(i) {
    const inst = this.instances[i];
    const clipDur = this._base.clipDur;
    const dur = clipDur > 0 ? clipDur / PACK_OPEN_TIMESCALE : 0;
    const ripStartDelay = i === 0 ? 0 : X10_RIP_DELAY;

    const ripDone = new Promise((resolve) => { inst._onFinish = resolve; });

    const slideP = i === 0
      ? Promise.resolve()
      : this._tweenRow(i * this._spacing, X10_TRANSITION);

    // Rip leicht verzögert starten -> Wellen-/Domino-Gefühl beim Durchfliegen.
    this.tweens.add({
      delay: ripStartDelay, duration: 0.001, onUpdate() {},
      onComplete: () => { if (this.active) this._playRip(i); },
    });

    // Beam erst, wenn DIESES Pack dran ist (~35 % der Rip-Dauer nach dem Start).
    const stage = this.packsData[i].beam_stage;
    this.tweens.add({
      delay: ripStartDelay + dur * 0.35, duration: 0.001, onUpdate() {},
      onComplete: () => { if (this.active) this.beam.show(stage, this._ripPos(), PACK_VIEW_HEIGHT); },
    });

    await Promise.all([slideP, ripDone]);
  }

  /** Die 10 Karten dieses Packs über den bestehenden CardStack zeigen. */
  async _revealCards(i) {
    const inst = this.instances[i];
    const total = this.instances.length;
    const cards = this.packsData[i].drawn_cards.map((c) => ({
      ...c, assetUrl: resolveSetAsset(c.set_id, c.asset),
    }));

    // Stapel versteckt vorbauen (Modus 'vorne': sofort sichtbare Front, durchwischen).
    this.cardStack.build(cards, 'vorne', CARD_VIEW_HEIGHT, true);

    const doneP = new Promise((resolve) => { this.cardStack.onDone = resolve; });
    this.cardStack.onProgress = (r, t) =>
      this.ui.setStatus(`Pack ${i + 1}/${total} · Karte ${Math.min(r + 1, t)}/${t}`);

    // Cross-Fade: Karten zeigen, Pack gleichzeitig ausblenden.
    this.cardStack.begin();
    this.cardStack.enableInput();
    this.tweens.add({
      duration: PACK_FADE_DURATION,
      onUpdate: (p) => this._setInstOpacity(inst, 1 - p),
      onComplete: () => this._setInstOpacity(inst, 0),
    });

    this.ui.setMode('reveal');
    this.ui.setStatus(`Pack ${i + 1}/${total} · Karte 1/${cards.length}`);
    this.ui.setHint('Karte ziehen/klicken: weiter');

    await doneP;
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

  _ripPos() {
    // Vorderstes Pack steht (nach dem Slide) im Ursprung -> Riss-Position wie Einzel.
    return new THREE.Vector3(
      PACK_VIEW_HEIGHT * BEAM_RIP_X_FACTOR,
      PACK_VIEW_HEIGHT * BEAM_RIP_HEIGHT_FACTOR,
      0,
    );
  }

  _tweenRow(toZ, dur) {
    return new Promise((resolve) => {
      const from = this.rowGroup.position.z;
      this.tweens.add({
        duration: dur,
        ease: easeInOutCubic,
        onUpdate: (p) => { this.rowGroup.position.z = from + (toZ - from) * p; },
        onComplete: resolve,
      });
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

  // --- Pack-Reihe (laden / klonen / aufräumen) ------------------------------
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

  _buildRow() {
    this._disposeRow();
    this._spacing = X10_SPACING;
    this.rowGroup = new THREE.Group();
    this.instances = [];
    for (let k = 0; k < X10_COUNT; k++) {
      const inst = this._makeInstance();
      inst.holder.position.set(0, 0, -k * this._spacing);
      this.rowGroup.add(inst.holder);
      this.instances.push(inst);
    }
    this.rowGroup.position.set(0, 0, 0);
    this.scene.add(this.rowGroup);
  }

  _makeInstance() {
    const b = this._base;
    const obj = skeletonClone(b.scene);
    obj.position.copy(b.center).multiplyScalar(-1); // Mittelpunkt in den Holder-Ursprung
    // Eigene Materialien je Instanz (für unabhängige Opazität); Texturen bleiben geteilt.
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

    const inst = { holder, obj, mixer: null, action: null, playing: false, _onFinish: null };
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
    this.active = false;
    this.cardStack.disableInput();
    this.cardStack.dispose();
    this.beam.dispose();
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
