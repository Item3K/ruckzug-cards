// RuckZUG Cards — Frontend-Einstieg.
// Phase 4a: Pack laden, drehen, aufreißen.
// Phase 4b: feste Kamera + Objekte rotieren, Beam, Karten-Reveal (vorne/hinten).

import './style.css';
import { createScene } from './scene.js';
import { PackViewer } from './packViewer.js';
import { createUI } from './ui.js';
import { Beam } from './beam.js';
import { CardStack } from './cardStack.js';
import { RevealSequence } from './revealSequence.js';
import { TweenManager } from './tween.js';
import { DragRotator } from './dragRotator.js';

// Visuelle Packs (GLBs). backendPackId: welches Pack im Backend geöffnet wird
// (3a-Seed kennt nur pack_wald + pack_meer). TODO: echtes Mapping, wenn Sets final.
const PACKS = [
  { id: 'green',   label: 'Grün',       file: '/models/pack_green.glb',   backendPackId: 'pack_wald' },
  { id: 'pink',    label: 'Pink',       file: '/models/pack_pink.glb',    backendPackId: 'pack_wald' },
  { id: 'purple',  label: 'Lila',       file: '/models/pack_purple.glb',  backendPackId: 'pack_wald' },
  { id: 'rainbow', label: 'Regenbogen', file: '/models/pack_rainbow.glb', backendPackId: 'pack_meer' },
  { id: 'red',     label: 'Rot',        file: '/models/pack_red.glb',     backendPackId: 'pack_meer' },
];
const DEFAULT_PACK = PACKS[0];

const app = document.querySelector('#app');
const { scene, camera, renderer, onFrame, start } = createScene(app);

const tweens = new TweenManager();
const rotator = new DragRotator(renderer.domElement);
const viewer = new PackViewer(scene);
const beam = new Beam(scene, camera);
const cardStack = new CardStack(scene, camera, renderer, tweens);

onFrame((delta) => {
  viewer.update(delta);
  tweens.update(delta);
  beam.update(delta);
  cardStack.update(delta);
  rotator.update(delta);
});

let currentPack = DEFAULT_PACK;

const ui = createUI({
  packs: PACKS,
  initialId: DEFAULT_PACK.id,
  onSelectPack: (id) => loadPack(PACKS.find((p) => p.id === id) || DEFAULT_PACK),
  onOpen: () => reveal.start(currentPack.backendPackId),
  onBack: () => backToSelection(),
});

const reveal = new RevealSequence({
  viewer, beam, cardStack, rotator, tweens, ui,
  // Bei Fehler (z.B. keine Sanduhren): Pack frisch laden (es wurde parallel zur
  // Animation schon angerissen) und danach den Fehler sichtbar anzeigen.
  onAbort: async (msg) => {
    await loadPack(currentPack);
    ui.setStatus(msg);
  },
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
    // Pack frei um Y drehbar (360°, keine Feder) — bis "Öffnen".
    rotator.attach(viewer.getRotationTarget());
    ui.setStatus('');
    ui.setOpenEnabled(true);
  } catch (err) {
    console.error('Pack konnte nicht geladen werden:', err);
    ui.setStatus('Fehler beim Laden');
  }
}

function backToSelection() {
  reveal.reset();
  loadPack(currentPack); // frisches Pack (Frame 0) + Pack-Rotation wieder aktiv
}

async function init() {
  start();
  await cardStack.loadTemplate(); // filet.glb einmalig vorladen (alle Karten teilen es)
  cardStack.prewarm();            // Karten-Material vorab kompilieren (kein Reveal-Ruckler)
  await loadPack(DEFAULT_PACK);
}

init();
