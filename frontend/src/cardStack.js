// Karten-Stapel + Reveal (Phase 4b).
//
// - filet.glb wird EINMAL geladen + normalisiert; alle 10 Karten teilen sich
//   Geometrie UND Material (nur Szenengraph klonen -> günstig).
// - Alle Karten liegen als EIN Stapel (minimaler Tiefen-Versatz). Die vorderste
//   Karte schwebt NICHT davor — sie liegt vorne auf dem Stapel und löst sich erst
//   beim Wegwischen.
// - Eingabe während des Reveals (eigene Pointer-Logik mit Raycast):
//     * Drag, der AUF der vordersten Karte beginnt -> Karte folgt dem Finger;
//       weit genug + loslassen -> fliegt raus; sonst federt zurück.
//     * Drag NEBEN dem Stapel -> Stapel drehen (geklemmt ± + Feder zur Mitte).
//     * Modus "hinten": Tap auf die Rückseite flippt die Karte (bleibt liegen),
//       danach ist sie per Drag wischbar.
//   Unterscheidung über den Anfasspunkt (Raycast), nicht über die Richtung.
//
// filet.glb: Material.001 = Rückseite, Material.002 = Vorderseite.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { easeInOutCubic, easeOutCubic } from './tween.js';
import {
  CARD_STACK_DEPTH,
  SWIPE_DISTANCE_THRESHOLD,
  SWIPE_FOLLOW_SENSITIVITY,
  SWIPE_OUT_DURATION,
  SWIPE_OUT_DISTANCE,
  SWIPE_RETURN_DURATION,
  TAP_VS_DRAG_THRESHOLD,
  STACK_MAX_ANGLE_RAD,
  STACK_DRAG_SENSITIVITY,
  STACK_SPRING_STIFFNESS,
  STACK_SPRING_DAMPING,
  FLIP_DURATION,
  FLIP_FORWARD,
} from './config.js';

const BACK_MATERIAL = 'Material.001';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export class CardStack {
  constructor(scene, camera, renderer, tweens) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.tweens = tweens;

    this.template = null;
    this._baseScale = 1;
    this.root = null;
    this.cards = [];
    this.currentIndex = 0;
    this.cardHeight = 1;
    this.mode = 'hinten';
    this.busy = false;
    this.done = false;
    this.onDone = null;
    this.onProgress = null;
    // (ready, leftX, rightX) => void: Pfeile an/aus + Bildschirm-X der Kartenränder.
    this.onSwipeReady = null;
    this._ready = false;

    // Eingabe-Status
    this._inputOn = false;
    this._grab = null;            // aktuelle Geste
    this._stackVel = 0;           // Winkel-Geschwindigkeit der Stapel-Feder
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  /** filet.glb laden + Template normalisieren (einmalig, gecached). */
  async loadTemplate() {
    if (this.template) return;
    const gltf = await gltfLoader.loadAsync('/models/cards/filet.glb');
    gltf.scene.updateMatrixWorld(true);

    const tpl = new THREE.Group();
    let backMesh = null;
    let frontMesh = null;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      const mesh = new THREE.Mesh(geo, o.material.clone());
      mesh.material.side = THREE.FrontSide;
      if (o.material.name === BACK_MATERIAL) backMesh = mesh;
      else frontMesh = mesh;
      tpl.add(mesh);
    });

    this._normalizeTemplate(tpl, backMesh, frontMesh);
    this.template = tpl;
  }

  /**
   * Karten-Material + Texturen EINMAL beim Seitenstart aufwärmen, damit das erste
   * Anzeigen der Karten nicht ruckelt (kein on-the-fly Shader-Compile/Upload).
   */
  prewarm() {
    if (!this.template || !this.renderer) return;
    this.template.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          if (m && m[key]) this.renderer.initTexture(m[key]);
        }
      }
    });
    const warm = this.template.clone(true);
    this.scene.add(warm);
    this.renderer.compile(this.scene, this.camera);
    this.scene.remove(warm);
  }

  /**
   * Stapel bauen. Alle Karten liegen als EIN Stapel (Tiefen-Versatz), die
   * vorderste auf Slot 0. Optional versteckt (für Vorbau während der Animation).
   */
  build(serverCards, mode, cardHeight, hidden = false) {
    this.dispose();
    this.mode = mode;
    this.cardHeight = cardHeight;
    this.template.scale.setScalar(this._baseScale * cardHeight);

    // Rückseite zeigt bei rotation.y = 0 zur Kamera. Im Modus "vorne" 180° vordrehen.
    const baseRotY = mode === 'vorne' ? Math.PI : 0;

    this.root = new THREE.Group();
    this.root.visible = !hidden;
    this.scene.add(this.root);

    this.cards = serverCards.map((sc, i) => {
      const holder = new THREE.Group();
      const card = this.template.clone(true); // teilt Geometrie + Material
      // TODO(echte Assets): pro Karte Front-Material klonen und map = sc.asset setzen.
      holder.add(card);
      holder.rotation.y = baseRotY;
      holder.position.copy(this._slotPosition(i));
      this.root.add(holder);
      return { holder, baseRotY, revealed: mode === 'vorne', data: sc };
    });

    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
    this._ready = false;
    this._stackVel = 0;
  }

  /** Stapel einblenden (er ist bereits korrekt aufgebaut). */
  begin() {
    if (this.root) this.root.visible = true;
    this._updateReady();
  }

  getRotationTarget() {
    return this.root;
  }

  // --- Pointer-Eingabe während des Reveals -----------------------------------

  enableInput() {
    if (this._inputOn) return;
    this._inputOn = true;
    this.renderer.domElement.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
  }

  disableInput() {
    if (!this._inputOn) return;
    this._inputOn = false;
    this.renderer.domElement.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this._grab = null;
  }

  /** Pro Frame: Stapel federt zur Mitte zurück (wenn nicht gerade gedreht wird). */
  update(delta) {
    if (!this.root) return;
    const draggingStack = this._grab && this._grab.mode === 'stack';
    if (draggingStack) return;
    const x = this.root.rotation.y;
    if (Math.abs(x) < 1e-4 && Math.abs(this._stackVel) < 1e-4) return;
    const d = Math.min(delta, 1 / 30);
    const acc = -STACK_SPRING_STIFFNESS * x - STACK_SPRING_DAMPING * this._stackVel;
    this._stackVel += acc * d;
    this.root.rotation.y = x + this._stackVel * d;
    if (Math.abs(this.root.rotation.y) < 1e-4 && Math.abs(this._stackVel) < 1e-4) {
      this.root.rotation.y = 0;
      this._stackVel = 0;
    }
  }

  _onDown(e) {
    if (!this.root || this.done) return;
    const card = this.cards[this.currentIndex];
    const onCard = card && !this.busy && this._raycastFront(e, card);
    if (onCard && card.revealed) {
      // Greifen der vordersten (aufgedeckten) Karte -> Wischen.
      this._grab = { mode: 'card', startX: e.clientX, cardStartX: card.holder.position.x, moved: 0 };
    } else {
      // Leerer Bereich (oder Rückseite, die nur per Tap geflippt wird) -> Stapel drehen.
      this._stackVel = 0;
      this._grab = {
        mode: 'stack',
        startX: e.clientX,
        startRot: this.root.rotation.y,
        moved: 0,
        tapFlip: !!(onCard && !card.revealed), // Tap auf Rückseite -> Flip-Kandidat
      };
    }
  }

  _onMove(e) {
    if (!this._grab) return;
    const dx = e.clientX - this._grab.startX;
    this._grab.moved = Math.max(this._grab.moved, Math.abs(dx));
    if (this._grab.mode === 'card') {
      const card = this.cards[this.currentIndex];
      if (card) card.holder.position.x = this._grab.cardStartX + dx * SWIPE_FOLLOW_SENSITIVITY;
    } else {
      const r = this._grab.startRot + dx * STACK_DRAG_SENSITIVITY;
      this.root.rotation.y = THREE.MathUtils.clamp(r, -STACK_MAX_ANGLE_RAD, STACK_MAX_ANGLE_RAD);
    }
  }

  _onUp() {
    const g = this._grab;
    this._grab = null;
    if (!g) return;
    if (g.mode === 'card') {
      const card = this.cards[this.currentIndex];
      if (!card) return;
      const x = card.holder.position.x;
      if (Math.abs(x) >= SWIPE_DISTANCE_THRESHOLD) this._flyOut(card, Math.sign(x) || 1);
      else this._returnCard(card);
    } else if (g.tapFlip && g.moved < TAP_VS_DRAG_THRESHOLD) {
      // Tap auf die Rückseite -> aufdecken (Flip), bleibt liegen.
      this._flip(this.cards[this.currentIndex]);
    }
    // Stapel-Drehen: Rückkehr zur Mitte erledigt update() (Feder).
  }

  // --- Reveal-Schritte -------------------------------------------------------

  _flip(card) {
    if (!card || this.busy || card.revealed) return;
    this.busy = true;
    this._setReady(false);
    const startRot = card.holder.rotation.y;
    const endRot = startRot + Math.PI;
    const arc = FLIP_FORWARD * this.cardHeight;
    this.tweens.add({
      duration: FLIP_DURATION,
      ease: easeInOutCubic,
      onUpdate: (p) => {
        card.holder.rotation.y = startRot + (endRot - startRot) * p;
        card.holder.position.z = Math.sin(p * Math.PI) * arc; // Bogen nach vorn + zurück
      },
      onComplete: () => {
        card.holder.position.z = 0; // wieder bündig auf dem Stapel
        card.revealed = true;
        this.busy = false;
        this._updateReady();
      },
    });
  }

  _flyOut(card, dir) {
    this.busy = true;
    this._setReady(false);
    // Materialien nur dieser Karte isolieren (klonen), damit nur sie ausblendet.
    const mats = [];
    card.holder.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        mats.push(o.material);
      }
    });
    const fromX = card.holder.position.x;
    const toX = fromX + dir * this.cardHeight * SWIPE_OUT_DISTANCE;
    this.tweens.add({
      duration: SWIPE_OUT_DURATION,
      ease: easeOutCubic, // zügig an, sanft aus
      onUpdate: (p) => {
        card.holder.position.x = fromX + (toX - fromX) * p;
        const o = 1 - p;
        for (const m of mats) m.opacity = o;
      },
      onComplete: () => {
        this.root.remove(card.holder);
        for (const m of mats) m.dispose();
        this.currentIndex += 1;
        if (this.onProgress) this.onProgress(this.currentIndex, this.cards.length);
        if (this.currentIndex >= this.cards.length) {
          this.busy = false;
          this.done = true;
          this._setReady(false);
          if (this.onDone) this.onDone();
        } else {
          this._advanceNext();
        }
      },
    });
  }

  /** Nicht weit genug gezogen -> Karte federt an ihren Platz (x=0) zurück. */
  _returnCard(card) {
    this.busy = true;
    const fromX = card.holder.position.x;
    this.tweens.add({
      duration: SWIPE_RETURN_DURATION,
      ease: easeOutCubic,
      onUpdate: (p) => { card.holder.position.x = fromX * (1 - p); },
      onComplete: () => { card.holder.position.x = 0; this.busy = false; this._updateReady(); },
    });
  }

  /** Verbleibende Karten weich an ihre neuen Slots (vorderste auf Slot 0). */
  _advanceNext() {
    this.busy = true;
    this._setReady(false);
    for (let i = this.currentIndex; i < this.cards.length; i++) {
      const holder = this.cards[i].holder;
      const from = holder.position.clone();
      const to = this._slotPosition(i - this.currentIndex);
      const isFront = i === this.currentIndex;
      this.tweens.add({
        duration: 0.3,
        ease: easeOutCubic,
        onUpdate: (p) => holder.position.lerpVectors(from, to, p),
        onComplete: isFront ? () => { this.busy = false; this._updateReady(); } : undefined,
      });
    }
  }

  /** Pfeile/Bereitschaft setzen: vorderste Karte aufgedeckt & ruhig? */
  _updateReady() {
    const card = this.cards[this.currentIndex];
    this._setReady(!!card && card.revealed && !this.busy && !this.done);
  }

  _setReady(ready) {
    this._ready = ready;
    if (!this.onSwipeReady) return;
    if (!ready) { this.onSwipeReady(false); return; }
    // Bildschirm-X der linken/rechten Kartenkante berechnen (für Pfeil-Platzierung).
    const card = this.cards[this.currentIndex];
    card.holder.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(card.holder);
    const cy = (box.min.y + box.max.y) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toScreenX = (x) => {
      const p = new THREE.Vector3(x, cy, cz).project(this.camera);
      return rect.left + (p.x * 0.5 + 0.5) * rect.width;
    };
    this.onSwipeReady(true, toScreenX(box.min.x), toScreenX(box.max.x));
  }

  _raycastFront(e, card) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, this.camera);
    return this._raycaster.intersectObject(card.holder, true).length > 0;
  }

  dispose() {
    this.disableInput();
    if (this.root) {
      this.scene.remove(this.root);
      // Geometrie + Material sind mit dem Template geteilt -> NICHT disposen.
      this.root = null;
    }
    this.cards = [];
    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
    this._stackVel = 0;
    this._setReady(false);
  }

  // --- intern ----------------------------------------------------------------

  /** Nur minimaler Tiefen-Versatz (× Kartenhöhe). Kein x/y -> kein Auffächern. */
  _slotPosition(d) {
    return new THREE.Vector3(0, 0, -d * CARD_STACK_DEPTH * this.cardHeight);
  }

  _normalizeTemplate(tpl, backMesh, frontMesh) {
    const v = new THREE.Vector3();

    let box = new THREE.Box3().setFromObject(tpl);
    const center = box.getCenter(v).clone();
    tpl.children.forEach((c) => c.geometry.translate(-center.x, -center.y, -center.z));

    box = new THREE.Box3().setFromObject(tpl);
    const size = box.getSize(v).clone();
    const thin = size.x <= size.y && size.x <= size.z ? 'x'
      : size.y <= size.x && size.y <= size.z ? 'y' : 'z';
    if (thin === 'x') tpl.children.forEach((c) => c.geometry.rotateY(Math.PI / 2));
    else if (thin === 'y') tpl.children.forEach((c) => c.geometry.rotateX(Math.PI / 2));

    box = new THREE.Box3().setFromObject(tpl);
    const s2 = box.getSize(v).clone();
    if (s2.x > s2.y) tpl.children.forEach((c) => c.geometry.rotateZ(Math.PI / 2));

    box = new THREE.Box3().setFromObject(tpl);
    const s3 = box.getSize(v).clone();
    this._baseScale = 1 / Math.max(s3.x, s3.y);

    tpl.updateMatrixWorld(true);
    if (backMesh && frontMesh) {
      const backZ = new THREE.Box3().setFromObject(backMesh).getCenter(new THREE.Vector3()).z;
      const frontZ = new THREE.Box3().setFromObject(frontMesh).getCenter(new THREE.Vector3()).z;
      if (backZ < frontZ) tpl.children.forEach((c) => c.geometry.rotateY(Math.PI));
    }
  }
}
