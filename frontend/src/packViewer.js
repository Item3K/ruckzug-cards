// PackViewer: lädt ein Pack-GLB, zentriert/rahmt es, verwaltet die Aufreiß-
// Animation über einen AnimationMixer und räumt beim Pack-Wechsel sauber auf.
//
// Erweiterbar für Phase 4b: playOpen() ist die EINE Stelle, an die später
// Beam/Partikel/Sound/Reveal andocken (z.B. über die mixer-'finished'-Events
// oder zeitgesteuert relativ zum Animations-Start).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Draco-Decoder lokal gehostet (public/draco/) — läuft so auch offline / auf dem Pi.
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export class PackViewer {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {OrbitControls} controls
   */
  constructor(scene, camera, controls) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;

    this.model = null;
    this.mixer = null;
    this.action = null;
    this.isOpen = false;        // wurde die Aufreiß-Animation schon abgespielt?
    this._loadToken = 0;        // gegen Race-Conditions bei schnellem Pack-Wechsel
  }

  /** Vom Render-Loop pro Frame aufgerufen. */
  update(delta) {
    if (this.mixer) this.mixer.update(delta);
  }

  /**
   * Lädt ein Pack-GLB (Pfad relativ zu /public). Entlädt vorher das alte Modell.
   * Setzt die Animation auf Frame 0 (geschlossenes Pack) — startet NICHT automatisch.
   * @param {string} url z.B. '/models/pack_green.glb'
   */
  async load(url) {
    const token = ++this._loadToken;
    this.dispose();

    const gltf = await gltfLoader.loadAsync(url);
    // Falls zwischenzeitlich ein anderer Pack angefordert wurde: dieses Ergebnis verwerfen.
    if (token !== this._loadToken) {
      this._disposeObject(gltf.scene);
      return;
    }

    this.model = gltf.scene;
    this.scene.add(this.model);
    this._centerAndFrame(this.model);

    // --- Animation vorbereiten ---
    // Pro Datei genau EINE Animation; immer über Index 0 ansprechen (nie über den Namen).
    const clip = gltf.animations[0];
    if (clip) {
      this.mixer = new THREE.AnimationMixer(this.model);
      this.action = this.mixer.clipAction(clip);
      this.action.setLoop(THREE.LoopOnce, 1); // einmal abspielen
      this.action.clampWhenFinished = true;   // am letzten Frame stehen bleiben
      // Frame 0 anzeigen, aber pausiert lassen -> Pack bleibt geschlossen.
      this.action.play();
      this.action.paused = true;
      this.mixer.setTime(0);
    }
    this.isOpen = false;
  }

  /** Spielt die Aufreiß-Animation EINMAL ab. No-op, wenn schon geöffnet. */
  playOpen() {
    if (!this.action || this.isOpen) return;
    this.isOpen = true;
    this.action.paused = false;
    this.action.reset();
    this.action.setLoop(THREE.LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.action.play();
    // TODO(Phase 4b): hier Beam/Partikel/Sound/Reveal triggern — entweder relativ
    // zum Start zeitgesteuert oder über mixer.addEventListener('finished', ...).
  }

  /** Entfernt aktuelles Modell aus der Szene und gibt GPU-Ressourcen frei. */
  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.action = null;
    if (this.model) {
      this.scene.remove(this.model);
      this._disposeObject(this.model);
      this.model = null;
    }
    this.isOpen = false;
  }

  // --- intern ---------------------------------------------------------------

  /** Modell auf den Ursprung zentrieren und Kamera/Controls passend ausrichten. */
  _centerAndFrame(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Zentrieren: Pack-Mittelpunkt in den Ursprung schieben.
    model.position.sub(center);

    // Kamera-Abstand so wählen, dass das Pack komfortabel ins Bild passt.
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (this.camera.fov * Math.PI) / 180;
    let dist = (maxDim / 2) / Math.tan(fov / 2);
    dist *= 1.6; // etwas Luft drumherum

    this.camera.position.set(0, 0, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();

    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = dist * 0.4;
    this.controls.maxDistance = dist * 3;
    this.controls.update();
  }

  /** Geometrien, Materialien und Texturen eines Objektbaums freigeben. */
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
