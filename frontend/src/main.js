// RuckZUG Cards — Frontend-Einstieg.
// Phase 4a: Pack laden, drehen, aufreißen.
// Phase 4b: Beam + Karten-Reveal (Stapel, durchklicken) — Daten vom Server.

import './style.css';
import { createScene } from './scene.js';
import { PackViewer } from './packViewer.js';
import { createUI } from './ui.js';
import { Beam } from './beam.js';
import { CardStack } from './cardStack.js';
import { RevealSequence } from './revealSequence.js';
import { TweenManager } from './tween.js';

// Die 5 visuellen Packs (GLBs in frontend/public/models/).
// backendPackId: welches Pack im Backend geöffnet wird (Phase 3a-Seed kennt nur
// pack_wald + pack_meer). TODO: echtes Mapping visuelles Pack <-> Set/Pack im
// Backend, sobald die Sets/Packs final sind.
const PACKS = [
  { id: 'green',   label: 'Grün',       file: '/models/pack_green.glb',   backendPackId: 'pack_wald' },
  { id: 'pink',    label: 'Pink',       file: '/models/pack_pink.glb',    backendPackId: 'pack_wald' },
  { id: 'purple',  label: 'Lila',       file: '/models/pack_purple.glb',  backendPackId: 'pack_wald' },
  { id: 'rainbow', label: 'Regenbogen', file: '/models/pack_rainbow.glb', backendPackId: 'pack_meer' },
  { id: 'red',     label: 'Rot',        file: '/models/pack_red.glb',     backendPackId: 'pack_meer' },
];
const DEFAULT_PACK = PACKS[0];

const app = document.querySelector('#app');

const { scene, camera, controls, renderer, onFrame, start } = createScene(app);

const tweens = new TweenManager();
const viewer = new PackViewer(scene, camera, controls);
const beam = new Beam(scene, camera);
const cardStack = new CardStack(scene, camera, renderer.domElement, tweens);

// Ein Render-Loop treibt alles an.
onFrame((delta) => {
  viewer.update(delta);
  tweens.update(delta);
  beam.update(delta);
  cardStack.update(delta);
});

let currentPack = DEFAULT_PACK;

const ui = createUI({
  packs: PACKS,
  initialId: DEFAULT_PACK.id,
  onSelectPack: (id) => {
    const pack = PACKS.find((p) => p.id === id) || DEFAULT_PACK;
    loadPack(pack);
  },
  onOpen: () => reveal.start(currentPack.backendPackId),
  onBack: () => backToSelection(),
});

const reveal = new RevealSequence({
  camera,
  controls,
  viewer,
  beam,
  cardStack,
  tweens,
  ui,
});

async function loadPack(pack) {
  currentPack = pack;
  ui.setActivePack(pack.id);
  ui.setMode('select');
  ui.setOpenEnabled(false);
  ui.setStatus('Lädt …');
  ui.setHint('');
  try {
    await viewer.load(pack.file);
    ui.setStatus('');
    ui.setOpenEnabled(true);
  } catch (err) {
    console.error('Pack konnte nicht geladen werden:', err);
    ui.setStatus('Fehler beim Laden');
  }
}

function backToSelection() {
  reveal.reset();
  loadPack(currentPack); // frisches Pack (setzt Animation auf Frame 0 zurück)
}

async function init() {
  start();
  await cardStack.loadTemplate(); // Karten-Template (filet.glb) einmalig vorladen
  await loadPack(DEFAULT_PACK);
}

init();
