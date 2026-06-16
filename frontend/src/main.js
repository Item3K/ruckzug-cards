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
import { RevealX10 } from './revealX10.js';
import { TweenManager } from './tween.js';
import { DragRotator } from './dragRotator.js';
import { Landing } from './landingView.js';
import { Admin, TUNING_LS_KEY } from './adminView.js';
import { Trading } from './tradingView.js';
import { listTrades } from './api.js';
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
  if (revealX10) revealX10.update(delta); // x10-Pack-Reihe (Rip-Mixer)
});

let currentPack = null;
let revealX10 = null;     // x10-Orchestrator (nach ui erstellt)
let x10Mode = false;      // true, solange der x10-Modus die Opening-View besitzt
let loggedIn = false;     // Login-Status (von der Landing via onAuthChange)
let isAdmin = false;      // Admin-Status (von der Landing via onAuthChange)
let activeView = 'landing';
let landing = null;
let admin = null;
let trading = null;
let openingPanel = null;
let landingPanel = null;
let panelsLoading = false;

// Opening-UI ohne Pack-Auswähler (das Pack wird auf der Landing-Page gewählt);
// "Zurück zur Auswahl" führt zurück zur Landing-Page.
const ui = createUI({
  showPicker: false,
  onOpen: () => reveal.start(currentPack.backendPackId),
  onBack: () => enterLanding(),
  onExit: () => enterLanding(), // Exit (X / Esc) für Einzel- UND x10-Opening
});

const reveal = new RevealSequence({
  viewer, beam, cardStack, rotator, tweens, ui,
  onAbort: async (msg) => { await loadPack(currentPack); ui.setStatus(msg); },
  onComplete: () => enterLanding(), // Auto-Zurück nach der letzten Karte
});

// x10-Modus (10 Packs auf einmal) — teilt sich cardStack/ui mit dem Einzel-Opening;
// eigene Beam-Instanzen für mehrere gleichzeitige Beams. renderer für Prewarm/Preload.
revealX10 = new RevealX10({
  scene, camera, renderer, cardStack, tweens, ui,
  onComplete: () => enterLanding(),
});

// Doppelklick / Doppel-Tap auf das Pack (Opening-Canvas) startet das Öffnen.
// Einzelklick/Drag dreht weiter (DragRotator); ein Drag zählt nicht als Tap.
attachDoubleTap(renderer.domElement, () => {
  if (x10Mode) { revealX10.beginSequence(); return; } // x10: Doppeltipp startet die Sequenz (beginSequence prüft 'armed')
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
  x10Mode = false;
  landing.setActive(false);
  opening.setActive(true);
  ui.setVisible(true);
  showPanels('opening');
  loadPack(pack);
}

// x10-Modus starten (10 Packs desselben Typs auf einmal).
function enterOpeningX10(pack) {
  if (!loggedIn) { landing.promptLogin(); return; }
  x10Mode = true;
  reveal.reset();        // evtl. Einzel-Opening-Reste sauber
  revealX10.reset();
  viewer.dispose();      // kein Einzel-Pack im Bild
  currentPack = pack;
  landing.setActive(false);
  opening.setActive(true);
  ui.setVisible(true);
  showPanels('opening');
  revealX10.present(pack.backendPackId, pack.file); // zeigt Stapel; Sequenz per Doppeltipp
}

function enterLanding() {
  x10Mode = false;
  reveal.reset();
  if (revealX10) revealX10.reset();
  opening.setActive(false);
  ui.setVisible(false);
  landing.setActive(true);
  // refreshAuth aktualisiert Sanduhr-Stand + Pack-Gate (nach dem Opening), refresh den Fortschritt.
  landing.refreshAuth().then(() => landing.refresh());
  refreshTradeBadge(); // Badge einmalig auffrischen (z.B. nach Rückkehr aus dem Trading-Tab)
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

// Badge einmalig auffrischen (kein Dauer-Polling außerhalb des Trading-Tabs).
// Wird beim Betreten der Landing-Page und nach Auth-Wechsel aufgerufen.
function refreshTradeBadge() {
  if (!loggedIn) { landing.setTradeBadge(0); return; }
  listTrades().then((d) => landing.setTradeBadge(d.incoming.length)).catch(() => {});
}

// --- Trading (Overlay, kein Deep-Link nötig) ---
function enterTrading() {
  opening.setActive(false);
  ui.setVisible(false);
  landing.setActive(false);
  showPanels('trading'); // Tuning-Panels im Trading-Tab ausblenden
  trading.open();
}

function exitTrading() {
  trading.hide();
  enterLanding();
}

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
  // Trading-View (versteckt, bis geöffnet). Während es offen ist, pollt es selbst
  // und meldet die Zahl eingehender Trades fürs Menü-Badge zurück.
  trading = new Trading({
    onClose: () => exitTrading(),
    onIncomingCount: (n) => { if (landing) landing.setTradeBadge(n); },
    // Klick auf eine Notification: Fenster fokussieren (in der View-Methode) + zum
    // Trading-Tab springen, falls man gerade woanders ist.
    onNotificationClick: () => { if (activeView !== 'trading') enterTrading(); },
  });

  // Landing aufbauen + anzeigen (Default-View).
  landing = new Landing({
    onPackClick: (pack) => enterOpening(pack),
    onPackX10: (pack) => enterOpeningX10(pack),
  });
  // vor build(), damit der erste refreshAuth greift: Login-/Admin-Status + Panels.
  landing.onAuthChange = (me) => {
    loggedIn = !!me.logged_in;
    isAdmin = !!me.is_admin;
    applyTuningPanels(tuningEnabled()); // erstellt/zerstört Panels je nach Admin+Schalter
    refreshTradeBadge();                // Badge nach Login/Logout aktualisieren
  };
  landing.onOpenAdmin = () => enterAdmin();
  landing.onOpenTrading = () => enterTrading();
  await landing.build();
  landing.setActive(true);

  // Deep-Link: direkt auf /admin geladen -> Admin öffnen (Gate prüft serverseitig).
  if (window.location.pathname === '/admin') enterAdmin(false);
}

// Tuning-Panels werden NICHT mehr beim Start erzeugt, sondern admin-gated über
// applyTuningPanels() (siehe landing.onAuthChange + Admin-Toggle). So sind sie im
// Live-Build vorhanden, aber nur für eingeloggte Admins mit aktiviertem Schalter.
init();
