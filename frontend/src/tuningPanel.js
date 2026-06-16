// ============================================================================
//  DEV-ONLY Tuning-Panel (lil-gui). Wird NUR im Dev-Modus erzeugt (main.js
//  gated auf import.meta.env.DEV) und ist im Live-Build NICHT enthalten.
//  Regelt Laufzeit-Werte über config.setTuning() — schreibt NIE in die Datei.
//  - Reset: pro Gruppe + "Alles zurücksetzen" (Defaults = config.js-Werte).
//  - localStorage: Speichern (persistent über Reload), Clear (zurück zu config.js).
//  - Copy config: aktuelle Werte als config.js-Snippet (dauerhaft übernehmen).
//  localStorage wird NUR hier (Dev) genutzt; die config.js-Datei bleibt unberührt.
//  (Später, Phase 8: Panel im Live-Build nur für Admin-user_id — jetzt Dev-Gating.)
// ============================================================================

import GUI from 'lil-gui';
import * as cfg from './config.js';
import { setTuning } from './config.js';

const LS_KEY = 'ruckzug.tuning';

// Reglerdefinition pro Gruppe: [key, min, max, step, label].
const GROUPS = {
  Kamera: [
    ['CAMERA_DISTANCE', 2, 14, 0.1, 'Abstand'],
    ['CAMERA_FOV', 20, 90, 1, 'FOV'],
  ],
  Pack: [
    ['PACK_SPIN_FRICTION', 0.1, 4, 0.05, 'Schwung-Reibung'],
    ['PACK_DRAG_SENSITIVITY', 0.002, 0.05, 0.001, 'Dreh-Empfindlichkeit'],
    ['PACK_SPIN_MAX_SPEED', 5, 40, 1, 'Max. Spin'],
    ['PACK_VIEW_HEIGHT', 1.5, 6, 0.1, 'Pack-Größe'],
  ],
  Beam: [
    ['BEAM_RIP_HEIGHT_FACTOR', -0.8, 0.4, 0.01, 'Höhe (Riss)'],
    ['BEAM_RIP_X_FACTOR', -0.4, 0.4, 0.01, 'X-Versatz'],
    ['BEAM_INTENSITY', 0, 3, 0.05, 'Intensität'],
    ['BEAM_SCALE', 0.3, 3, 0.05, 'Skalierung'],
  ],
  'Card-Stack': [
    ['CARD_STACK_DEPTH', 0, 0.2, 0.005, 'Tiefen-Versatz'],
    ['STACK_MAX_ANGLE_DEG', 0, 80, 1, 'Max. Winkel'],
    ['STACK_SPRING_STIFFNESS', 20, 300, 5, 'Feder-Steifigkeit'],
    ['STACK_SPRING_DAMPING', 2, 40, 1, 'Feder-Dämpfung'],
    ['STACK_DRAG_SENSITIVITY', 0.002, 0.04, 0.001, 'Dreh-Empfindlichkeit'],
    ['FLIP_DURATION', 0.1, 1.2, 0.05, 'Flip-Dauer'],
    ['FLIP_FORWARD', 0, 1.5, 0.05, 'Flip-Bogen'],
  ],
  Swipe: [
    ['SWIPE_LAUNCH_SPEED', 2, 30, 0.5, 'Rausflug-Tempo'], // ersetzt SWIPE_OUT_DURATION
    ['SWIPE_OUT_DISTANCE', 1, 6, 0.1, 'Rausflug-Weg'],
    ['SWIPE_DISTANCE_THRESHOLD', 0.1, 2.5, 0.05, 'Wisch-Schwelle'],
    ['SWIPE_FOLLOW_SENSITIVITY', 0.004, 0.04, 0.001, 'Finger-Folgen'],
    ['SWIPE_RETURN_DURATION', 0.1, 1, 0.02, 'Zurückfedern'],
    ['TAP_VS_DRAG_THRESHOLD', 2, 40, 1, 'Tap/Drag-Schwelle'],
  ],
  x10: [
    ['X10_STACK_DEPTH', 0.2, 2.5, 0.05, 'Stapel-Tiefe'],
    ['X10_STACK_RISE', 0, 1.2, 0.02, 'Stapel-Hochversatz'],
    ['X10_CAM_DIST', 3, 16, 0.1, 'Kamera-Abstand'],
    ['X10_CAM_ANGLE_DEG', 0, 60, 1, 'Kamera-Winkel (°)'],
    ['X10_CAM_LOOK_Y', -1, 3, 0.1, 'Blickziel-Höhe'],
    ['X10_FLYOVER', 0.5, 5, 0.1, 'Überflug-Tempo'],
    ['X10_FLYOVER_OVERSHOOT', 0, 3, 0.1, 'Überflug-Overshoot'],
    ['X10_RIP_STAGGER', 0, 0.5, 0.01, 'Aufreiß-Welle'],
    ['X10_CAM_MOVE', 0.1, 1.5, 0.05, 'Übergang zu Karten'],
    ['X10_HOLD_AFTER_RIP', 0, 2.5, 0.1, 'Halt vor Karten'],
  ],
};

// Pfeile (size/gap als Zahl, Farbe separat).
const ARROW_NUM = [
  ['ARROW_SIZE_FACTOR', 0.05, 0.4, 0.01, 'Größe'],
  ['ARROW_GAP_FACTOR', 0, 0.4, 0.01, 'Abstand'],
];
const ARROW_KEYS = [...ARROW_NUM.map((r) => r[0]), 'ARROW_COLOR'];

// Alle Keys (Reihenfolge fürs Snippet/Speichern).
const EXPORT_KEYS = [...Object.values(GROUPS).flat().map((r) => r[0]), ...ARROW_KEYS];

export function createTuningPanel({ camera, cardStack, reloadPack }) {
  const defaults = cfg.TUNING_DEFAULTS;
  const gui = new GUI({ title: '🛠 Dev-Tuning (nur DEV)' });

  // state spiegelt die aktuellen Werte (lil-gui bindet daran).
  const state = {};
  for (const key of EXPORT_KEYS) state[key] = cfg[key];

  // Gespeicherte Werte aus localStorage als Startwerte übernehmen.
  const saved = loadSaved();
  if (saved) for (const key of EXPORT_KEYS) if (key in saved) state[key] = saved[key];

  // --- Anwenden auf die laufende Szene ---
  const applyCamera = () => {
    camera.fov = cfg.CAMERA_FOV;
    camera.position.z = cfg.CAMERA_DISTANCE;
    camera.updateProjectionMatrix();
  };

  function applyKeys(keys) {
    let cam = false; let arr = false; let reload = false;
    for (const key of keys) {
      setTuning(key, state[key]);
      if (key === 'CAMERA_FOV' || key === 'CAMERA_DISTANCE') cam = true;
      else if (key.startsWith('ARROW_')) arr = true;
      else if (key === 'PACK_VIEW_HEIGHT') reload = true;
    }
    if (cam) applyCamera();
    if (arr) cardStack.rebuildArrows();
    if (reload) reloadPack();
  }

  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());

  function resetKeys(keys) {
    for (const key of keys) state[key] = defaults[key];
    applyKeys(keys);
    refresh();
  }

  // --- localStorage ---
  function save() {
    const obj = {};
    for (const key of EXPORT_KEYS) obj[key] = state[key];
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
    console.log('[Tuning] Werte in localStorage gespeichert (bleiben über Reload).');
  }
  function clearSaved() {
    localStorage.removeItem(LS_KEY);
    resetKeys(EXPORT_KEYS); // zurück auf config.js-Defaults
    console.log('[Tuning] localStorage geleert — zurück auf config.js-Defaults.');
  }

  // --- Regler + Gruppen-Reset ---
  const addSlider = (folder, [key, min, max, step, label]) => {
    folder.add(state, key, min, max, step).name(label).onChange(() => applyKeys([key]));
  };
  for (const [groupName, rows] of Object.entries(GROUPS)) {
    const folder = gui.addFolder(groupName);
    rows.forEach((row) => addSlider(folder, row));
    const keys = rows.map((r) => r[0]);
    folder.add({ reset: () => resetKeys(keys) }, 'reset').name('↺ Gruppe zurücksetzen');
  }

  // Pfeile (inkl. Farbwähler) + Gruppen-Reset.
  const arrowF = gui.addFolder('Pfeile');
  ARROW_NUM.forEach((row) => addSlider(arrowF, row));
  arrowF.addColor(state, 'ARROW_COLOR').name('Farbe').onChange(() => applyKeys(['ARROW_COLOR']));
  arrowF.add({ reset: () => resetKeys(ARROW_KEYS) }, 'reset').name('↺ Gruppe zurücksetzen');

  // --- Globale Aktionen ---
  const actionsF = gui.addFolder('Speichern / Reset');
  actionsF.add({ save }, 'save').name('💾 Im Browser speichern (localStorage)');
  actionsF.add({ clear: clearSaved }, 'clear').name('🗑 localStorage löschen (zurück zu config.js)');
  actionsF.add({ resetAll: () => resetKeys(EXPORT_KEYS) }, 'resetAll').name('↺ ALLES zurücksetzen');
  actionsF.add({ copyConfig }, 'copyConfig').name('📋 Copy config (Konsole/Clipboard)');

  // Falls gespeicherte Werte geladen wurden: jetzt auf die laufende Szene anwenden.
  if (saved) applyKeys(EXPORT_KEYS);

  function copyConfig() {
    const lines = EXPORT_KEYS.map((key) => {
      const v = state[key];
      const val = typeof v === 'string' ? `'${v}'` : v;
      return `export let ${key} = ${val};`;
    });
    const text = `// --- aus Dev-Tuning-Panel exportiert ---\n${lines.join('\n')}\n`;
    console.log(text);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => console.log('[Tuning] Config in die Zwischenablage kopiert.'))
        .catch(() => console.log('[Tuning] Clipboard nicht verfügbar — Werte oben aus der Konsole kopieren.'));
    }
  }

  return gui;
}

function loadSaved() {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
