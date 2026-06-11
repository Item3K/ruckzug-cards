// Karten-Stapel + Reveal (Phase 4b, überarbeitet).
//
// - filet.glb wird EINMAL geladen + normalisiert; alle 10 Karten teilen sich
//   Geometrie UND Material (klonen nur den Szenengraph-Knoten -> günstig, kein
//   10× Laden/Dekodieren).
// - Stapel fast deckungsgleich, nur minimaler Tiefen-Versatz (CARD_STACK_DEPTH).
//   Die Ränder dahinter sieht man erst beim seitlichen Drehen des Stapels.
// - Reveal hängt vom Öffnungs-Modus ab:
//     'vorne'  -> Karten zeigen sofort die Vorderseite, KEIN Flip.
//     'hinten' -> Karten zeigen die Rückseite; beim Vorrücken wird die vorderste
//                 Karte UMGEDREHT, WÄHREND sie nach vorne kommt (vor dem Stapel).
// - Drehen/Tap steuert der DragRotator von außen; advance() deckt auf.
//
// filet.glb: Material.001 = Rückseite, Material.002 = Vorderseite.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { easeInOutCubic, easeOutCubic } from './tween.js';
import {
  CARD_STACK_DEPTH,
  PRESENT_FORWARD,
  PRESENT_UP,
  CARD_SWIPE_DISTANCE,
  CARD_SWIPE_DURATION,
} from './config.js';

const BACK_MATERIAL = 'Material.001';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export class CardStack {
  constructor(scene, camera, tweens) {
    this.scene = scene;
    this.camera = camera;
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
  }

  /** Drehziel für den DragRotator. */
  getRotationTarget() {
    return this.root;
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
   * Stapel bauen.
   * @param {Array} serverCards  vom Server gelieferte Karten
   * @param {string} mode  'vorne' | 'hinten'
   * @param {number} cardHeight  Zielhöhe in Weltunits
   */
  build(serverCards, mode, cardHeight) {
    this.dispose();
    this.mode = mode;
    this.cardHeight = cardHeight;
    this.template.scale.setScalar(this._baseScale * cardHeight);

    // Rückseite zeigt bei rotation.y = 0 zur Kamera. Im Modus 'vorne' die Karten
    // um 180° vordrehen -> Vorderseite sofort sichtbar, ohne Flip.
    const baseRotY = mode === 'vorne' ? Math.PI : 0;

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.cards = serverCards.map((sc, i) => {
      const holder = new THREE.Group();
      // Szenengraph klonen -> teilt Geometrie + Material mit dem Template.
      // TODO(echte Assets): für individuelle Vorderseiten pro Karte das
      // Front-Material klonen und frontMesh.material.map = sc.asset-Textur setzen.
      const card = this.template.clone(true);
      holder.add(card);
      holder.rotation.y = baseRotY;
      holder.position.copy(this._slotPosition(i));
      this.root.add(holder);
      return { holder, baseRotY, data: sc };
    });

    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
  }

  update() {}

  /** Deckt die vorderste Karte auf (vom DragRotator-Tap aufgerufen). */
  advance() {
    if (this.busy || this.done) return;
    const card = this.cards[this.currentIndex];
    if (!card) return;
    this.busy = true;

    const fromPos = card.holder.position.clone();
    const presentPos = new THREE.Vector3(
      0,
      this.cardHeight * PRESENT_UP,
      this.cardHeight * PRESENT_FORWARD, // Richtung Kamera, VOR den Stapel
    );
    const startRotY = card.holder.rotation.y;
    // Im Modus 'hinten' während des Vorholens umdrehen; 'vorne' bleibt wie es ist.
    const endRotY = this.mode === 'hinten' ? startRotY + Math.PI : startRotY;

    // Phase A: nach vorn holen (+ ggf. flippen).
    this.tweens.add({
      duration: 0.5,
      ease: easeInOutCubic,
      onUpdate: (p) => {
        card.holder.position.lerpVectors(fromPos, presentPos, p);
        card.holder.rotation.y = startRotY + (endRotY - startRotY) * p;
      },
      onComplete: () => {
        // Phase B: kurz präsentieren.
        this.tweens.add({
          duration: 0.4,
          onUpdate: () => {},
          onComplete: () => this._discard(card, presentPos),
        });
      },
    });
  }

  _discard(card, fromPos) {
    // Materialien dieser EINEN Karte isolieren (klonen), damit nur sie ausblendet
    // (alle übrigen teilen sich weiter das Template-Material).
    const mats = [];
    card.holder.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        mats.push(o.material);
      }
    });

    // Phase C: zur SEITE wegswipen (TCG-Pocket-Stil) + sanft ausblenden.
    const swipeX = fromPos.x + this.cardHeight * CARD_SWIPE_DISTANCE;
    this.tweens.add({
      duration: CARD_SWIPE_DURATION,
      ease: easeInOutCubic,
      onUpdate: (p) => {
        card.holder.position.set(
          fromPos.x + (swipeX - fromPos.x) * p,
          fromPos.y,
          fromPos.z,
        );
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
          if (this.onDone) this.onDone();
        } else {
          this.busy = false;
        }
      },
    });

    // Parallel: nächste Karten weich nachrücken, WÄHREND diese wegswipet.
    this._restackForward(this.currentIndex + 1);
  }

  /** Karten ab fromIndex an die Slots 0,1,2… nachrücken lassen. */
  _restackForward(fromIndex) {
    for (let i = fromIndex; i < this.cards.length; i++) {
      const holder = this.cards[i].holder;
      const from = holder.position.clone();
      const to = this._slotPosition(i - fromIndex);
      this.tweens.add({
        duration: CARD_SWIPE_DURATION,
        ease: easeOutCubic,
        onUpdate: (p) => holder.position.lerpVectors(from, to, p),
      });
    }
  }

  dispose() {
    if (this.root) {
      this.scene.remove(this.root);
      // Geometrie + Material sind mit dem Template geteilt -> NICHT disposen.
      this.root = null;
    }
    this.cards = [];
    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
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
