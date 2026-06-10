// Karten-Stapel + Reveal (Phase 4b).
//
// - Lädt filet.glb EINMAL und baut daraus ein normalisiertes Karten-Template
//   (zentriert, steht senkrecht, Rückseite zur Kamera, auf Zielhöhe skaliert).
// - build(serverCards) erzeugt N Karten als räumlich gestaffelten Stapel
//   (TCG-Pocket-Stil, KEINE Transparenz — nur Versatz in x/y/z).
// - Stapel leicht drehbar (Drag/Touch), Tap deckt die vorderste Karte auf:
//   Flip Rück->Vorder, kurz zeigen, wegschieben, nächste rückt vor.
//
// filet.glb: mesh "Plane" mit 2 Primitives -> Material.001 = Rückseite
// (RuckZUG_card_back), Material.002 = Vorderseite (RuckZUG_card_front_01).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { easeInOutCubic, easeOutCubic } from './tween.js';

const BACK_MATERIAL = 'Material.001';  // Rückseite (grüner RuckZUG-Rücken)

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export class CardStack {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement  Renderer-Canvas (für Drag/Tap)
   * @param {import('./tween.js').TweenManager} tweens
   */
  constructor(scene, camera, domElement, tweens) {
    this.scene = scene;
    this.camera = camera;
    this.dom = domElement;
    this.tweens = tweens;

    this.template = null;       // normalisiertes Karten-Template (Group)
    this.root = null;           // Stapel-Wurzel (dreht beim Drag)
    this.cards = [];            // [{ holder, frontMesh, backMesh, flipped }]
    this.currentIndex = 0;
    this.cardHeight = 1;
    this.busy = false;
    this.done = false;
    this.onDone = null;
    this.onProgress = null;     // (revealed, total) => void

    this._inputActive = false;
    this._drag = null;
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  /** filet.glb laden und Template aufbauen (einmalig, danach gecached). */
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
      geo.applyMatrix4(o.matrixWorld); // Node-Transform in die Geometrie backen
      const mesh = new THREE.Mesh(geo, o.material.clone());
      mesh.material.side = THREE.FrontSide;
      if (o.material.name === BACK_MATERIAL) backMesh = mesh;
      else frontMesh = mesh;
      tpl.add(mesh);
    });

    this._normalizeTemplate(tpl, backMesh, frontMesh);
    this.template = tpl;
    this._tplFrontName = frontMesh ? frontMesh.material.name : null;
  }

  /**
   * Stapel aus den vom Server gelieferten Karten bauen. Alle zeigen die Rückseite.
   * @param {Array<{card_id:string,name:string,rarity:string,asset:string}>} serverCards
   * @param {number} cardHeight  Zielhöhe einer Karte in Weltunits
   */
  build(serverCards, cardHeight) {
    this.dispose();
    this.cardHeight = cardHeight;
    this.template.scale.setScalar(this._baseScale * cardHeight);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.cards = serverCards.map((sc, i) => {
      const holder = new THREE.Group();
      const card = this.template.clone(true);
      // Materialien je Karte klonen, damit Fade/Texturtausch nur diese Karte trifft.
      let frontMesh = null;
      let backMesh = null;
      card.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        if (o.material.name === BACK_MATERIAL) backMesh = o;
        else frontMesh = o;
      });

      // TODO(echte Assets): Vorderseiten-Textur pro Karte aus sc.asset laden und
      // frontMesh.material.map ersetzen (+ needsUpdate). Rückseite bleibt immer
      // gleich. Bis dahin dient filet.glb als Platzhalter für ALLE Karten.
      // z.B.: loadTexture(sc.asset).then(t => { frontMesh.material.map = t; ... })

      holder.add(card);
      holder.position.copy(this._slotPosition(i));
      this.root.add(holder);
      return { holder, frontMesh, backMesh, flipped: false, data: sc };
    });

    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
  }

  /** Pro Frame aufgerufen (nur fürs evtl. Federn — Tweens laufen zentral). */
  update() {}

  /** Drag-Drehen + Tap-Aufdecken aktivieren. */
  enableInput() {
    if (this._inputActive) return;
    this._inputActive = true;
    this.dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  disableInput() {
    if (!this._inputActive) return;
    this._inputActive = false;
    this.dom.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this._drag = null;
  }

  dispose() {
    this.disableInput();
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => {
        if (o.isMesh) {
          // Geometrie ist mit dem Template geteilt -> nicht hier disposen.
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m && m.dispose());
        }
      });
      this.root = null;
    }
    this.cards = [];
    this.currentIndex = 0;
    this.busy = false;
    this.done = false;
  }

  // --- Reveal-Ablauf ---------------------------------------------------------

  /** Deckt die vorderste Karte auf: Flip -> zeigen -> wegschieben -> nächste vor. */
  advance() {
    if (this.busy || this.done) return;
    const card = this.cards[this.currentIndex];
    if (!card) return;
    this.busy = true;

    const startRotY = card.holder.rotation.y;
    // 1) Flip Rück -> Vorder (180° um die Hochachse)
    this.tweens.add({
      duration: 0.45,
      ease: easeInOutCubic,
      onUpdate: (p) => {
        card.holder.rotation.y = startRotY + Math.PI * p;
      },
      onComplete: () => {
        card.flipped = true;
        // 2) kurz präsentieren, dann wegschieben
        this.tweens.add({
          duration: 0.45,
          onUpdate: () => {},
          onComplete: () => this._slideAway(card),
        });
      },
    });
  }

  _slideAway(card) {
    const startPos = card.holder.position.clone();
    const startScale = card.holder.scale.x || 1;
    // Materialien für den Ausblend-Effekt transparent schalten.
    card.holder.traverse((o) => {
      if (o.isMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m) m.transparent = true; });
      }
    });

    this.tweens.add({
      duration: 0.5,
      ease: easeOutCubic,
      onUpdate: (p) => {
        card.holder.position.set(
          startPos.x,
          startPos.y + this.cardHeight * 1.3 * p,  // nach oben weg
          startPos.z + this.cardHeight * 0.8 * p,  // zur Kamera
        );
        card.holder.scale.setScalar(startScale * (1 + 0.3 * p));
        card.holder.traverse((o) => {
          if (o.isMesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => { if (m) m.opacity = 1 - p; });
          }
        });
      },
      onComplete: () => {
        this.root.remove(card.holder);
        this.currentIndex += 1;
        if (this.onProgress) this.onProgress(this.currentIndex, this.cards.length);
        if (this.currentIndex >= this.cards.length) {
          this.busy = false;
          this.done = true;
          this.disableInput();
          if (this.onDone) this.onDone();
        } else {
          this._restack();
          this.busy = false;
        }
      },
    });
  }

  /** Verbleibende Karten an die neuen Slot-Positionen nachrücken lassen. */
  _restack() {
    for (let i = this.currentIndex; i < this.cards.length; i++) {
      const holder = this.cards[i].holder;
      const from = holder.position.clone();
      const to = this._slotPosition(i - this.currentIndex);
      this.tweens.add({
        duration: 0.35,
        ease: easeOutCubic,
        onUpdate: (p) => {
          holder.position.lerpVectors(from, to, p);
        },
      });
    }
  }

  // --- intern ----------------------------------------------------------------

  /** Slot-Position für die d-te Karte von vorn (d=0 = vorderste). */
  _slotPosition(d) {
    const h = this.cardHeight;
    return new THREE.Vector3(d * 0.035 * h, d * 0.04 * h, -d * 0.025 * h);
  }

  /** Template zentrieren, dünnste Achse -> Z, Hochformat, Rückseite -> +Z, skalieren. */
  _normalizeTemplate(tpl, backMesh, frontMesh) {
    const v = new THREE.Vector3();

    // 1) zentrieren
    let box = new THREE.Box3().setFromObject(tpl);
    const center = box.getCenter(v).clone();
    tpl.children.forEach((c) => c.geometry.translate(-center.x, -center.y, -center.z));

    // 2) dünnste Achse (Kartendicke) auf Z drehen
    box = new THREE.Box3().setFromObject(tpl);
    const size = box.getSize(v).clone();
    const thin = size.x <= size.y && size.x <= size.z ? 'x'
      : size.y <= size.x && size.y <= size.z ? 'y' : 'z';
    if (thin === 'x') tpl.children.forEach((c) => c.geometry.rotateY(Math.PI / 2));
    else if (thin === 'y') tpl.children.forEach((c) => c.geometry.rotateX(Math.PI / 2));

    // 3) Hochformat: falls breiter als hoch, um 90° in der Ebene drehen
    box = new THREE.Box3().setFromObject(tpl);
    const s2 = box.getSize(v).clone();
    if (s2.x > s2.y) tpl.children.forEach((c) => c.geometry.rotateZ(Math.PI / 2));

    // 4) Basis-Skalierung merken (auf Höhe 1 normiert); finale Höhe in build()
    box = new THREE.Box3().setFromObject(tpl);
    const s3 = box.getSize(v).clone();
    this._baseScale = 1 / Math.max(s3.x, s3.y);

    // 5) Rückseite muss zur Kamera (+Z) zeigen
    tpl.updateMatrixWorld(true);
    if (backMesh && frontMesh) {
      const backZ = new THREE.Box3().setFromObject(backMesh).getCenter(new THREE.Vector3()).z;
      const frontZ = new THREE.Box3().setFromObject(frontMesh).getCenter(new THREE.Vector3()).z;
      if (backZ < frontZ) tpl.children.forEach((c) => c.geometry.rotateY(Math.PI));
    }
  }

  // --- Pointer (Drag-Drehen vs. Tap-Aufdecken) -------------------------------

  _onPointerDown(e) {
    this._drag = { x: e.clientX, y: e.clientY, moved: 0, baseY: this.root.rotation.y, baseX: this.root.rotation.x };
  }

  _onPointerMove(e) {
    if (!this._drag || !this.root) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    this._drag.moved = Math.max(this._drag.moved, Math.hypot(dx, dy));
    // Stapel leicht drehen (geklemmt), damit man die Kanten sieht.
    this.root.rotation.y = THREE.MathUtils.clamp(this._drag.baseY + dx * 0.005, -0.5, 0.5);
    this.root.rotation.x = THREE.MathUtils.clamp(this._drag.baseX + dy * 0.003, -0.3, 0.3);
  }

  _onPointerUp() {
    if (!this._drag) return;
    const wasTap = this._drag.moved < 8; // wenig Bewegung = Tap
    this._drag = null;
    if (wasTap) this.advance();
  }
}
