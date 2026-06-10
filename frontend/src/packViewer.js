// PackViewer: lädt ein Pack-GLB, zentriert + skaliert es auf eine feste Höhe
// (damit die feste Kamera für jedes Pack passt) und steckt es in einen Pivot-
// Holder, der IN PLACE um Y gedreht werden kann. Verwaltet die Aufreiß-Animation.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PACK_VIEW_HEIGHT } from './config.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export class PackViewer {
  constructor(scene) {
    this.scene = scene;
    this.holder = null;         // Pivot-Group (Rotations-Ziel, IN PLACE)
    this.model = null;
    this.mixer = null;
    this.action = null;
    this.isOpen = false;
    this._loadToken = 0;
    this._onFinishedCb = null;
    this.modelSize = new THREE.Vector3(1, PACK_VIEW_HEIGHT, 1);
  }

  /** Drehziel für den DragRotator (der Pivot-Holder). */
  getRotationTarget() {
    return this.holder;
  }

  update(delta) {
    if (this.mixer) this.mixer.update(delta);
  }

  getClipDuration() {
    return this.action ? this.action.getClip().duration : 0;
  }

  onFinished(cb) {
    this._onFinishedCb = cb;
  }

  setOpacity(opacity) {
    if (!this.holder) return;
    this.holder.traverse((node) => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat) continue;
        mat.transparent = true;
        mat.opacity = opacity;
        mat.depthWrite = opacity >= 0.99;
      }
    });
    this.holder.visible = opacity > 0.001;
  }

  async load(url) {
    const token = ++this._loadToken;
    this.dispose();

    const gltf = await gltfLoader.loadAsync(url);
    if (token !== this._loadToken) {
      this._disposeObject(gltf.scene);
      return;
    }

    this.model = gltf.scene;

    // Zentrieren + auf feste Höhe skalieren, alles in einem Pivot-Holder, damit
    // Drehen um Y das Pack IN PLACE rotiert (nicht um einen versetzten Punkt).
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.model.position.sub(center); // Mittelpunkt in den Holder-Ursprung

    const scale = PACK_VIEW_HEIGHT / size.y;
    this.holder = new THREE.Group();
    this.holder.add(this.model);
    this.holder.scale.setScalar(scale);
    this.scene.add(this.holder);
    this.modelSize = size.clone().multiplyScalar(scale); // .y == PACK_VIEW_HEIGHT

    // --- Animation (genau eine; immer animations[0]) ---
    const clip = gltf.animations[0];
    if (clip) {
      this.mixer = new THREE.AnimationMixer(this.model);
      this.action = this.mixer.clipAction(clip);
      this.action.setLoop(THREE.LoopOnce, 1);
      this.action.clampWhenFinished = true;
      this.action.play();
      this.action.paused = true;
      this.mixer.setTime(0); // Frame 0 = geschlossen
      this.mixer.addEventListener('finished', () => {
        if (this._onFinishedCb) this._onFinishedCb();
      });
    }
    this.isOpen = false;
  }

  playOpen() {
    if (!this.action || this.isOpen) return;
    this.isOpen = true;
    this.action.paused = false;
    this.action.reset();
    this.action.setLoop(THREE.LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.action.play();
    // Beam/Hide/Reveal orchestriert revealSequence.js (zeitgesteuert + onFinished).
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.action = null;
    if (this.holder) {
      this.scene.remove(this.holder);
      this._disposeObject(this.holder);
      this.holder = null;
    }
    this.model = null;
    this.isOpen = false;
  }

  _disposeObject(obj) {
    obj.traverse((node) => {
      if (node.isMesh) {
        node.geometry?.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const mat of materials) {
          if (!mat) continue;
          for (const key of Object.keys(mat)) {
            const value = mat[key];
            if (value && value.isTexture) value.dispose();
          }
          mat.dispose();
        }
      }
    });
  }
}
