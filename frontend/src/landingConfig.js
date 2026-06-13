// Layout-Konstanten der Landing-Page als CSS-Custom-Properties.
// Live regelbar über das Dev-Landing-Panel (nur DEV). Reset/Export = Defaults hier.

const VARS = {
  '--set-pad':         { value: 20,  unit: 'px', min: 4,  max: 60,  step: 1, label: 'Set: Innenabstand' },
  '--set-gap':         { value: 28,  unit: 'px', min: 0,  max: 80,  step: 1, label: 'Set: Abstand untereinander' },
  '--set-radius':      { value: 18,  unit: 'px', min: 0,  max: 40,  step: 1, label: 'Set: Eckenradius' },
  '--set-title-size':  { value: 22,  unit: 'px', min: 12, max: 40,  step: 1, label: 'Set: Titelgröße' },
  '--set-maxw':        { value: 1100, unit: 'px', min: 480, max: 1600, step: 10, label: 'Set: max. Breite' },
  '--pack-tile-w':     { value: 150, unit: 'px', min: 80, max: 320, step: 2, label: 'Pack: Breite' },
  '--pack-stage-h':    { value: 190, unit: 'px', min: 80, max: 360, step: 2, label: 'Pack: 3D-Höhe' },
  '--pack-gap':        { value: 16,  unit: 'px', min: 0,  max: 60,  step: 1, label: 'Pack: Min-Abstand' },
  '--pack-radius':     { value: 14,  unit: 'px', min: 0,  max: 32,  step: 1, label: 'Pack: Eckenradius' },
  '--pack-name-size':  { value: 15,  unit: 'px', min: 10, max: 28,  step: 1, label: 'Pack: Namegröße' },
  '--progress-size':   { value: 13,  unit: 'px', min: 9,  max: 24,  step: 1, label: 'Fortschritt: Schrift' },
};

export const LANDING_VARS = VARS;

// Eingefrorener Default-Snapshot (für Reset im Panel).
export const LANDING_DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, v.value])),
);

/** Alle Variablen auf :root setzen (beim Start aufrufen). */
export function applyLandingVars() {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(VARS)) root.style.setProperty(k, `${v.value}${v.unit}`);
}

/** Einen Wert live setzen (vom Dev-Panel). */
export function setLandingVar(key, value) {
  const v = VARS[key];
  if (!v) return;
  v.value = value;
  document.documentElement.style.setProperty(key, `${value}${v.unit}`);
  // Verteilung der Pack-Reihen neu berechnen (z.B. wenn Breite/Abstand sich ändert).
  window.dispatchEvent(new Event('landing-relayout'));
}
