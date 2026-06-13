// Rendert mehrere rotierende Idle-Packs in EINEM WebGL-Kontext.
//
// Performance-Lösung (statt 1 Canvas/Kontext pro Pack): ein einziger Renderer mit
// einem fixen Vollbild-Canvas HINTER dem DOM. Pro Pack gibt es eine kleine eigene
// Szene+Kamera; im Loop wird jedes sichtbare Pack per Scissor/Viewport in das
// Rechteck seines DOM-"Stages" gerendert (three.js "multiple elements"-Muster).
// Der Canvas hat pointer-events:none, sodass Klicks an die DOM-Kacheln gehen.
// Off-screen Packs (Scrollen) werden übersprungen; der ganze Loop pausiert, wenn
// die Landing-Page nicht aktiv ist.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const loader = new GLTFLoader();

export class IdlePacks {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setScissorTest(true);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const c = this.renderer.domElement;
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:0;';
    document.body.appendChild(c);
    this.canvas = c;

    // Environment-Map einmal erzeugen und über alle Pack-Szenen teilen.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.items = [];           // { stageEl, scene, camera, mixer, model }
    this.active = false;
    this._raf = null;
    this._clock = new THREE.Clock();
    this._master = 0; // gemeinsame Master-Zeit für ALLE Idle-Mixer (Synchron-Takt)
    this._onResize = () => this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  /** Ein Pack (idle-GLB) an ein DOM-Stage-Element hängen. */
  async add(stageEl, glbUrl) {
    const scene = new THREE.Scene();
    scene.environment = this._env;
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2, 4, 3);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const item = { stageEl, scene, camera, mixer: null, model: null };
    this.items.push(item);

    const gltf = await loader.loadAsync(glbUrl);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = (maxDim / 2) / Math.tan((35 * Math.PI / 180) / 2) * 1.5;
    camera.position.set(0, 0, dist);
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    scene.add(model);
    item.model = model;

    // Idle-Animation abspielen (die GLB rotiert). Fallback: sanfte Y-Drehung.
    // Explizit LoopRepeat, damit setTime(masterTime) mit großer Zeit sauber umläuft.
    if (gltf.animations[0]) {
      item.mixer = new THREE.AnimationMixer(model);
      const action = item.mixer.clipAction(gltf.animations[0]);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
    }
    return item;
  }

  setActive(b) {
    this.active = b;
    this.canvas.style.display = b ? 'block' : 'none';
    if (b) {
      this._clock.getDelta(); // aufgelaufene Zeit verwerfen
      if (!this._raf) this._loop();
    }
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    if (!this.active) { this._raf = null; return; }
    // Master-Zeit (nur aktive Zeit) -> wird ALLEN Mixern zugewiesen, damit alle
    // Packs unabhängig von der Ladereihenfolge im selben Takt/Phasenstand drehen.
    this._master += this._clock.getDelta();
    const t = this._master;
    const r = this.renderer;
    const H = this.canvas.clientHeight;

    r.setScissorTest(false);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.setScissorTest(true);

    for (const it of this.items) {
      if (!it.model) continue;
      const rect = it.stageEl.getBoundingClientRect();
      // Nur sichtbare Kacheln rendern (Scroll-Performance).
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      // Absolute Master-Zeit setzen (statt pro Pack zu akkumulieren) -> Synchron-
      // Takt; ein gerade sichtbar werdendes Pack springt sofort auf die Phase.
      if (it.mixer) it.mixer.setTime(t);
      else it.model.rotation.y = t * 0.6;

      const w = rect.width;
      const h = rect.height;
      const left = rect.left;
      const bottom = H - rect.bottom; // WebGL-Ursprung unten-links
      r.setViewport(left, bottom, w, h);
      r.setScissor(left, bottom, w, h);
      it.camera.aspect = w / h;
      it.camera.updateProjectionMatrix();
      r.render(it.scene, it.camera);
    }
  }
}
