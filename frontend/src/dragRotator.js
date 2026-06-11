// Eigenes Drag-Handling, das die ROTATION EINES OBJEKTS um die Y-Achse steuert
// (Ersatz für OrbitControls — die Kamera bewegt sich nicht mehr).
//
// Zwei Betriebsarten über attach():
//   Pack  : frei 360° (clampRad=null), keine Feder.
//   Stack : geklemmt (±clampRad), federt beim Loslassen zur Mitte zurück.
// Tap (kaum Bewegung) löst onTap() aus.

import * as THREE from 'three';
import {
  PACK_DRAG_SENSITIVITY,
  TAP_VS_DRAG_THRESHOLD,
  PACK_SPIN_FRICTION,
  PACK_SPIN_MAX_SPEED,
} from './config.js';

export class DragRotator {
  constructor(domElement) {
    this.dom = domElement;
    this.target = null;       // Objekt, dessen rotation.y wir steuern
    this.clampRad = null;     // null = frei; sonst auf ±clampRad begrenzt
    this.spring = false;
    this.stiffness = 0;
    this.damping = 0;
    this.onTap = null;

    this.vel = 0;             // Winkelgeschwindigkeit (Feder bzw. Schwung)
    this.dragging = false;
    this._start = null;
    this._lastMove = null;    // letzte Bewegung (für Momentum-Berechnung)

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    this.dom.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
  }

  /** Hängt den Rotator an ein Zielobjekt mit gegebener Konfiguration. */
  attach(target, { clampRad = null, spring = false, stiffness = 0, damping = 0, onTap = null } = {}) {
    this.target = target;
    this.clampRad = clampRad;
    this.spring = spring;
    this.stiffness = stiffness;
    this.damping = damping;
    this.onTap = onTap;
    this.vel = 0;
    this.dragging = false;
    this._start = null;
  }

  /** Sperrt jede Eingabe (z.B. während Öffnen/Animation). */
  detach() {
    this.target = null;
    this.dragging = false;
    this._start = null;
    this.vel = 0;
  }

  _down(e) {
    if (!this.target) return;
    this.dragging = true;
    this.vel = 0;
    this._lastMove = null;
    this._start = { x: e.clientX, y: e.clientY, rot: this.target.rotation.y, moved: 0 };
  }

  _move(e) {
    if (!this.dragging || !this.target) return;
    const dx = e.clientX - this._start.x;
    const dy = e.clientY - this._start.y;
    this._start.moved = Math.max(this._start.moved, Math.hypot(dx, dy));
    let r = this._start.rot + dx * PACK_DRAG_SENSITIVITY; // nur horizontal -> Y-Achse
    if (this.clampRad != null) r = THREE.MathUtils.clamp(r, -this.clampRad, this.clampRad);

    // Momentum nur für freie Objekte (Pack). Beim Stack (spring) NICHT tracken,
    // damit die Feder unverändert aus der Ruhe zurückschnappt.
    if (!this.spring) {
      const now = performance.now();
      if (this._lastMove) {
        const dt = (now - this._lastMove.time) / 1000;
        if (dt > 0) {
          const v = (r - this._lastMove.rot) / dt;
          this.vel = THREE.MathUtils.clamp(v, -PACK_SPIN_MAX_SPEED, PACK_SPIN_MAX_SPEED);
        }
      }
      this._lastMove = { time: now, rot: r };
    }

    this.target.rotation.y = r;
  }

  _up(e) {
    if (!this.dragging) return;
    this.dragging = false;
    const tap = this._start && this._start.moved < TAP_VS_DRAG_THRESHOLD;
    this._start = null;
    // Nach dem Loslassen aus dem Stand (kurze Pause vor Release) -> kein Spin.
    if (!this.spring && (!this._lastMove || performance.now() - this._lastMove.time > 100)) {
      this.vel = 0;
    }
    if (tap) {
      this.vel = 0; // Tap dreht nicht nach
      // clientX mitgeben (für linke/rechte Tap-Zone beim Karten-Wischen).
      if (this.onTap) this.onTap(e ? e.clientX : 0);
    }
  }

  /** Pro Frame: Feder zur Mitte (Stack) ODER freies Ausdrehen mit Reibung (Pack). */
  update(delta) {
    if (!this.target || this.dragging) return;
    const d = Math.min(delta, 1 / 30); // Stabilität bei Frame-Drops

    if (this.spring) {
      // Stack: unterdämpfte Feder zurück zur Mitte (0°).
      const x = this.target.rotation.y;
      const acc = -this.stiffness * x - this.damping * this.vel;
      this.vel += acc * d;
      this.target.rotation.y = x + this.vel * d;
      if (Math.abs(this.target.rotation.y) < 1e-4 && Math.abs(this.vel) < 1e-4) {
        this.target.rotation.y = 0;
        this.vel = 0;
      }
    } else {
      // Pack: mit Schwung weiterdrehen, exponentiell ausklingen.
      if (Math.abs(this.vel) < 1e-4) {
        this.vel = 0;
        return;
      }
      this.target.rotation.y += this.vel * d;
      this.vel *= Math.exp(-PACK_SPIN_FRICTION * d);
    }
  }
}
