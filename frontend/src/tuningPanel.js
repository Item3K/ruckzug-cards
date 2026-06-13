// ============================================================================
//  DEV-ONLY Tuning-Panel (lil-gui). Wird NUR im Dev-Modus erzeugt (main.js
//  gated auf import.meta.env.DEV) und ist im Live-Build NICHT enthalten.
//  Regelt Laufzeit-Werte über config.setTuning() — schreibt NIE in die Datei.
//  Gute Werte via "Copy config" exportieren und manuell in config.js übernehmen.
// ============================================================================

import GUI from 'lil-gui';
import * as cfg from './config.js';
import { setTuning } from './config.js';

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
};

// Pfeile (size/gap als Zahl, Farbe separat).
const ARROW_NUM = [
  ['ARROW_SIZE_FACTOR', 0.05, 0.4, 0.01, 'Größe'],
  ['ARROW_GAP_FACTOR', 0, 0.4, 0.01, 'Abstand'],
];

// Alle Keys, die exportiert werden (Reihenfolge fürs Snippet).
const EXPORT_KEYS = [
  ...Object.values(GROUPS).flat().map((r) => r[0]),
  ...ARROW_NUM.map((r) => r[0]),
  'ARROW_COLOR',
];

export function createTuningPanel({ camera, cardStack, reloadPack }) {
  const gui = new GUI({ title: '🛠 Dev-Tuning (nur DEV)' });

  // state spiegelt die aktuellen Config-Werte (lil-gui bindet an dieses Objekt).
  const state = {};
  for (const key of EXPORT_KEYS) state[key] = cfg[key];

  const applyCamera = () => {
    camera.fov = cfg.CAMERA_FOV;
    camera.position.z = cfg.CAMERA_DISTANCE;
    camera.updateProjectionMatrix();
  };
  const applyArrows = () => cardStack.rebuildArrows();
  const APPLY = {
    CAMERA_DISTANCE: applyCamera,
    CAMERA_FOV: applyCamera,
    PACK_VIEW_HEIGHT: () => reloadPack(),
    ARROW_SIZE_FACTOR: applyArrows,
    ARROW_GAP_FACTOR: applyArrows,
    ARROW_COLOR: applyArrows,
  };

  const addSlider = (folder, [key, min, max, step, label]) => {
    folder.add(state, key, min, max, step).name(label).onChange((v) => {
      setTuning(key, v);
      if (APPLY[key]) APPLY[key]();
    });
  };

  for (const [groupName, rows] of Object.entries(GROUPS)) {
    const folder = gui.addFolder(groupName);
    rows.forEach((row) => addSlider(folder, row));
  }

  // Pfeile (inkl. Farbwähler).
  const arrowF = gui.addFolder('Pfeile');
  ARROW_NUM.forEach((row) => addSlider(arrowF, row));
  arrowF.addColor(state, 'ARROW_COLOR').name('Farbe').onChange((v) => {
    setTuning('ARROW_COLOR', v);
    applyArrows();
  });

  // --- Export: aktuelle Werte als config.js-Snippet ---
  const actions = {
    copyConfig() {
      const lines = EXPORT_KEYS.map((key) => {
        const v = cfg[key];
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
    },
  };
  gui.add(actions, 'copyConfig').name('📋 Copy config (Konsole/Clipboard)');

  return gui;
}
