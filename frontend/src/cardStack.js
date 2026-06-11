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
    this.onSwipeReady = null; // (ready:boolean) => void: Pfeile/Tap-Zonen an/aus
    this._ready = false;
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
   * Karten-Material EINMAL vorab kompilieren (Shader-Programm), damit das erste
   * Rendern der 10 Karten beim Reveal nicht ruckelt. Am besten direkt nach
   * loadTemplate() beim Seitenstart aufrufen.
   */
  prewarm() {
    if (!this.template || !this.renderer) return;
    // 1) Texturen (Vorder-/Rückseite) explizit auf die GPU laden -> kein Upload-
    //    Ruckler beim ersten Anzeigen.
    this.template.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          if (m && m[key]) this.renderer.initTexture(m[key]);
        }
      }
    });
    // 2) Shader-Programm der (geteilten) Karten-Materialien einmal vorkompilieren.
    const warm = this.template.clone(true);
    this.scene.add(warm);
    this.renderer.compile(this.scene, this.camera);
    this.scene.remove(warm);
  }

  /**
   * Stapel bauen.
   * @param {Array} serverCards  vom Server gelieferte Karten
   * @param {string} mode  'vorne' | 'hinten'
   * @param {number} cardHeight  Zielhöhe in Weltunits
   */
  build(serverCards, mode, cardHeight, hidden = false) {
    this.dispose();
    this.mode = mode;
    this.cardHeight = cardHeight;
    this.template.scale.setScalar(this._baseScale * cardHeight);

    // Rückseite zeigt bei rotation.y = 0 zur Kamera. Im Modus 'vorne' die Karten
    // um 180° vordrehen -> Vorderseite sofort sichtbar, ohne Flip.
    const baseRotY = mode === 'vorne' ? Math.PI : 0;

    this.root = new THREE.Group();
    this.root.visible = !hidden; // versteckt vorbauen, später per show() einblenden
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
      // revealed: zeigt die Vorderseite? Im Modus 'vorne' sofort, sonst nach Flip.
      return { holder, baseRotY, revealed: mode === 'vorne', data: sc };
    });

    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
    this._ready = false;
  }

  /** Stapel einblenden und die vorderste Karte nach vorn holen (Reveal-Start). */
  begin() {
    if (this.root) this.root.visible = true;
    this._present(false); // erste Karte sofort an den Präsentations-Platz
  }

  update() {}

  /**
   * Tap auf die vorderste Karte. clientX entscheidet die Wisch-Richtung
   * (linke Hälfte -> links, rechte Hälfte -> rechts). Im Modus 'hinten' deckt
   * der erste Tap nur auf (Flip, bleibt liegen); erst der nächste Tap wischt.
   */
  handleTap(clientX) {
    if (this.busy || this.done) return;
    const card = this.cards[this.currentIndex];
    if (!card) return;

    // 'hinten' & noch nicht aufgedeckt -> FLIP (bleibt liegen), kein Wischen.
    if (!card.revealed) {
      this.busy = true;
      this._setReady(false);
      const start = card.holder.rotation.y;
      const end = start + Math.PI;
      this.tweens.add({
        duration: 0.45,
        ease: easeInOutCubic,
        onUpdate: (p) => { card.holder.rotation.y = start + (end - start) * p; },
        onComplete: () => {
          card.revealed = true;
          this.busy = false;
          this._setReady(true);
        },
      });
      return;
    }

    // bereits aufgedeckt -> nach links/rechts wegwischen.
    this._swipe(card, this._tapSide(clientX));
  }

  // --- intern: Reveal-Schritte -----------------------------------------------

  /** linke Bildhälfte -> -1 (links), rechte -> +1 (rechts). */
  _tapSide(clientX) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2 ? -1 : 1;
  }

  _present(animated) {
    const card = this.cards[this.currentIndex];
    if (!card) { this._setReady(false); return; }
    this.busy = true;
    this._setReady(false);
    this._restackBehind(); // dahinterliegende Karten an ihre Slots

    const from = card.holder.position.clone();
    const to = this._presentPos();
    const finish = () => {
      this.busy = false;
      this._setReady(card.revealed); // 'vorne' -> Pfeile sofort; 'hinten' erst nach Flip
    };
    if (animated) {
      this.tweens.add({
        duration: 0.3,
        ease: easeOutCubic,
        onUpdate: (p) => card.holder.position.lerpVectors(from, to, p),
        onComplete: finish,
      });
    } else {
      card.holder.position.copy(to);
      finish();
    }
  }

  _swipe(card, dir) {
    this.busy = true;
    this._setReady(false);
    // Materialien dieser EINEN Karte isolieren (klonen), nur sie blendet aus.
    const mats = [];
    card.holder.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        mats.push(o.material);
      }
    });
    const from = card.holder.position.clone();
    const toX = from.x + dir * this.cardHeight * CARD_SWIPE_DISTANCE;
    this.tweens.add({
      duration: CARD_SWIPE_DURATION,
      ease: easeOutCubic, // zügig an, sanft aus
      onUpdate: (p) => {
        card.holder.position.x = from.x + (toX - from.x) * p;
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
          this._present(true); // nächste Karte weich nach vorn (setzt busy intern)
        }
      },
    });
  }

  /** Dahinterliegende Karten an ihre Tiefen-Slots (relativ zur aktuellen). */
  _restackBehind() {
    for (let i = this.currentIndex + 1; i < this.cards.length; i++) {
      const holder = this.cards[i].holder;
      const from = holder.position.clone();
      const to = this._slotPosition(i - this.currentIndex);
      this.tweens.add({
        duration: 0.3,
        ease: easeOutCubic,
        onUpdate: (p) => holder.position.lerpVectors(from, to, p),
      });
    }
  }

  _presentPos() {
    return new THREE.Vector3(0, this.cardHeight * PRESENT_UP, this.cardHeight * PRESENT_FORWARD);
  }

  _setReady(ready) {
    if (ready === this._ready) return;
    this._ready = ready;
    if (this.onSwipeReady) this.onSwipeReady(ready);
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
