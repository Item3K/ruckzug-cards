// Zentrale Konfiguration für Phase 4b/4c.
// ============================================================================
//  FEEL-KONSTANTEN — Spielgefühl. Werte sind LIVE über das Dev-Tuning-Panel
//  (lil-gui, nur DEV) regelbar. Technisch sind es `let`-Exporte: ES-Module-
//  Live-Bindings, daher sehen alle Importeure Änderungen via setTuning() sofort.
//  Dauerhaft übernehmen: im Panel "Copy config" -> Werte hier zurückschreiben.
// ============================================================================

import * as THREE from 'three';

// --- Karten-Wischen (vorderste Karte per Drag wegwischen) -------------------
export let SWIPE_DISTANCE_THRESHOLD = 0.8;   // Weltunits Ziehen bis Rausfliegen (sonst zurückfedern)
export let SWIPE_FOLLOW_SENSITIVITY = 0.012; // wie direkt die Karte dem Finger folgt (Weltunits/Pixel)
export let SWIPE_LAUNCH_SPEED = 11;          // Mindest-/Klick-Startgeschwindigkeit Rausflug (Weltunits/s, Momentum)
export let SWIPE_OUT_DISTANCE = 2.6;         // Rausgleit-Strecke bis Entfernen (× Kartenhöhe)
export let SWIPE_RETURN_DURATION = 0.28;     // Zurückfedern-Dauer (Sekunden)

// --- Tap vs. Drag -----------------------------------------------------------
export let TAP_VS_DRAG_THRESHOLD = 10;       // < px = Tap/Klick, sonst Drag

// --- Stapel-Drehen (Drag NEBEN dem Stapel) ----------------------------------
export let STACK_MAX_ANGLE_DEG = 30;         // ± Grenze fürs Stapel-Drehen
export let STACK_MAX_ANGLE_RAD = THREE.MathUtils.degToRad(STACK_MAX_ANGLE_DEG); // abgeleitet
export let STACK_DRAG_SENSITIVITY = 0.01;    // Radiant pro Pixel beim Stapel-Drehen
export let STACK_SPRING_STIFFNESS = 130;     // höher = schneller/härter zurück zur Mitte
export let STACK_SPRING_DAMPING = 13;        // niedriger = mehr Nachwippen

// --- Flip (Modus "hinten": Rückseite -> Vorderseite) ------------------------
export let FLIP_DURATION = 0.45;             // Sekunden
export let FLIP_FORWARD = 0.5;               // Bogen nach vorn beim Flip (× Kartenhöhe)

// --- Pack-Schwung (Anschubsen vor dem Öffnen) -------------------------------
export let PACK_SPIN_FRICTION = 0.6;         // kleiner = dreht länger aus
export let PACK_DRAG_SENSITIVITY = 0.015;    // Pack-Dreh-Empfindlichkeit (rad/px)
export let PACK_SPIN_MAX_SPEED = 20;         // rad/s Deckel

// --- Beam -------------------------------------------------------------------
export let BEAM_RIP_HEIGHT_FACTOR = -0.46;   // Höhe der Beam-Spitze (× Pack-Höhe), negativer = tiefer
export let BEAM_RIP_X_FACTOR = -0.03;        // horizontaler Versatz (× Pack-Höhe), negativ = links
export let BEAM_INTENSITY = 1.0;             // Multiplikator auf die Beam-Spitzen-Deckkraft
export let BEAM_SCALE = 1.0;                 // Multiplikator auf die Beam-Größe

// --- Stapel-Optik -----------------------------------------------------------
export let CARD_STACK_DEPTH = 0.04;          // Tiefen-Versatz pro Karte (× Kartenhöhe)

// --- Wisch-Pfeile (Chevron-Icons neben der Karte) ---------------------------
export let ARROW_SIZE_FACTOR = 0.18;         // Pfeilgröße (× Kartenhöhe)
export let ARROW_GAP_FACTOR = 0.1;           // Abstand zum Kartenrand (× Kartenhöhe)
export let ARROW_COLOR = '#ffffff';          // Tönung des Chevron-Icons (SVG ist weiß)

// ============================================================================
//  STRUKTUR-KONSTANTEN (Kamera/Größen)
// ============================================================================
export let CAMERA_FOV = 45;
export let CAMERA_DISTANCE = 6.0;            // fester Kamera-Abstand (kein Zoom)
export let PACK_VIEW_HEIGHT = 3.4;           // Zielhöhe des Packs in Weltunits
export let CARD_VIEW_HEIGHT = 2.4;           // Zielhöhe einer Karte in Weltunits

// --- Pack öffnen (Animation/Übergang) ---------------------------------------
export let PACK_OPEN_TIMESCALE = 1.15;       // Abspieltempo der Aufreiß-Animation (>1 = kürzer)
export let PACK_FADE_DURATION = 0.22;        // Pack-Ausblenden beim Reveal

// ============================================================================
//  Live-Update aus dem Dev-Panel. Schreibt NUR Laufzeit-Werte (nie in die Datei).
// ============================================================================
const _setters = {
  SWIPE_DISTANCE_THRESHOLD: (v) => { SWIPE_DISTANCE_THRESHOLD = v; },
  SWIPE_FOLLOW_SENSITIVITY: (v) => { SWIPE_FOLLOW_SENSITIVITY = v; },
  SWIPE_LAUNCH_SPEED: (v) => { SWIPE_LAUNCH_SPEED = v; },
  SWIPE_OUT_DISTANCE: (v) => { SWIPE_OUT_DISTANCE = v; },
  SWIPE_RETURN_DURATION: (v) => { SWIPE_RETURN_DURATION = v; },
  TAP_VS_DRAG_THRESHOLD: (v) => { TAP_VS_DRAG_THRESHOLD = v; },
  STACK_MAX_ANGLE_DEG: (v) => { STACK_MAX_ANGLE_DEG = v; STACK_MAX_ANGLE_RAD = THREE.MathUtils.degToRad(v); },
  STACK_DRAG_SENSITIVITY: (v) => { STACK_DRAG_SENSITIVITY = v; },
  STACK_SPRING_STIFFNESS: (v) => { STACK_SPRING_STIFFNESS = v; },
  STACK_SPRING_DAMPING: (v) => { STACK_SPRING_DAMPING = v; },
  FLIP_DURATION: (v) => { FLIP_DURATION = v; },
  FLIP_FORWARD: (v) => { FLIP_FORWARD = v; },
  PACK_SPIN_FRICTION: (v) => { PACK_SPIN_FRICTION = v; },
  PACK_DRAG_SENSITIVITY: (v) => { PACK_DRAG_SENSITIVITY = v; },
  PACK_SPIN_MAX_SPEED: (v) => { PACK_SPIN_MAX_SPEED = v; },
  BEAM_RIP_HEIGHT_FACTOR: (v) => { BEAM_RIP_HEIGHT_FACTOR = v; },
  BEAM_RIP_X_FACTOR: (v) => { BEAM_RIP_X_FACTOR = v; },
  BEAM_INTENSITY: (v) => { BEAM_INTENSITY = v; },
  BEAM_SCALE: (v) => { BEAM_SCALE = v; },
  CARD_STACK_DEPTH: (v) => { CARD_STACK_DEPTH = v; },
  ARROW_SIZE_FACTOR: (v) => { ARROW_SIZE_FACTOR = v; },
  ARROW_GAP_FACTOR: (v) => { ARROW_GAP_FACTOR = v; },
  ARROW_COLOR: (v) => { ARROW_COLOR = v; },
  CAMERA_FOV: (v) => { CAMERA_FOV = v; },
  CAMERA_DISTANCE: (v) => { CAMERA_DISTANCE = v; },
  PACK_VIEW_HEIGHT: (v) => { PACK_VIEW_HEIGHT = v; },
  CARD_VIEW_HEIGHT: (v) => { CARD_VIEW_HEIGHT = v; },
  PACK_OPEN_TIMESCALE: (v) => { PACK_OPEN_TIMESCALE = v; },
  PACK_FADE_DURATION: (v) => { PACK_FADE_DURATION = v; },
};

export function setTuning(key, value) {
  const set = _setters[key];
  if (set) set(value);
  else console.warn('[config] unbekannter Tuning-Key:', key);
}
