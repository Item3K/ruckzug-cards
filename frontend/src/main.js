// RuckZUG Cards — Frontend-Einstieg.
// Phase 4a: Pack-GLB laden, drehbar (Maus + Touch), auf Knopfdruck einmal
// aufreißen. NOCH KEIN Beam/Partikel/Karten-Reveal (das ist Phase 4b).

import './style.css';
import { createScene } from './scene.js';
import { PackViewer } from './packViewer.js';
import { createUI } from './ui.js';

// Die 5 Packs (Dateien liegen in frontend/public/models/).
const PACKS = [
  { id: 'green',   label: 'Grün',      file: '/models/pack_green.glb' },
  { id: 'pink',    label: 'Pink',      file: '/models/pack_pink.glb' },
  { id: 'purple',  label: 'Lila',      file: '/models/pack_purple.glb' },
  { id: 'rainbow', label: 'Regenbogen', file: '/models/pack_rainbow.glb' },
  { id: 'red',     label: 'Rot',       file: '/models/pack_red.glb' },
];
const DEFAULT_PACK = PACKS[0]; // pack_green.glb

const app = document.querySelector('#app');

const { scene, camera, controls, onFrame, start } = createScene(app);
const viewer = new PackViewer(scene, camera, controls);
onFrame((delta) => viewer.update(delta));

const ui = createUI({
  packs: PACKS,
  initialId: DEFAULT_PACK.id,
  onSelectPack: (file, id) => loadPack(file, id),
  onOpen: () => viewer.playOpen(),
});

async function loadPack(file, id) {
  ui.setActivePack(id);
  ui.setOpenEnabled(false);
  ui.setStatus('Lädt …');
  try {
    await viewer.load(file);
    ui.setStatus('Öffnen');
    ui.setOpenEnabled(true);
  } catch (err) {
    console.error('Pack konnte nicht geladen werden:', err);
    ui.setStatus('Fehler');
  }
}

start();
loadPack(DEFAULT_PACK.file, DEFAULT_PACK.id);
