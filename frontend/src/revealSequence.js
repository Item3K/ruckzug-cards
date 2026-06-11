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
  PACK_FADE_DURATION,
} from './config.js';

const USER_ID = 'test_user_1'; // Platzhalter bis OAuth (Phase 3b)

export class RevealSequence {
  constructor({ viewer, beam, cardStack, rotator, tweens, ui, onAbort }) {
    this.viewer = viewer;
    this.beam = beam;
    this.cardStack = cardStack;
    this.rotator = rotator;
    this.tweens = tweens;
    this.ui = ui;
    this.onAbort = onAbort; // (message) => void: Pack frisch laden + Fehler zeigen
    this.active = false;
    this.result = null;
    this.mode = 'hinten';
  }

  async start(backendPackId) {
    if (this.active) return;
    this.active = true;

    // 1) Welche Seite zeigt gerade zur Kamera? cos(rotY) >= 0 -> vorne (~0°),
    //    sonst hinten (~180°). Grenze liegt bei 90°/270°.
    const target = this.viewer.getRotationTarget();
    const rotY = target?.rotation.y ?? 0;
    this.mode = Math.cos(rotY) >= 0 ? 'vorne' : 'hinten';

    // Zwei feste Blickpunkte: auf EXAKT frontal der erkannten Seite springen
    // (0° = Vorderseite, 180° = Rückseite zur fixen Kamera). So wird NIE schräg
    // geöffnet. Danach Rotation sperren.
    if (target) target.rotation.y = this.mode === 'vorne' ? 0 : Math.PI;
    this.rotator.detach();
    this.ui.setMode('opening');
    this.ui.setStatus('Öffnet …');

    const packH = this.viewer.modelSize.y || 1;
    const ripPosition = new THREE.Vector3(0, packH * BEAM_RIP_HEIGHT_FACTOR, 0);
    const duration = this.viewer.getClipDuration();

    // Karten PARALLEL zur Animation holen (nicht vorher awaiten) -> kein Leerlauf.
    this._cardsReady = openPack(backendPackId, USER_ID);
    this._cardsReady.catch(() => {}); // unhandled rejection vermeiden (Fehler unten)

    // 2) Aufreißen SOFORT starten.
    this.viewer.onFinished(() => this._onPackOpened(packH));
    this.viewer.playOpen();

    // 3) Beam im Riss-Moment — sobald die Karten da sind und ~35 % der Animation um.
    const t0 = performance.now();
    let result;
    try {
      result = await this._cardsReady;
    } catch (e) {
      this._failOpen(e);
      return;
    }
    this.result = result;
    const elapsed = (performance.now() - t0) / 1000;
    const beamAt = Math.max(0, duration * 0.35 - elapsed);
    this.tweens.add({
      delay: beamAt,
      duration: 0.001,
      onUpdate: () => {},
      onComplete: () => this.beam.show(result.beam_stage, ripPosition, packH),
    });

    if (duration <= 0) this._onPackOpened(packH); // kein Clip -> direkt weiter
  }

  _failOpen(e) {
    if (!this.active) return;
    this.active = false;
    // Fehlertext sichtbar im Status (der Hint ist im select-Modus ausgeblendet),
    // damit ein Fehler NIE wie "nichts passiert" aussieht.
    const msg =
      e.status === 400
        ? 'Keine Sanduhren — in /docs via /api/dev/give-hourglasses nachfüllen'
        : `Fehler beim Öffnen: ${e.message}`;
    // Pack frisch laden (es wurde schon angerissen, da Animation parallel lief) und
    // danach den Fehler anzeigen. onAbort kümmert sich um Reload + Status.
    if (this.onAbort) this.onAbort(msg);
    else {
      this.rotator.attach(this.viewer.getRotationTarget());
      this.ui.setMode('select');
      this.ui.setStatus(msg);
    }
  }

  async _onPackOpened(packH) {
    // Karten sollten längst da sein (parallel geholt); zur Sicherheit abwarten.
    let result;
    try {
      result = await this._cardsReady;
    } catch {
      return; // Fehler wurde in start() via _failOpen behandelt
    }
    this.result = result;

    // 4) Pack kurz ausblenden, dann 5) Stapel im erkannten Modus bauen.
    this.tweens.add({
      duration: PACK_FADE_DURATION,
      onUpdate: (p) => this.viewer.setOpacity(1 - p),
      onComplete: () => {
        this.viewer.setOpacity(0);

        this.cardStack.build(result.drawn_cards, this.mode, CARD_VIEW_HEIGHT);
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
        this.ui.setProgress(0, result.drawn_cards.length);
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
