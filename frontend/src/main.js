// RuckZUG Cards — Frontend-Einstieg.
// Phase 4: Pack laden/drehen/öffnen, Beam, Karten-Reveal.
// Phase 5a: Packs/Karten kommen aus der modularen Set-Struktur (setLoader),
//           nicht mehr aus fest verdrahteten Pfaden.

import './style.css';
import { createScene } from './scene.js';
import { PackViewer } from './packViewer.js';
import { createUI } from './ui.js';
import { Beam } from './beam.js';
import { CardStack } from './cardStack.js';
import { RevealSequence } from './revealSequence.js';
import { TweenManager } from './tween.js';
import { DragRotator } from './dragRotator.js';
import { loadSet } from './setLoader.js';

// Welches Set beim Start geladen wird (später: Auswahl/Discovery über index.json).
const DEFAULT_SET_ID = 'set_ruckzug1';

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

let currentSet = null;
let packs = [];          // aus dem geladenen Set (siehe init)
let currentPack = null;
let ui = null;
let reveal = null;

async function loadPack(pack) {
  currentPack = pack;
  ui.setActivePack(pack.id);
  ui.setMode('select');
  ui.setOpenEnabled(false);
  ui.setStatus('Lädt …');
  ui.setHint('');
  try {
    await viewer.load(pack.file); // pack.file = rip-GLB aus der Set-Struktur
    rotator.attach(viewer.getRotationTarget()); // Pack frei um Y drehbar bis "Öffnen"
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
  await cardStack.loadTemplate(); // Karten-Rohling (filet.glb) einmalig vorladen
  cardStack.prewarm();            // Karten-Material vorab kompilieren (kein Reveal-Ruckler)

  // --- Set aus der modularen Struktur laden ---
  currentSet = await loadSet(DEFAULT_SET_ID);
  // Pack-Liste fürs Frontend aus dem Set ableiten (rip-GLB als anzuzeigendes Modell).
  packs = currentSet.packs.map((p) => ({
    id: p.id, label: p.label, file: p.ripUrl, backendPackId: p.backendPackId,
  }));
  console.info(`[Set] "${currentSet.name}" geladen: ${packs.length} Packs, ${currentSet.cards.length} Karten-Defs.`);

  // UI + Reveal mit den Set-Packs aufbauen.
  ui = createUI({
    packs,
    initialId: packs[0].id,
    onSelectPack: (id) => loadPack(packs.find((p) => p.id === id) || packs[0]),
    onOpen: () => reveal.start(currentPack.backendPackId),
    onBack: () => backToSelection(),
  });
  reveal = new RevealSequence({
    viewer, beam, cardStack, rotator, tweens, ui,
    // Bei Fehler (z.B. keine Sanduhren): Pack frisch laden + Fehler sichtbar zeigen.
    onAbort: async (msg) => { await loadPack(currentPack); ui.setStatus(msg); },
  });

  await loadPack(packs[0]);
}

// DEV-ONLY: Live-Tuning-Panel (lil-gui). Dynamischer Import -> faellt im Live-Build
// (import.meta.env.DEV === false) per Dead-Code-Elimination komplett raus.
init().then(() => {
  if (import.meta.env.DEV) {
    import('./tuningPanel.js').then(({ createTuningPanel }) => {
      createTuningPanel({ camera, cardStack, reloadPack: () => loadPack(currentPack) });
    });
  }
});
