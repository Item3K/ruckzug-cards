// Zentrale Konfiguration für Phase 4b.
// ============================================================================
//  FEEL-KONSTANTEN — hier alles zum Selbst-Justieren des Spielgefühls.
//  (Vite lädt bei Speichern per HMR neu — Werte ändern, speichern, sofort testen.)
// ============================================================================

import * as THREE from 'three';

// --- Karten-Wischen (vorderste Karte per Drag wegwischen) -------------------
// Wie weit (in Weltunits) die Karte horizontal gezogen sein muss, damit sie beim
// Loslassen RAUSFLIEGT (statt zurückzufedern). Kleiner = leichter rausflutschen.
export const SWIPE_DISTANCE_THRESHOLD = 0.8;
// Wie direkt die Karte dem Finger/der Maus folgt (Weltunits pro Pixel Drag).
// Größer = die Karte "klebt" stärker am Finger / bewegt sich weiter.
export const SWIPE_FOLLOW_SENSITIVITY = 0.012;
// Mindest-Startgeschwindigkeit beim Rausfliegen (Weltunits/Sek). Die Karte nimmt
// die Bewegungsgeschwindigkeit aus dem Drag mit (Momentum); ein schneller Flick
// fliegt schneller, ein langsames Ziehen mindestens mit diesem Wert -> kein Stocken.
// Auch der Startwert beim Klick-Wischen (ohne Drag).
export const SWIPE_LAUNCH_SPEED = 11;
// Strecke, über die die Karte rausgleitet + ausblendet, bis sie entfernt wird
// (× Kartenhöhe).
export const SWIPE_OUT_DISTANCE = 2.6;
// Dauer des Zurückfederns, wenn nicht weit genug gezogen wurde (Sekunden).
export const SWIPE_RETURN_DURATION = 0.28;

// --- Tap vs. Drag -----------------------------------------------------------
// Unter dieser Bewegung (Pixel) gilt eine Geste als Tap/Klick (z.B. Flip im
// Modus "hinten"), darüber als Drag (Wischen bzw. Stapel-Drehen).
export const TAP_VS_DRAG_THRESHOLD = 10;

// --- Stapel-Drehen (Drag NEBEN dem Stapel) ----------------------------------
export const STACK_MAX_ANGLE_DEG = 30; // ± Grenze fürs Stapel-Drehen
export const STACK_MAX_ANGLE_RAD = THREE.MathUtils.degToRad(STACK_MAX_ANGLE_DEG);
export const STACK_DRAG_SENSITIVITY = 0.01; // Radiant pro Pixel beim Stapel-Drehen
// Feder zum Zurückschnappen zur Mitte (leicht unterdämpft = minimales Nachwippen).
export const STACK_SPRING_STIFFNESS = 130; // höher = schneller/härter zurück
export const STACK_SPRING_DAMPING = 13;    // niedriger = mehr Nachwippen

// --- Flip (Modus "hinten": Rückseite -> Vorderseite) ------------------------
export const FLIP_DURATION = 0.45;   // Sekunden
export const FLIP_FORWARD = 0.5;     // kurzer Bogen nach vorn (× Kartenhöhe), damit
                                     // die Karte beim Drehen den Stapel nicht durchschneidet

// --- Pack-Schwung (Anschubsen vor dem Öffnen) -------------------------------
export const PACK_SPIN_FRICTION = 0.6;   // kleiner = dreht länger aus
export const PACK_DRAG_SENSITIVITY = 0.015; // Empfindlichkeit beim Pack-Drehen (rad/px)
export const PACK_SPIN_MAX_SPEED = 20;   // rad/s Deckel

// --- Beam -------------------------------------------------------------------
// Höhe der Beam-Spitze relativ zur Pack-Mitte (× Pack-Höhe). Kleiner/negativer
// = tiefer am Riss. (Verlauf: ... -> -0.40 -> -0.46 -> -0.52 -> wieder etwas höher -0.46)
export const BEAM_RIP_HEIGHT_FACTOR = -0.46;
// Horizontale Verschiebung der Beam-Spitze (× Pack-Höhe). Negativ = links, positiv = rechts.
export const BEAM_RIP_X_FACTOR = -0.03;

// --- Stapel-Optik -----------------------------------------------------------
// Minimaler Tiefen-Versatz pro Karte (× Kartenhöhe). Die Karten liegen fast
// deckungsgleich; Ränder dahinter sieht man erst beim seitlichen Drehen.
export const CARD_STACK_DEPTH = 0.04;

// ============================================================================
//  STRUKTUR-KONSTANTEN (Kamera/Größen, selten anzufassen)
// ============================================================================
export const CAMERA_FOV = 45;
export const CAMERA_DISTANCE = 6.0;   // fester Kamera-Abstand (kein Zoom)
export const PACK_VIEW_HEIGHT = 3.4;  // Zielhöhe des Packs in Weltunits
export const CARD_VIEW_HEIGHT = 2.4;  // Zielhöhe einer Karte in Weltunits

// --- Pack öffnen (Animation/Übergang) ---------------------------------------
export const PACK_OPEN_TIMESCALE = 1.15; // Abspieltempo der Aufreiß-Animation (>1 = kürzer)
export const PACK_FADE_DURATION = 0.22;  // Pack-Ausblenden beim Reveal (überlappt die Karten)
