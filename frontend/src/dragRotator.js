// Eigenes Drag-Handling, das die ROTATION EINES OBJEKTS um die Y-Achse steuert
// (Ersatz für OrbitControls — die Kamera bewegt sich nicht mehr).
//
// Zwei Betriebsarten über attach():
//   Pack  : frei 360° (clampRad=null), keine Feder.
//   Stack : geklemmt (±clampRad), federt beim Loslassen zur Mitte zurück.
// Tap (kaum Bewegung) löst onTap() aus.

import * as THREE from 'three';
import { DRAG_SENSITIVITY, TAP_THRESHOLD_PX } from './config.js';

export class DragRotator {
  constructor(domElement) {
    this.dom = domElement;
    this.target = null;       // Objekt, dessen rotation.y wir steuern
    this.clampRad = null;     // null = frei; sonst auf ±clampRad begrenzt
    this.spring = false;
    this.stiffness = 0;
    this.damping = 0;
    this.onTap = null;

    this.vel = 0;             // Winkelgeschwindigkeit (für die Feder)
    this.dragging = false;
    this._start = null;

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
    this._start = { x: e.clientX, y: e.clientY, rot: this.target.rotation.y, moved: 0 };
  }

  _move(e) {
    if (!this.dragging || !this.target) return;
    const dx = e.clientX - this._start.x;
    const dy = e.clientY - this._start.y;
    this._start.moved = Math.max(this._start.moved, Math.hypot(dx, dy));
    let r = this._start.rot + dx * DRAG_SENSITIVITY; // nur horizontal -> Y-Achse
    if (this.clampRad != null) r = THREE.MathUtils.clamp(r, -this.clampRad, this.clampRad);
    this.target.rotation.y = r;
  }

  _up() {
    if (!this.dragging) return;
    this.dragging = false;
    const tap = this._start && this._start.moved < TAP_THRESHOLD_PX;
    this._start = null;
    if (tap && this.onTap) this.onTap();
  }

  /** Pro Frame: Feder zur Mitte (nur wenn nicht gezogen und spring aktiv). */
  update(delta) {
    if (!this.target || this.dragging || !this.spring) return;
    const d = Math.min(delta, 1 / 30); // Stabilität bei Frame-Drops
    const x = this.target.rotation.y;
    const acc = -this.stiffness * x - this.damping * this.vel;
    this.vel += acc * d;
    this.target.rotation.y = x + this.vel * d;
    if (Math.abs(this.target.rotation.y) < 1e-4 && Math.abs(this.vel) < 1e-4) {
      this.target.rotation.y = 0;
      this.vel = 0;
    }
  }
}
