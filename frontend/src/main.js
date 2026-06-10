// RuckZUG Cards — Frontend-Einstieg (Phase 0)
// Ziel dieser Phase: NUR eine leere 3D-Szene rendern. Noch keine Pack-Logik,
// kein GLB-Loader, keine Spiel-Mechanik (siehe ROADMAP §8, Phase 0 "Tabu").

import * as THREE from 'three';
import './style.css';

const app = document.querySelector('#app');

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

// --- Szene & Kamera ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 0, 5);

// --- Licht (damit man später überhaupt etwas sieht) ---
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(2, 3, 4);
scene.add(dir);

// Hilfs-Gitter, damit die "leere" Szene sichtbar nicht leer wirkt.
// Platzhalter — fliegt raus, sobald in Phase 4 das echte Pack geladen wird.
const grid = new THREE.GridHelper(10, 10, 0x334155, 0x1e293b);
scene.add(grid);

// --- Resize-Handling ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Render-Loop ---
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

// eslint-disable-next-line no-console
console.log('RuckZUG Cards Frontend — leere Three.js-Szene läuft (Phase 0).');
