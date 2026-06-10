// Orchestriert den vollen 4b-Ablauf in genau dieser Reihenfolge:
//   1. ÖFFNEN -> Kamera fixieren (OrbitControls aus)
//   2. Aufreiß-Animation des Packs (animations[0])
//   3. Beam im Riss-Moment (PNG, Stufe vom Server: normal/selten/jackpot)
//   4. Pack ausblenden
//   5. 10 Karten als gestaffelter Stapel (Rückseite zur Kamera)
//   6. Stapel leicht drehbar
//   7. Durchklicken: Flip -> zeigen -> wegschieben -> nächste; am Ende: fertig
//
// Karten + beam_stage kommen vom Server (POST /api/open-pack, Phase 3a).

import * as THREE from 'three';
import { openPack } from './api.js';

// Platzhalter bis OAuth (Phase 3b) — Test-User wie in 3a.
const USER_ID = 'test_user_1';

export class RevealSequence {
  constructor({ camera, controls, viewer, beam, cardStack, tweens, ui, onComplete }) {
    this.camera = camera;
    this.controls = controls;
    this.viewer = viewer;
    this.beam = beam;
    this.cardStack = cardStack;
    this.tweens = tweens;
    this.ui = ui;
    this.onComplete = onComplete;
    this.active = false;
    this.result = null;
  }

  /** Startet die Sequenz für eine Backend-pack_id. */
  async start(backendPackId) {
    if (this.active) return;
    this.active = true;

    // 1) Kamera fixieren — ab jetzt kein freies Drehen mehr.
    this.controls.enabled = false;
    this.ui.setMode('opening');
    this.ui.setStatus('Öffne …');

    // Karten + Beam-Stufe serverseitig holen (VOR der Animation, §6).
    try {
      this.result = await openPack(backendPackId, USER_ID);
    } catch (e) {
      // Fehler (z.B. keine Sanduhren) -> zurück zur Auswahl.
      this.controls.enabled = true;
      this.active = false;
      this.ui.setMode('select');
      this.ui.setStatus('Öffnen');
      this.ui.setHint(
        e.status === 400
          ? 'Keine Sanduhren mehr — über /api/dev/give-hourglasses nachfüllen.'
          : `Fehler: ${e.message}`,
      );
      return;
    }

    const packH = this.viewer.modelSize.y || 1;
    const ripPosition = new THREE.Vector3(0, packH * 0.35, 0); // Riss nahe Pack-Oberkante
    const duration = this.viewer.getClipDuration();

    // 2) Aufreiß-Animation; am Ende -> Pack ausblenden + Stapel.
    this.viewer.onFinished(() => this._onPackOpened(packH));
    this.viewer.playOpen();

    // 3) Beam im Riss-Moment (etwa bei 35 % der Animation).
    if (duration > 0) {
      this.tweens.add({
        delay: duration * 0.35,
        duration: 0.001,
        onUpdate: () => {},
        onComplete: () => this.beam.show(this.result.beam_stage, ripPosition, packH),
      });
    } else {
      // Kein Animations-Clip: Beam sofort, dann direkt weiter.
      this.beam.show(this.result.beam_stage, ripPosition, packH);
      this._onPackOpened(packH);
    }
  }

  _onPackOpened(packH) {
    // 4) Pack ausblenden, dann 5) Stapel bauen.
    this.tweens.add({
      duration: 0.4,
      onUpdate: (p) => this.viewer.setOpacity(1 - p),
      onComplete: () => {
        this.viewer.setOpacity(0);

        const cardHeight = packH * 0.7;
        this.cardStack.build(this.result.drawn_cards, cardHeight);
        this.cardStack.onProgress = (r, t) => this.ui.setProgress(r, t);
        this.cardStack.onDone = () => this._finish();
        this.cardStack.enableInput(); // 6) + 7) Drehen + Tap-Aufdecken

        this.ui.setMode('reveal');
        this.ui.setProgress(0, this.result.drawn_cards.length);
        this.ui.setHint('Tippen zum Aufdecken · ziehen zum Drehen');
      },
    });
  }

  _finish() {
    this.active = false;
    this.ui.setMode('done');
    this.ui.setStatus(`Fertig — Sanduhren übrig: ${this.result.hourglasses_remaining}`);
  }

  /** Räumt Beam + Stapel ab und gibt die Kamera wieder frei (zurück zur Auswahl). */
  reset() {
    this.beam.dispose();
    this.cardStack.dispose();
    this.controls.enabled = true;
    this.active = false;
    this.result = null;
  }
}
