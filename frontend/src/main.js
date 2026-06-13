// RuckZUG Cards — Frontend-Einstieg.
// Phase 6: Zwei Views — Landing-Page (Pack-Auswahl) und Opening (3D-Flow aus 4/5).
// Klick auf ein Pack -> Opening; "Zurück zur Auswahl" -> Landing.

import './style.css';
import { createScene } from './scene.js';
import { PackViewer } from './packViewer.js';
import { createUI } from './ui.js';
import { Beam } from './beam.js';
import { CardStack } from './cardStack.js';
import { RevealSequence } from './revealSequence.js';
import { TweenManager } from './tween.js';
import { DragRotator } from './dragRotator.js';
import { Landing } from './landingView.js';
import { applyLandingVars } from './landingConfig.js';

applyLandingVars();

const app = document.querySelector('#app');
const opening = createScene(app); // { scene, camera, renderer, onFrame, start, setActive }
const { scene, camera, renderer, onFrame, start } = opening;

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

let currentPack = null;
let landing = null;
let openingPanel = null;
let landingPanel = null;

// Opening-UI ohne Pack-Auswähler (das Pack wird auf der Landing-Page gewählt);
// "Zurück zur Auswahl" führt zurück zur Landing-Page.
const ui = createUI({
  showPicker: false,
  onOpen: () => reveal.start(currentPack.backendPackId),
  onBack: () => enterLanding(),
});

const reveal = new RevealSequence({
  viewer, beam, cardStack, rotator, tweens, ui,
  onAbort: async (msg) => { await loadPack(currentPack); ui.setStatus(msg); },
});

async function loadPack(pack) {
  currentPack = pack;
  ui.setMode('select');
  ui.setOpenEnabled(false);
  ui.setStatus('Lädt …');
  ui.setHint('');
  try {
    await viewer.load(pack.file); // rip-GLB aus der Set-Struktur
    rotator.attach(viewer.getRotationTarget());
    ui.setStatus('');
    ui.setOpenEnabled(true);
  } catch (err) {
    console.error('Pack konnte nicht geladen werden:', err);
    ui.setStatus('Fehler beim Laden');
  }
}

function showPanels(view) {
  if (openingPanel) openingPanel.domElement.style.display = view === 'opening' ? '' : 'none';
  if (landingPanel) landingPanel.domElement.style.display = view === 'landing' ? '' : 'none';
}

function enterOpening(pack) {
  landing.setActive(false);
  opening.setActive(true);
  ui.setVisible(true);
  showPanels('opening');
  loadPack(pack);
}

function enterLanding() {
  reveal.reset();
  opening.setActive(false);
  ui.setVisible(false);
  landing.setActive(true);
  landing.refresh(); // Fortschritt nach dem Opening aktualisieren
  showPanels('landing');
}

async function init() {
  start();
  await cardStack.loadTemplate(); // Karten-Rohling vorladen
  cardStack.prewarm();

  // Opening-View zunächst pausiert/versteckt.
  opening.setActive(false);
  ui.setVisible(false);

  // Landing aufbauen + anzeigen (Default-View).
  landing = new Landing({ onPackClick: (pack) => enterOpening(pack) });
  await landing.build();
  landing.setActive(true);
}

// DEV-ONLY: beide Tuning-Panels (3D + Landing-Layout). Im Live-Build per
// Dead-Code-Elimination raus. Es wird jeweils nur das zur aktiven View gezeigt.
init().then(() => {
  if (import.meta.env.DEV) {
    Promise.all([import('./tuningPanel.js'), import('./landingPanel.js')]).then(([tp, lp]) => {
      openingPanel = tp.createTuningPanel({ camera, cardStack, reloadPack: () => loadPack(currentPack) });
      landingPanel = lp.createLandingPanel();
      showPanels('landing'); // Start ist Landing
    });
  }
});
