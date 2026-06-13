// DEV-ONLY Layout-Panel der Landing-Page (lil-gui). Nur im Dev-Build.
// Regelt die CSS-Layout-Variablen (Set-Container, Pack-Kacheln, Fortschrittstexte)
// live. Reset (pro Wert via Doppelklick im Regler + "Alles zurücksetzen"),
// Speichern/Clear in localStorage, Export der Werte. Verändert NICHT die Datei.

import GUI from 'lil-gui';
import { LANDING_VARS, LANDING_DEFAULTS, setLandingVar } from './landingConfig.js';

const LS_KEY = 'ruckzug.landing';
const KEYS = Object.keys(LANDING_VARS);

export function createLandingPanel() {
  const gui = new GUI({ title: '🎚 Landing-Layout (nur DEV)' });
  gui.domElement.style.top = '0';
  gui.domElement.style.left = '0';
  gui.domElement.style.right = 'auto';

  const state = {};
  for (const k of KEYS) state[k] = LANDING_VARS[k].value;

  // Gespeicherte Werte übernehmen.
  const saved = loadSaved();
  if (saved) for (const k of KEYS) if (k in saved) { state[k] = saved[k]; setLandingVar(k, saved[k]); }

  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());

  const folder = gui.addFolder('Layout');
  for (const k of KEYS) {
    const v = LANDING_VARS[k];
    folder.add(state, k, v.min, v.max, v.step).name(v.label).onChange((val) => setLandingVar(k, val));
  }

  const actions = {
    resetAll() {
      for (const k of KEYS) { state[k] = LANDING_DEFAULTS[k]; setLandingVar(k, LANDING_DEFAULTS[k]); }
      refresh();
    },
    save() {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      console.log('[Landing] Layout in localStorage gespeichert.');
    },
    clear() {
      localStorage.removeItem(LS_KEY);
      this.resetAll();
      console.log('[Landing] localStorage geleert — zurück auf Defaults.');
    },
    copyConfig() {
      const lines = KEYS.map((k) => `  '${k}': ${state[k]},  // ${LANDING_VARS[k].label}`);
      const text = `// Landing-Layout (in landingConfig.js value-Felder übernehmen):\n{\n${lines.join('\n')}\n}\n`;
      console.log(text);
      navigator.clipboard?.writeText(text).catch(() => {});
    },
  };
  const af = gui.addFolder('Speichern / Reset');
  af.add(actions, 'save').name('💾 Im Browser speichern');
  af.add(actions, 'clear').name('🗑 localStorage löschen');
  af.add(actions, 'resetAll').name('↺ ALLES zurücksetzen');
  af.add(actions, 'copyConfig').name('📋 Copy Layout');

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
