// Responsive 3D-Einpassung: passt die Kamera-DISTANZ ans Seitenverhältnis an, damit
// Objekte im schmalen Hochformat (Handy/Tablet) nicht zu groß/nah wirken.
//
// Hintergrund: Die PerspectiveCamera hat ein VERTIKALES FOV — die vertikale Einpassung
// ist also aspect-unabhängig, nur die Breite wird im Hochformat eng. Wir ziehen die
// Kamera daher nur dann weiter weg, wenn der Viewport schmaler wird als das Objekt.
//
// Die config.js-Werte bleiben die Basis-Kalibrierung (für Querformat/PC); hier wird NUR
// relativ dazu skaliert. Bei Querformat ist der Faktor exakt 1 -> nichts ändert sich.

/**
 * @param {number} aspect        Viewport-Seitenverhältnis (Breite/Höhe)
 * @param {number} contentAspect Objekt-Seitenverhältnis (Breite/Höhe), z.B. Pack/Karte
 * @param {number} [margin=1]    >1 = etwas Luft; das Objekt füllt die Breite nur bis ~1/margin
 * @returns {number} Faktor >= 1 auf die Basis-Kamera-Distanz
 */
export function aspectFitFactor(aspect, contentAspect, margin = 1) {
  if (!(aspect > 0) || !(contentAspect > 0)) return 1;
  // Sobald das Bild schmaler wird als das (mit Luft versehene) Objekt -> weiter weg.
  return Math.max(1, (contentAspect * margin) / aspect);
}
