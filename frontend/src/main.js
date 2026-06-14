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
import { Admin, TUNING_LS_KEY } from './adminView.js';
import { applyLandingVars } from './landingConfig.js';
import { DOUBLE_TAP_MS, TAP_VS_DRAG_THRESHOLD } from './config.js';

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
let loggedIn = false;     // Login-Status (von der Landing via onAuthChange)
let isAdmin = false;      // Admin-Status (von der Landing via onAuthChange)
let activeView = 'landing';
let landing = null;
let admin = null;
let openingPanel = null;
let landingPanel = null;
let panelsLoading = false;

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
  onComplete: () => enterLanding(), // Auto-Zurück nach der letzten Karte
});

// Doppelklick / Doppel-Tap auf das Pack (Opening-Canvas) startet das Öffnen.
// Einzelklick/Drag dreht weiter (DragRotator); ein Drag zählt nicht als Tap.
// Die Seite (vorne/hinten) bestimmt reveal.start im Moment des Doppel-Taps.
attachDoubleTap(renderer.domElement, () => {
  if (currentPack) reveal.start(currentPack.backendPackId);
});

function attachDoubleTap(eln, cb) {
  let downX = 0; let downY = 0; let lastT = 0; let lastX = 0; let lastY = 0;
  eln.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  eln.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_VS_DRAG_THRESHOLD) {
      lastT = 0; return; // war ein Drag (Drehen) -> kein Tap
    }
    const now = performance.now();
    if (now - lastT < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 40) {
      lastT = 0;
      cb();
    } else {
      lastT = now; lastX = e.clientX; lastY = e.clientY;
    }
  });
}

async function loadPack(pack) {
  currentPack = pack;
  ui.setMode('select');
  ui.setStatus('Lädt …');
  ui.setHint('');
  try {
    await viewer.load(pack.file); // rip-GLB aus der Set-Struktur
    rotator.attach(viewer.getRotationTarget());
    ui.setStatus('');
    ui.setHint('Doppeltippen zum Öffnen · ziehen zum Drehen');
  } catch (err) {
    console.error('Pack konnte nicht geladen werden:', err);
    ui.setStatus('Fehler beim Laden');
  }
}

function showPanels(view) {
  activeView = view;
  if (openingPanel) openingPanel.domElement.style.display = view === 'opening' ? '' : 'none';
  if (landingPanel) landingPanel.domElement.style.display = view === 'landing' ? '' : 'none';
}

// Tuning-Panels (3D aus 4c + Landing-Layout aus Phase 6): nur für eingeloggte
// Admins UND nur wenn im Admin-Tab eingeschaltet (persistent in localStorage).
// Nicht-Admins bekommen sie nie zu sehen.
function tuningEnabled() {
  return localStorage.getItem(TUNING_LS_KEY) === '1';
}

async function applyTuningPanels(enabled) {
  const shouldShow = isAdmin && enabled;
  if (shouldShow) {
    if (openingPanel || landingPanel || panelsLoading) return;
    panelsLoading = true;
    try {
      const [tp, lp] = await Promise.all([import('./tuningPanel.js'), import('./landingPanel.js')]);
      openingPanel = tp.createTuningPanel({ camera, cardStack, reloadPack: () => loadPack(currentPack) });
      landingPanel = lp.createLandingPanel();
    } finally {
      panelsLoading = false;
    }
    showPanels(activeView); // nur das zur aktuellen View passende Panel zeigen
  } else {
    if (openingPanel) { openingPanel.destroy(); openingPanel = null; }
    if (landingPanel) { landingPanel.destroy(); landingPanel = null; }
  }
}

function enterOpening(pack) {
  // Login erforderlich, bevor man ein Pack öffnet (ROADMAP §8).
  if (!loggedIn) { landing.promptLogin(); return; }
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
  // refreshAuth aktualisiert Sanduhr-Stand + Pack-Gate (nach dem Opening), refresh den Fortschritt.
  landing.refreshAuth().then(() => landing.refresh());
  showPanels('landing');
}

// --- Admin (/admin) ---
// Die eigentliche Zugriffskontrolle ist serverseitig (require_admin -> 403);
// admin.open() prüft is_admin und zeigt sonst „Kein Zugriff".
function enterAdmin(push = true) {
  if (push && window.location.pathname !== '/admin') {
    window.history.pushState({}, '', '/admin');
  }
  opening.setActive(false);
  ui.setVisible(false);
  landing.setActive(false);
  showPanels('admin'); // Tuning-Panels im Admin-Tab ausblenden
  admin.open();
}

function exitAdmin() {
  admin.hide();
  if (window.location.pathname === '/admin') {
    window.history.pushState({}, '', '/');
  }
  enterLanding();
}

window.addEventListener('popstate', () => {
  if (window.location.pathname === '/admin') enterAdmin(false);
  else { admin.hide(); enterLanding(); }
});

async function init() {
  start();
  await cardStack.loadTemplate(); // Karten-Rohling vorladen
  cardStack.prewarm();

  // Opening-View zunächst pausiert/versteckt.
  opening.setActive(false);
  ui.setVisible(false);

  // Admin-View (versteckt, bis geöffnet). Der Tuning-Toggle schaltet die Panels live.
  admin = new Admin({
    onClose: () => exitAdmin(),
    onTuningToggle: (enabled) => applyTuningPanels(enabled),
  });

  // Landing aufbauen + anzeigen (Default-View).
  landing = new Landing({ onPackClick: (pack) => enterOpening(pack) });
  // vor build(), damit der erste refreshAuth greift: Login-/Admin-Status + Panels.
  landing.onAuthChange = (me) => {
    loggedIn = !!me.logged_in;
    isAdmin = !!me.is_admin;
    applyTuningPanels(tuningEnabled()); // erstellt/zerstört Panels je nach Admin+Schalter
  };
  landing.onOpenAdmin = () => enterAdmin();
  await landing.build();
  landing.setActive(true);

  // Deep-Link: direkt auf /admin geladen -> Admin öffnen (Gate prüft serverseitig).
  if (window.location.pathname === '/admin') enterAdmin(false);
}

// Tuning-Panels werden NICHT mehr beim Start erzeugt, sondern admin-gated über
// applyTuningPanels() (siehe landing.onAuthChange + Admin-Toggle). So sind sie im
// Live-Build vorhanden, aber nur für eingeloggte Admins mit aktiviertem Schalter.
init();
