// Szene-Grundgerüst: Renderer, FESTE Kamera (frontal, kein Zoom), Licht,
// Environment, Resize, Render-Loop. KEINE OrbitControls mehr — gedreht werden
// die Objekte (siehe dragRotator.js), nicht die Kamera.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMERA_FOV, CAMERA_DISTANCE } from './config.js';
import { aspectFitFactor } from './responsive.js';

// Etwas Luft, damit das Objekt im Hochformat nicht exakt randvoll sitzt.
const FRAMING_MARGIN = 1.1;

const BG_COLOR = 0x0b0d12;

export function createScene(container) {
  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // --- Szene ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // --- Kamera: fest, blickt frontal auf den Ursprung. Bewegt sich nie. ---
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    container.clientWidth / container.clientHeight,
    0.1,
    100,
  );
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  // --- Licht ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
  fillLight.position.set(-3, 1, -2);
  scene.add(fillLight);

  // --- Zoom sperren (Konzept: fester Kamera-Abstand) ---
  // Strg+Mausrad löst sonst BROWSER-Zoom aus (skaliert das DOM, verschiebt Overlays).
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  // --- Responsive Einpassung: Kamera-Distanz ans Seitenverhältnis anpassen ---
  // contentAspect > 0 aktiviert das Anpassen (vom Einzel-Opening gesetzt: Pack/Karte).
  // 0 = aus (z.B. im x10-Modus, der die Kamera selbst steuert) -> Distanz unberührt.
  let framingAspect = 0;
  function applyFraming() {
    if (framingAspect > 0) {
      camera.position.z = CAMERA_DISTANCE * aspectFitFactor(camera.aspect, framingAspect, FRAMING_MARGIN);
    }
  }

  // --- Resize (Kamera-Distanz responsiv, Aspect/Renderer) ---
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    applyFraming(); // bei Drehen/Resize live nachjustieren
  }
  window.addEventListener('resize', onResize);

  // --- Render-Loop mit registrierbaren Per-Frame-Callbacks ---
  const frameCallbacks = new Set();
  function onFrame(cb) {
    frameCallbacks.add(cb);
    return () => frameCallbacks.delete(cb);
  }

  const clock = new THREE.Clock();
  let active = true;
  function animate() {
    requestAnimationFrame(animate);
    if (!active) return;          // pausiert (z.B. während die Landing-Page aktiv ist)
    const delta = clock.getDelta();
    frameCallbacks.forEach((cb) => cb(delta));
    renderer.render(scene, camera);
  }
  function start() {
    animate();
  }

  // Opening-View pausieren/fortsetzen + Canvas ein-/ausblenden.
  function setActive(b) {
    active = b;
    renderer.domElement.style.display = b ? 'block' : 'none';
    if (b) clock.getDelta(); // aufgelaufene Zeit verwerfen -> kein Sprung
  }

  /**
   * Responsive Kamera-Einpassung setzen. contentAspect = Objekt-Breite/Höhe (Pack/Karte).
   * 0 schaltet das Anpassen ab (Distanz wird dann nicht mehr automatisch verändert —
   * z.B. im x10-Modus, der die Kamera selbst kontrolliert).
   */
  function setFraming(contentAspect) {
    framingAspect = contentAspect > 0 ? contentAspect : 0;
    applyFraming();
  }

  return { scene, camera, renderer, onFrame, start, setActive, setFraming };
}
