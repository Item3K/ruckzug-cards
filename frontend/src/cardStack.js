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
  SWIPE_LAUNCH_SPEED,
  SWIPE_OUT_DISTANCE,
  SWIPE_RETURN_DURATION,
  TAP_VS_DRAG_THRESHOLD,
  STACK_MAX_ANGLE_RAD,
  STACK_DRAG_SENSITIVITY,
  STACK_SPRING_STIFFNESS,
  STACK_SPRING_DAMPING,
  FLIP_DURATION,
  FLIP_FORWARD,
  ARROW_SIZE_FACTOR,
  ARROW_GAP_FACTOR,
  ARROW_COLOR,
} from './config.js';

const BACK_MATERIAL = 'Material.001';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// Chevron-Icon (lokal, läuft offline) einmal laden und teilen.
const _texLoader = new THREE.TextureLoader();
let _chevronTex = null;
function getChevronTexture() {
  if (!_chevronTex) {
    _chevronTex = _texLoader.load('/textures/chevron.svg');
    _chevronTex.colorSpace = THREE.SRGBColorSpace;
    _chevronTex.anisotropy = 4;
  }
  return _chevronTex;
}

// Per-Karte Front-Material (Motiv-PNG), gecached pro Asset-URL -> Karten mit
// gleichem Motiv teilen ein Material. Geklont vom Rohling-Front-Material, nur die
// map (Textur) wird getauscht; die Rückseite bleibt die gemeinsame card_back.
const _frontMatCache = new Map();
function frontMaterialFor(url, baseMat) {
  if (!url || !baseMat) return baseMat;
  if (_frontMatCache.has(url)) return _frontMatCache.get(url);
  const mat = baseMat.clone();
  const tex = _texLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = baseMat.map ? baseMat.map.flipY : false; // gleiche UV-Orientierung wie GLB-Textur
  mat.map = tex;
  mat.needsUpdate = true;
  _frontMatCache.set(url, mat);
  return mat;
}

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
    this._ready = false;

    // 3D-Pfeile (echte Szenen-Objekte neben der Karte, an den Stapel gekoppelt).
    this._arrows = null;
    this._arrowL = null;
    this._arrowR = null;
    this._arrowGapX = 0;
    this._pulseT = 0;

    // Eingabe-Status
    this._inputOn = false;
    this._grab = null;            // aktuelle Geste
    this._flying = null;          // Karte, die gerade rausfliegt (Momentum)
    this._stackVel = 0;           // Winkel-Geschwindigkeit der Stapel-Feder
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onKey = this._onKey.bind(this);
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
    // Front-Material des Rohlings merken — Basis für die per-Karte Front-Texturen.
    this._frontTemplateMat = frontMesh ? frontMesh.material : null;
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
      const card = this.template.clone(true); // teilt Geometrie + (Back-)Material
      // Front-Textur (Motiv) der gezogenen Karte auflegen; Rückseite bleibt gemeinsam.
      if (sc.assetUrl) {
        card.traverse((o) => {
          if (o.isMesh && o.material && o.material.name !== BACK_MATERIAL) {
            o.material = frontMaterialFor(sc.assetUrl, this._frontTemplateMat);
          }
        });
      }
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

    // 3D-Pfeile neben der Karte (an den Stapel gekoppelt -> bewegen/zoomen korrekt mit).
    const box = new THREE.Box3().setFromObject(this.cards[0].holder);
    const halfWidth = (box.max.x - box.min.x) / 2;
    this._buildArrows(halfWidth);
  }

  /** Zwei pulsierende Chevron-Icons (3D-Plane mit Textur) neben der Karte. */
  _buildArrows(cardHalfWidth) {
    this._cardHalfWidth = cardHalfWidth; // für späteren Live-Rebuild merken
    const size = this.cardHeight * ARROW_SIZE_FACTOR;
    const geo = new THREE.PlaneGeometry(size, size);
    const tex = getChevronTexture();
    const color = new THREE.Color(ARROW_COLOR);
    const mkMat = () => new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity: 0.6,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this._arrowR = new THREE.Mesh(geo, mkMat());        // zeigt nach rechts
    this._arrowL = new THREE.Mesh(geo, mkMat());
    this._arrowL.scale.x = -1;                          // gespiegelt -> zeigt nach links

    const gap = this.cardHeight * ARROW_GAP_FACTOR;
    this._arrowGapX = cardHalfWidth + gap;
    const z = this.cardHeight * 0.05; // leicht vor der Karte
    this._arrowR.position.set(this._arrowGapX, 0, z);
    this._arrowL.position.set(-this._arrowGapX, 0, z);

    this._arrows = new THREE.Group();
    this._arrows.add(this._arrowL, this._arrowR);
    this._arrows.visible = false;
    this._arrowL.renderOrder = 999;
    this._arrowR.renderOrder = 999;
    this.root.add(this._arrows);
  }

  /** Pfeile mit aktuellen Config-Werten neu aufbauen (Dev-Panel, live). */
  rebuildArrows() {
    if (!this.root || !this._arrows) return;
    const wasVisible = this._arrows.visible;
    this._disposeArrows();
    this._buildArrows(this._cardHalfWidth || 0.5);
    this._arrows.visible = wasVisible;
  }

  _disposeArrows() {
    if (!this._arrows) return;
    this._arrowL.geometry.dispose();
    this._arrowL.material.dispose();
    this._arrowR.material.dispose();
    this.root.remove(this._arrows);
    this._arrows = null;
    this._arrowL = null;
    this._arrowR = null;
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
    window.addEventListener('keydown', this._onKey);
  }

  disableInput() {
    if (!this._inputOn) return;
    this._inputOn = false;
    this.renderer.domElement.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('keydown', this._onKey);
    this._grab = null;
  }

  /** Pro Frame: rausfliegende Karte (Momentum) + Stapel-Feder + Pfeil-Puls. */
  update(delta) {
    const d = Math.min(delta, 1 / 30);

    // Pfeile sanft pulsieren (Opazität + leichtes Wandern nach außen).
    if (this._arrows && this._arrows.visible) {
      this._pulseT += delta;
      const s = 0.5 + 0.5 * Math.sin(this._pulseT * Math.PI * 1.4); // 0..1
      const op = 0.35 + 0.5 * s;
      const out = this.cardHeight * 0.06 * s;
      this._arrowL.material.opacity = op;
      this._arrowR.material.opacity = op;
      this._arrowL.position.x = -(this._arrowGapX + out);
      this._arrowR.position.x = this._arrowGapX + out;
    }

    // Karte fliegt mit ihrer mitgenommenen Geschwindigkeit raus und blendet aus.
    if (this._flying) {
      const f = this._flying;
      f.card.holder.position.x += f.vel * d;
      f.traveled += Math.abs(f.vel * d);
      const op = Math.max(0, 1 - f.traveled / f.target);
      for (const m of f.mats) m.opacity = op;
      if (f.traveled >= f.target) this._finishFlyOut();
    }

    if (!this.root) return;
    const draggingStack = this._grab && this._grab.mode === 'stack';
    if (draggingStack) return;
    const x = this.root.rotation.y;
    if (Math.abs(x) < 1e-4 && Math.abs(this._stackVel) < 1e-4) return;
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
      // Greifen der vordersten (aufgedeckten) Karte -> Wischen (Drag oder Klick).
      this._grab = {
        mode: 'card', startX: e.clientX, cardStartX: card.holder.position.x,
        moved: 0, lastX: e.clientX, lastT: performance.now(), velPx: 0,
      };
    } else {
      // Leerer Bereich (oder Rückseite, die nur per Tap geflippt wird) -> Stapel drehen.
      this._stackVel = 0;
      this._grab = {
        mode: 'stack', startX: e.clientX, startRot: this.root.rotation.y, moved: 0,
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
      if (!card) return;
      // Momentane Geschwindigkeit (px/s) mitschreiben, für nahtlosen Wegflug.
      const now = performance.now();
      const dt = (now - this._grab.lastT) / 1000;
      if (dt > 0) this._grab.velPx = (e.clientX - this._grab.lastX) / dt;
      this._grab.lastX = e.clientX;
      this._grab.lastT = now;
      card.holder.position.x = this._grab.cardStartX + dx * SWIPE_FOLLOW_SENSITIVITY;
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
      if (g.moved < TAP_VS_DRAG_THRESHOLD) {
        // KLICK auf die Karte: linke Hälfte -> links, rechte Hälfte -> rechts.
        this._startFlyOut(card, this._sideFromX(g.startX), SWIPE_LAUNCH_SPEED);
        return;
      }
      const x = card.holder.position.x;
      if (Math.abs(x) >= SWIPE_DISTANCE_THRESHOLD) {
        // DRAG weit genug: mit mitgenommener Geschwindigkeit rausfliegen (Momentum).
        const dir = Math.sign(x) || 1;
        const velWorld = (g.velPx || 0) * SWIPE_FOLLOW_SENSITIVITY;
        // Geschwindigkeit in Wischrichtung; mindestens Launch-Speed -> kein Stocken.
        const speed = velWorld * dir > 0
          ? Math.max(Math.abs(velWorld), SWIPE_LAUNCH_SPEED)
          : SWIPE_LAUNCH_SPEED;
        this._startFlyOut(card, dir, speed);
      } else {
        this._returnCard(card);
      }
    } else if (g.tapFlip && g.moved < TAP_VS_DRAG_THRESHOLD) {
      // Tap auf die Rückseite -> aufdecken (Flip), bleibt liegen.
      this._flip(this.cards[this.currentIndex]);
    }
    // Stapel-Drehen: Rückkehr zur Mitte erledigt update() (Feder).
  }

  /**
   * Tastatur: Pfeil links/rechts WISCHT die Karte nach links/rechts,
   * Space/Enter wischt nach rechts. (Stapel-Drehen nur noch per Drag daneben.)
   * "hinten": ist die Karte noch verdeckt, deckt der Tastendruck erst auf.
   */
  _onKey(e) {
    if (this.busy || this.done || !this.root) return;
    const card = this.cards[this.currentIndex];
    if (!card) return;
    const code = e.code;
    let dir = 0;
    if (code === 'ArrowLeft') dir = -1;
    else if (code === 'ArrowRight') dir = 1;
    else if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter'
      || e.key === ' ' || e.key === 'Enter') dir = 1;
    else return;
    e.preventDefault();
    if (!card.revealed) this._flip(card);                  // erst aufdecken ("hinten")
    else this._startFlyOut(card, dir, SWIPE_LAUNCH_SPEED);  // dann in Richtung wischen
  }

  /** linke Bildhälfte -> -1 (links), rechte -> +1 (rechts). */
  _sideFromX(clientX) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2 ? -1 : 1;
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

  /**
   * Karte rausfliegen lassen — geschwindigkeitsbasiert (Momentum), nicht als
   * Tween aus dem Stand. Übergang vom Finger-Folgen ist dadurch nahtlos.
   * @param {number} dir   -1 links, +1 rechts
   * @param {number} speed Startgeschwindigkeit in Weltunits/Sek
   */
  _startFlyOut(card, dir, speed) {
    if (!card || this._flying) return;
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
    this._flying = {
      card,
      vel: dir * Math.abs(speed),
      traveled: 0,
      target: this.cardHeight * SWIPE_OUT_DISTANCE,
      mats,
    };
  }

  _finishFlyOut() {
    const f = this._flying;
    this._flying = null;
    this.root.remove(f.card.holder);
    for (const m of f.mats) m.dispose();
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
    if (this._arrows) this._arrows.visible = ready;
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
    this._disposeArrows(); // Pfeil-Geometrie/-Material gehören nur den Pfeilen
    if (this.root) {
      this.scene.remove(this.root);
      // Karten-Geometrie + -Material sind mit dem Template geteilt -> NICHT disposen.
      this.root = null;
    }
    this.cards = [];
    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
    this._stackVel = 0;
    this._flying = null;
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
    this.cardAspect = s3.y > 0 ? s3.x / s3.y : 0.72; // Karten-Breite/Höhe (für responsive Kamera)

    tpl.updateMatrixWorld(true);
    if (backMesh && frontMesh) {
      const backZ = new THREE.Box3().setFromObject(backMesh).getCenter(new THREE.Vector3()).z;
      const frontZ = new THREE.Box3().setFromObject(frontMesh).getCenter(new THREE.Vector3()).z;
      if (backZ < frontZ) tpl.children.forEach((c) => c.geometry.rotateY(Math.PI));
    }
  }
}
