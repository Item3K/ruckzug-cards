// Orchestriert den 4b-Ablauf:
//   1. ÖFFNEN -> aktuelle Pack-Seite erkennen (vorne/hinten), Rotation sperren.
//   2. Aufreiß-Animation (nur frontal von der erkannten Seite zu sehen).
//   3. Beam im Riss-Moment (Stufe vom Server).
//   4. Pack ausblenden.
//   5. 10 Karten als gestaffelter Stapel (Seite bestimmt vorne/hinten-Reveal).
//   6. Stapel horizontal drehbar (±Grenze, federt zurück) — via DragRotator.
//   7. Durchklicken (Tap) -> am Ende fertig.

import * as THREE from 'three';
import { openPack } from './api.js';
import {
  CARD_VIEW_HEIGHT,
  BEAM_RIP_HEIGHT_FACTOR,
  STACK_MAX_ANGLE_RAD,
  STACK_SPRING_STIFFNESS,
  STACK_SPRING_DAMPING,
} from './config.js';

const USER_ID = 'test_user_1'; // Platzhalter bis OAuth (Phase 3b)

export class RevealSequence {
  constructor({ viewer, beam, cardStack, rotator, tweens, ui }) {
    this.viewer = viewer;
    this.beam = beam;
    this.cardStack = cardStack;
    this.rotator = rotator;
    this.tweens = tweens;
    this.ui = ui;
    this.active = false;
    this.result = null;
    this.mode = 'hinten';
  }

  async start(backendPackId) {
    if (this.active) return;
    this.active = true;

    // 1) Welche Seite zeigt gerade zur Kamera? cos(rotY) >= 0 -> vorne (~0°),
    //    sonst hinten (~180°). Grenze liegt bei 90°/270°.
    const rotY = this.viewer.getRotationTarget()?.rotation.y ?? 0;
    this.mode = Math.cos(rotY) >= 0 ? 'vorne' : 'hinten';

    // Rotation sperren (Kamera steht ohnehin fest, Seite ist jetzt gelockt).
    this.rotator.detach();
    this.ui.setMode('opening');
    this.ui.setStatus(`Öffne … (${this.mode})`);

    try {
      this.result = await openPack(backendPackId, USER_ID);
    } catch (e) {
      this.active = false;
      this.rotator.attach(this.viewer.getRotationTarget()); // Pack wieder frei drehbar
      this.ui.setMode('select');
      // In den sichtbaren Status schreiben (der Hint ist im select-Modus ausgeblendet),
      // damit ein Fehler NIE wie "nichts passiert" aussieht.
      this.ui.setStatus(
        e.status === 400
          ? 'Keine Sanduhren — in /docs via /api/dev/give-hourglasses nachfüllen'
          : `Fehler beim Öffnen: ${e.message}`,
      );
      this.ui.setHint('');
      return;
    }

    const packH = this.viewer.modelSize.y || 1;
    const ripPosition = new THREE.Vector3(0, packH * BEAM_RIP_HEIGHT_FACTOR, 0);
    const duration = this.viewer.getClipDuration();

    // 2) Aufreißen.
    this.viewer.onFinished(() => this._onPackOpened(packH));
    this.viewer.playOpen();

    // 3) Beam etwa bei 35 % der Animation.
    if (duration > 0) {
      this.tweens.add({
        delay: duration * 0.35,
        duration: 0.001,
        onUpdate: () => {},
        onComplete: () => this.beam.show(this.result.beam_stage, ripPosition, packH),
      });
    } else {
      this.beam.show(this.result.beam_stage, ripPosition, packH);
      this._onPackOpened(packH);
    }
  }

  _onPackOpened(packH) {
    // 4) Pack ausblenden, dann 5) Stapel im erkannten Modus bauen.
    this.tweens.add({
      duration: 0.4,
      onUpdate: (p) => this.viewer.setOpacity(1 - p),
      onComplete: () => {
        this.viewer.setOpacity(0);

        this.cardStack.build(this.result.drawn_cards, this.mode, CARD_VIEW_HEIGHT);
        this.cardStack.onProgress = (r, t) => this.ui.setProgress(r, t);
        this.cardStack.onDone = () => this._finish();

        // 6) Stapel horizontal drehbar (geklemmt + Feder), 7) Tap deckt auf.
        this.rotator.attach(this.cardStack.getRotationTarget(), {
          clampRad: STACK_MAX_ANGLE_RAD,
          spring: true,
          stiffness: STACK_SPRING_STIFFNESS,
          damping: STACK_SPRING_DAMPING,
          onTap: () => this.cardStack.advance(),
        });

        this.ui.setMode('reveal');
        this.ui.setProgress(0, this.result.drawn_cards.length);
        this.ui.setHint(
          this.mode === 'hinten'
            ? 'Tippen zum Aufdecken · ziehen zum Drehen'
            : 'Tippen für die nächste Karte · ziehen zum Drehen',
        );
      },
    });
  }

  _finish() {
    this.active = false;
    this.rotator.detach();
    this.ui.setMode('done');
    this.ui.setStatus(`Fertig — Sanduhren übrig: ${this.result.hourglasses_remaining}`);
  }

  reset() {
    this.rotator.detach();
    this.beam.dispose();
    this.cardStack.dispose();
    this.active = false;
    this.result = null;
  }
}
