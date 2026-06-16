// x10-Öffnen (Phase x10, wie TCG Pocket) — STRIKT zwei getrennte Phasen:
//
//   PHASE 1 — ALLE Packs aufreißen (komplett, bevor irgendeine Karte kommt):
//     Die Kamera fliegt EINMAL über den gestaffelten Stapel (vorne -> hinten). Während
//     dieses Überflugs reißt ein Pack nach dem anderen auf (Welle, leicht versetzt);
//     beim Aufreißen erscheint pro Pack sein Beam (silber/gold), falls es etwas
//     Besonderes hat. KEINE Karten. Am Ende sind alle 10 Packs offen.
//
//   PHASE 2 — Karten durchgehen (erst NACHDEM alle 10 offen sind):
//     Kamera frontal, Stapel ausgeblendet. Dann nacheinander Pack 1..10 je 10 Karten
//     über den CardStack (wie Einzel-Opening). Kein Aufreißen/Kamera-Fahren mehr.
//     Fortschritt „Pack i/10 · Karte r/10". Nach Pack 10 Auto-Return.
//
// Optik: schräge Aufsicht von leicht oben auf den gestaffelten Tiefen-Stapel (vorderstes
// Pack groß, dahinter nach hinten+oben gestaffelt -> Oberkanten sichtbar).
//
// Performance: Pack-GLB EINMAL laden, 10x klonen (geteilte Geometrie/Texturen; pro
// Instanz eigene Materialien nur für die Opazität). Karten teilen das filet-Template.
// Wiederverwendet: cardStack, ui, tweens. Beam: eigene Instanz je besonderem Pack.

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
  X10_FLYOVER,
  X10_RIP_STAGGER,
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
    this._camTarget = new THREE.Vector3(0, 0, 0);
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
    this._snapCamera(this._poseOverPack(0)); // Start: Aufsicht auf das vorderste Pack

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
    await this._phase1RipAll();    // PHASE 1: Überflug + alle Packs aufreißen
    if (!this.active) return;
    await this._toCardsView();     // Übergang: Kamera frontal + Stapel ausblenden
    if (!this.active) return;
    for (let i = 0; i < this.instances.length; i++) { // PHASE 2: alle Kartenblöcke
      if (!this.active) return;
      await this._revealCards(i);
    }
    this._finish();
  }

  // === PHASE 1: Überflug + Wellen-Aufreißen aller Packs =====================
  async _phase1RipAll() {
    const dur = this._base.clipDur > 0 ? this._base.clipDur / PACK_OPEN_TIMESCALE : 0;
    const ripPromises = [];
    for (let k = 0; k < this.instances.length; k++) {
      const inst = this.instances[k];
      ripPromises.push(new Promise((resolve) => { inst._onFinish = resolve; }));
      const delay = k * X10_RIP_STAGGER; // Welle: vorne zuerst -> nach hinten
      this.tweens.add({
        delay, duration: 0.001, onUpdate() {},
        onComplete: () => { if (this.active) this._playRip(k); },
      });
      const stage = this.packsData[k].beam_stage;
      if (stage && stage !== 'normal') {
        this.tweens.add({
          delay: delay + dur * 0.35, duration: 0.001, onUpdate() {},
          onComplete: () => { if (this.active) this._showBeamAt(k, stage); },
        });
      }
    }
    // Kamera-Überflug vom vordersten zum hintersten Pack (parallel zur Welle).
    const flyover = this._tweenCamera(this._poseOverPack(this.instances.length - 1), X10_FLYOVER);
    await Promise.all([...ripPromises, flyover]);
    await this._wait(X10_HOLD_AFTER_RIP); // kurz alle offenen Packs zeigen
  }

  /** Übergang Phase 1 -> Phase 2: Kamera frontal + den (offenen) Stapel ausblenden. */
  async _toCardsView() {
    const insts = this.instances;
    const camP = this._tweenCamera(this._frontalPose(), X10_CAM_MOVE);
    this.tweens.add({
      duration: PACK_FADE_DURATION,
      onUpdate: (p) => { for (const inst of insts) this._setInstOpacity(inst, 1 - p); },
      onComplete: () => { if (this.stackGroup) this.stackGroup.visible = false; },
    });
    await camP;
  }

  // === PHASE 2: Karten durchgehen ===========================================
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

  // === Bausteine ============================================================
  _playRip(k) {
    const inst = this.instances[k];
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

  /** Beam an Pack k (Stapel steht fest im Ursprung -> Position aus dem Stapel-Layout). */
  _showBeamAt(k, stage) {
    const beam = new Beam(this.scene, this.camera);
    const ripPos = new THREE.Vector3(
      PACK_VIEW_HEIGHT * BEAM_RIP_X_FACTOR,
      k * X10_STACK_RISE + PACK_VIEW_HEIGHT * BEAM_RIP_HEIGHT_FACTOR,
      -k * X10_STACK_DEPTH,
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

  // === Kamera ===============================================================
  _frontalPose() {
    return { pos: new THREE.Vector3(0, 0, CAMERA_DISTANCE), target: new THREE.Vector3(0, 0, 0) };
  }

  /** Schräge Aufsicht über Pack k: konstant CAMERA_DISTANCE davor und CAM_HEIGHT darüber. */
  _poseOverPack(k) {
    const target = new THREE.Vector3(0, k * X10_STACK_RISE + X10_CAM_LOOK_Y, -k * X10_STACK_DEPTH);
    const pos = target.clone().add(new THREE.Vector3(0, X10_CAM_HEIGHT, CAMERA_DISTANCE));
    return { pos, target };
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

  // === Pack-Stapel (laden / klonen / aufräumen) =============================
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
   * 10 Packs als fester Stapel in die Tiefe: vorderstes (k=0) im Ursprung (groß), die
   * hinteren je weiter nach hinten (-z) und oben (+y) -> Oberkanten sichtbar. Der Stapel
   * bewegt sich NICHT (Phase 1 fliegt die Kamera darüber; Phase 2 blendet ihn aus).
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
    this._snapCamera(this._frontalPose()); // Kamera für Einzel-Opening wieder frontal
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
