// Szene-Grundgerüst: Renderer, Kamera, Licht, Environment, OrbitControls,
// Resize-Handling und Render-Loop. Bewusst getrennt vom Pack-spezifischen Code,
// damit Phase 4b (Beam/Partikel/Reveal) einfach weitere onFrame-Hooks anhängen kann.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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

  // Environment-Map (RoomEnvironment) für realistische PBR-Reflexionen auf der
  // Pack-Textur — komplett prozedural, keine externe Datei nötig.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // --- Kamera ---
  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100,
  );
  camera.position.set(0, 0, 5);

  // --- Licht (zusätzlich zur Environment-Map, für klare Konturen) ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(2, 4, 3);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
  fillLight.position.set(-3, 1, -2);
  scene.add(fillLight);

  // --- Controls: Drehen (Pflicht) + Zoom (optional) ---
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;       // weiches Nachlaufen
  controls.dampingFactor = 0.08;
  controls.enablePan = false;          // kein Verschieben, hält das Pack zentriert
  controls.enableZoom = true;          // Zoom optional erlaubt
  controls.minDistance = 1.5;
  controls.maxDistance = 12;
  controls.rotateSpeed = 0.9;
  // Touch-Mapping fürs Handy: ein Finger dreht, zwei Finger zoomen (dolly).
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  // --- Resize ---
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  // --- Render-Loop mit registrierbaren Per-Frame-Callbacks ---
  const frameCallbacks = new Set();
  function onFrame(cb) {
    frameCallbacks.add(cb);
    return () => frameCallbacks.delete(cb);
  }

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    controls.update();
    frameCallbacks.forEach((cb) => cb(delta));
    renderer.render(scene, camera);
  }

  function start() {
    animate();
  }

  return { scene, camera, renderer, controls, onFrame, start };
}
