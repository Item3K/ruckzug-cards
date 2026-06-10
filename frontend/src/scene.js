// Szene-Grundgerüst: Renderer, FESTE Kamera (frontal, kein Zoom), Licht,
// Environment, Resize, Render-Loop. KEINE OrbitControls mehr — gedreht werden
// die Objekte (siehe dragRotator.js), nicht die Kamera.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMERA_FOV, CAMERA_DISTANCE } from './config.js';

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

  // --- Resize (Kamera-Position bleibt, nur Aspect/Renderer) ---
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
    frameCallbacks.forEach((cb) => cb(delta));
    renderer.render(scene, camera);
  }
  function start() {
    animate();
  }

  return { scene, camera, renderer, onFrame, start };
}
