// Winziger Tween-Helfer (keine externe Lib). Wird vom Render-Loop pro Frame
// mit delta gefüttert und treibt alle laufenden Tweens. Reicht für die
// Reveal-Animationen (Flip, Wegschieben, Beam-Auf/Ab, Kartennachrücken).

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class TweenManager {
  constructor() {
    this.items = new Set();
  }

  /**
   * @param {object} opts
   * @param {number} opts.duration  Sekunden
   * @param {(p:number)=>void} opts.onUpdate  p = geglätteter Fortschritt 0..1
   * @param {()=>void} [opts.onComplete]
   * @param {(t:number)=>number} [opts.ease]
   * @param {number} [opts.delay]  Sekunden Verzögerung vor Start
   * @returns {object} handle (zum optionalen Abbrechen via cancel())
   */
  add({ duration, onUpdate, onComplete, ease = easeInOutCubic, delay = 0 }) {
    const item = { t: -delay, duration, onUpdate, onComplete, ease, done: false };
    this.items.add(item);
    return item;
  }

  cancel(item) {
    this.items.delete(item);
  }

  update(delta) {
    for (const it of this.items) {
      it.t += delta;
      if (it.t < 0) continue;
      const p = it.duration > 0 ? Math.min(it.t / it.duration, 1) : 1;
      it.onUpdate(it.ease(p), p);
      if (p >= 1) {
        this.items.delete(it);
        it.onComplete && it.onComplete();
      }
    }
  }

  clear() {
    this.items.clear();
  }
}
