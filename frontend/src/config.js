// Zentrale Tuning-Konstanten für Phase 4b (Steuerung/Optik).
// Alles, was man zum Justieren anfassen will, steht HIER an einer Stelle.

import * as THREE from 'three';

// --- Kamera (steht FEST, kein Zoom) -----------------------------------------
export const CAMERA_FOV = 45;
export const CAMERA_DISTANCE = 6.0;   // fester Abstand zur Mitte (Sweet-Spot)

// Alle Objekte werden auf diese Höhen normiert, damit die feste Kamera für
// jedes Pack und den Stapel gleich gut passt (formatfüllend, ganz im Bild).
export const PACK_VIEW_HEIGHT = 3.4;  // Zielhöhe des Packs in Weltunits
export const CARD_VIEW_HEIGHT = 2.4;  // Zielhöhe einer Karte in Weltunits

// --- Drag-Drehen (Objekte rotieren, nicht die Kamera) -----------------------
export const DRAG_SENSITIVITY = 0.015; // Radiant pro Pixel (höher = empfindlicher)
export const TAP_THRESHOLD_PX = 10;    // Tap/Drag-Schwelle: weniger Bewegung = Tap (wischen), mehr = Drag (drehen)

// --- Pack-Schwung (Momentum/Inertia, NUR Pack — nicht der Stack) ------------
// Reibung als exponentielle Abklingrate pro Sekunde: höher = bremst schneller,
// niedriger = dreht länger aus. Schnelles Ziehen -> höhere Anfangsgeschwindigkeit
// -> längeres Ausdrehen.
export const PACK_SPIN_FRICTION = 0.6;  // weiter gesenkt -> dreht deutlich länger aus
export const PACK_SPIN_MAX_SPEED = 20;  // rad/s Deckel, gegen absurd schnelle Spins

// --- Card-Stack -------------------------------------------------------------
export const STACK_MAX_ANGLE_DEG = 30;            // ± Grenze fürs Stapel-Drehen
export const STACK_MAX_ANGLE_RAD = THREE.MathUtils.degToRad(STACK_MAX_ANGLE_DEG);
// Feder zum Zurückschnappen zur Mitte (leicht unterdämpft = minimales Nachwippen).
export const STACK_SPRING_STIFFNESS = 130; // höher = schneller/härter
export const STACK_SPRING_DAMPING = 13;    // niedriger = mehr Nachwippen
// Minimaler Tiefen-Versatz pro Karte (× Kartenhöhe). Fast deckungsgleich;
// die Ränder dahinter sieht man erst, wenn man den Stapel seitlich dreht.
export const CARD_STACK_DEPTH = 0.035;

// --- Reveal-Bewegung (Karte nach vorn holen / wegswipen) --------------------
export const PRESENT_FORWARD = 0.25;    // × Kartenhöhe Richtung Kamera (leicht vor den Stapel)
export const PRESENT_UP = 0.05;         // × Kartenhöhe nach oben
// Aufgedeckte Karte zur SEITE wegwischen (links/rechts je nach Tap), × Kartenhöhe.
export const CARD_SWIPE_DISTANCE = 2.6;
export const CARD_SWIPE_DURATION = 0.75; // Sekunden — langsamer/dynamischer, ease-out (zügig an, sanft aus)

// --- Pack öffnen ------------------------------------------------------------
// Abspieltempo der Aufreiß-Animation (>1 = etwas schneller/kürzer).
export const PACK_OPEN_TIMESCALE = 1.15;
// Dauer des Pack-Ausblendens nach dem Aufreißen (kurz -> Karten kommen prompt).
export const PACK_FADE_DURATION = 0.22;

// --- Beam -------------------------------------------------------------------
// Höhe des Risses (= Beam-Spitze) über der Pack-Mitte, × Pack-Höhe.
// 0.35 -> 0.12 -> 0.05 -> -0.05 -> jetzt -0.12 (Spitze noch tiefer). Feinjustage hier.
export const BEAM_RIP_HEIGHT_FACTOR = -0.12;
