// x10-Öffnen (Phase x10, wie TCG Pocket):
//
// Optik: schräge Aufsicht von leicht OBEN auf einen gestaffelten Pack-STAPEL. Das
// vorderste Pack ist groß/dominant; dahinter staffeln sich die restlichen Packs nach
// hinten + oben (man sieht ihre Oberkanten). KEIN Raster, KEINE reine Frontalsicht.
//
// Ablauf — Pack für Pack NACHEINANDER (kein gemeinsames Aufreißen):
//  1) Man sieht den gestaffelten Stapel von schräg oben (angled Kamera).
//  2) Das VORDERSTE Pack reißt auf, sein Beam erscheint nur, wenn es etwas Besonderes
//     hat. Dann fährt die Kamera frontal heran und die 10 Karten dieses Packs werden
//     über den CardStack durchgesehen (das offene Pack ist dabei ausgeblendet -> es
//     hängt NIE ein aufgerissenes Pack neben den Karten).
//  3) Danach rückt der Stapel ein Pack nach vorne (Kamera zurück in die Aufsicht), das
//     nächste Pack reißt auf usw. Fortschritt „Pack i/10". Nach dem 10. Auto-Return.
//
// Performance: Pack-GLB EINMAL laden, 10x klonen (geteilte Geometrie/Texturen; pro
// Instanz eigene Materialien nur für die Opazität). Karten teilen das filet-Template.
// Wiederverwendet: cardStack, ui, tweens. Beam: eigene Instanz pro besonderem Pack.

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
  CAMERA_DISTANCE,
  BEAM_RIP_HEIGHT_FACTOR,
  BEAM_RIP_X_FACTOR,
  AUTO_RETURN_DELAY,
  X10_STACK_DEPTH,
  X10_STACK_RISE,
  X10_ADVANCE,
  X10_HOLD_AFTER_RIP,
  X10_CAM_HEIGHT,
  X10_CAM_LOOK_Y,
  X10_CAM_MOVE,
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
    this.instances = null;       // [{ holder, obj, mixer, action, playing, _onFinish }]
    this.stackGroup = null;
    this._beams = [];
    this._base = null;           // { scene, center, scale, clip, clipDur }
    this._baseUrl = null;
    this._camTarget = new THREE.Vector3(0, 0, 0); // aktueller lookAt der Kamera
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
    this._snapCamera(this._angledPose()); // sofort die schräge Aufsicht einnehmen

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
      this._setStackVisible(i);    // nur Pack i..9 sichtbar (i vorne), bereits durch < i aus
      await this._ripFront(i);     // vorderstes Pack reißt auf (+ Beam), kurz halten
      if (!this.active) return;
      await this._revealCards(i);  // Kamera frontal; restl. Stapel AUS; nur Karten
      if (!this.active) return;
      if (i < this.instances.length - 1) await this._advanceToNext(i); // Kamera zurück + Stapel vor
    }
    this._finish();
  }

  /** Sichtbarkeit der Pack-Reihe: ab Index `from` sichtbar, davor (verbraucht) aus. */
  _setStackVisible(from) {
    this.instances.forEach((inst, j) => { inst.holder.visible = j >= from; });
  }

  /** Das vorderste Pack (Index i) reißt auf; Beam nur, wenn es etwas Besonderes hat. */
  async _ripFront(i) {
    const inst = this.instances[i];
    const dur = this._base.clipDur > 0 ? this._base.clipDur / PACK_OPEN_TIMESCALE : 0;
    const ripDone = new Promise((resolve) => { inst._onFinish = resolve; });
    this._playRip(i);
    const stage = this.packsData[i].beam_stage;
    if (stage && stage !== 'normal') {
      this.tweens.add({
        delay: dur * 0.35, duration: 0.001, onUpdate() {},
        onComplete: () => { if (this.active) this._showBeam(stage); },
      });
    }
    await ripDone;
    await this._wait(X10_HOLD_AFTER_RIP); // kurz die offene Packung + Beam zeigen
  }

  /** Kamera frontal heranfahren, das offene Pack ausblenden und die 10 Karten zeigen. */
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

    // Restlichen Stapel sofort ausblenden -> es hängt KEIN weiteres Pack neben den Karten.
    this.instances.forEach((other, j) => { if (j !== i) other.holder.visible = false; });

    // Kamera in die Frontalsicht (für die Karten) + offenes Pack ausblenden (parallel).
    this._tweenCamera(this._frontalPose(), X10_CAM_MOVE);
    this.tweens.add({
      duration: PACK_FADE_DURATION,
      onUpdate: (p) => this._setInstOpacity(inst, 1 - p),
      onComplete: () => this._setInstOpacity(inst, 0),
    });

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

  /** Kamera zurück in die Aufsicht, kommende (geschlossene) Packs zeigen, Stapel vorrücken. */
  async _advanceToNext(i) {
    // Pack i ist verbraucht (bleibt aus); die folgenden wieder einblenden.
    this.instances.forEach((inst, j) => { inst.holder.visible = j > i; });
    await Promise.all([
      this._tweenCamera(this._angledPose(), X10_CAM_MOVE),
      this._advanceStack(),
    ]);
  }

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

  // --- Kamera (schräge Aufsicht <-> frontal) --------------------------------
  _frontalPose() {
    return { pos: new THREE.Vector3(0, 0, CAMERA_DISTANCE), target: new THREE.Vector3(0, 0, 0) };
  }

  _angledPose() {
    // Von leicht oben auf den Stapel blicken (der nach hinten + oben staffelt).
    return {
      pos: new THREE.Vector3(0, X10_CAM_HEIGHT, CAMERA_DISTANCE),
      target: new THREE.Vector3(0, X10_CAM_LOOK_Y, -X10_STACK_DEPTH * 1.5),
    };
  }

  _snapCamera(pose) {
    this.camera.position.copy(pose.pos);
    this.camera.up.set(0, 1, 0);
    this._camTarget.copy(pose.target);
    this.camera.lookAt(this._camTarget);
  }

  _tweenCamera(pose, dur) {
    return new Promise((resolve) => {
      const fromPos = this.camera.position.clone();
      const fromTarget = this._camTarget.clone();
      this.tweens.add({
        duration: dur,
        ease: easeInOutCubic,
        onUpdate: (p) => {
          this.camera.position.lerpVectors(fromPos, pose.pos, p);
          this._camTarget.lerpVectors(fromTarget, pose.target, p);
          this.camera.lookAt(this._camTarget);
        },
        onComplete: () => {
          this.camera.position.copy(pose.pos);
          this._camTarget.copy(pose.target);
          this.camera.lookAt(this._camTarget);
          resolve();
        },
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

  /** Beam am vordersten Pack (steht durch das Vorrücken stets im Ursprung). */
  _showBeam(stage) {
    const beam = new Beam(this.scene, this.camera);
    const ripPos = new THREE.Vector3(
      PACK_VIEW_HEIGHT * BEAM_RIP_X_FACTOR,
      PACK_VIEW_HEIGHT * BEAM_RIP_HEIGHT_FACTOR,
      0,
    );
    beam.show(stage, ripPos, PACK_VIEW_HEIGHT);
    this._beams.push(beam);
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
   * 10 Packs als Stapel in die Tiefe: vorderstes (k=0) im Ursprung (groß), die hinteren
   * je weiter nach hinten (-z) und oben (+y) -> man sieht ihre Oberkanten. Durch das
   * spätere Vorrücken steht das jeweils aktuelle Pack immer im Ursprung.
   */
  _buildStack() {
    this._disposeStack();
    this.stackGroup = new THREE.Group();
    this.instances = [];
    for (let k = 0; k < X10_COUNT; k++) {
      const inst = this._makeInstance();
      inst.holder.position.set(0, k * X10_STACK_RISE, -k * X10_STACK_DEPTH);
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
    this.ui.showSkip(false);
    this._snapCamera(this._frontalPose()); // Kamera für andere Views wieder frontal
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
    this._snapCamera(this._frontalPose());
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
    // Kamera für Einzel-Opening/andere Views wieder frontal stellen.
    this._snapCamera(this._frontalPose());
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
