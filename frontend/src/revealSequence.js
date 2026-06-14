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
import { resolveSetAsset } from './setLoader.js';
import {
  CARD_VIEW_HEIGHT,
  BEAM_RIP_HEIGHT_FACTOR,
  BEAM_RIP_X_FACTOR,
  PACK_FADE_DURATION,
  AUTO_RETURN_DELAY,
} from './config.js';


export class RevealSequence {
  constructor({ viewer, beam, cardStack, rotator, tweens, ui, onAbort, onComplete }) {
    this.viewer = viewer;
    this.beam = beam;
    this.cardStack = cardStack;
    this.rotator = rotator;
    this.tweens = tweens;
    this.ui = ui;
    this.onAbort = onAbort;       // (message) => void: Pack frisch laden + Fehler zeigen
    this.onComplete = onComplete; // () => void: nach der letzten Karte (Auto-Zurück)
    this.active = false;
    this.result = null;
    this.mode = 'hinten';
    this._autoReturnTimer = null;
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
    const ripPosition = new THREE.Vector3(
      packH * BEAM_RIP_X_FACTOR,
      packH * BEAM_RIP_HEIGHT_FACTOR,
      0,
    );
    const duration = this.viewer.getClipDuration();

    // Reveal-Gate: erst zeigen, wenn BEIDES da ist (Animation fertig + Stapel gebaut).
    this._packOpened = false;
    this._stackReady = false;
    this._revealed = false;

    // Karten PARALLEL zur Animation holen (sofort beim Klick, vor jedem await).
    this._cardsReady = openPack(backendPackId);
    this._cardsReady.catch(() => {}); // unhandled rejection vermeiden (Fehler unten)

    // 2) Aufreißen SOFORT starten.
    this.viewer.onFinished(() => {
      this._packOpened = true;
      this._tryReveal();
    });
    this.viewer.playOpen();
    if (duration <= 0) this._packOpened = true; // kein Clip -> sofort "geöffnet"

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

    // Asset-Pfade der gezogenen Karten zu ladbaren URLs auflösen (Front-PNG).
    const cards = result.drawn_cards.map((c) => ({
      ...c, assetUrl: resolveSetAsset(c.set_id, c.asset),
    }));

    // 4) Stapel JETZT (während der Animation) versteckt vorbauen — die teure Arbeit
    //    (Klonen + Material schon vorkompiliert) überlappt die Ripp-Animation.
    this.cardStack.build(cards, this.mode, CARD_VIEW_HEIGHT, true);
    this._stackReady = true;
    this._tryReveal();
  }

  /** Reveal nur, wenn Animation fertig UND Stapel vorgebaut ist. */
  _tryReveal() {
    if (this._revealed || !this._packOpened || !this._stackReady) return;
    this._revealed = true;

    // 5) Cross-Fade: Karten SOFORT zeigen, Pack gleichzeitig ausblenden.
    this.cardStack.onProgress = (r, t) => this.ui.setProgress(r, t);
    this.cardStack.onDone = () => this._finish();
    this.cardStack.begin();
    this.tweens.add({
      duration: PACK_FADE_DURATION,
      onUpdate: (p) => this.viewer.setOpacity(1 - p),
      onComplete: () => this.viewer.setOpacity(0),
    });

    // 6/7) Reveal-Eingabe: Drag auf Karte = wischen, Drag daneben = Stapel drehen,
    //      Tap auf Rückseite ("hinten") = aufdecken. Alles in cardStack (Raycast).
    this.rotator.detach();
    this.cardStack.enableInput();

    this.ui.setMode('reveal');
    this.ui.setProgress(0, this.result.drawn_cards.length);
    this.ui.setHint(
      this.mode === 'hinten'
        ? 'Tippen: aufdecken · Karte ziehen: wegwischen · daneben ziehen: drehen'
        : 'Karte links/rechts ziehen: wegwischen · daneben ziehen: drehen',
    );
  }

  _failOpen(e) {
    if (!this.active) return;
    this.active = false;
    // Fehlertext sichtbar im Status (der Hint ist im select-Modus ausgeblendet),
    // damit ein Fehler NIE wie "nichts passiert" aussieht.
    const msg =
      e.status === 401
        ? 'Bitte zuerst mit Discord anmelden (Menü oben rechts).'
        : e.status === 400
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

  _finish() {
    this.active = false;
    this.cardStack.disableInput();
    this.rotator.detach();
    this.ui.setMode('done');
    this.ui.setStatus(`Fertig — Sanduhren übrig: ${this.result.hourglasses_remaining}`);
    // Auto-Rückkehr zur Landing-Page nach kurzer Verzögerung (Button bleibt manuell).
    if (this.onComplete) {
      this._autoReturnTimer = setTimeout(() => {
        this._autoReturnTimer = null;
        this.onComplete();
      }, AUTO_RETURN_DELAY * 1000);
    }
  }

  reset() {
    if (this._autoReturnTimer) { clearTimeout(this._autoReturnTimer); this._autoReturnTimer = null; }
    this.rotator.detach();
    this.cardStack.disableInput();
    this.beam.dispose();
    this.cardStack.dispose();
    this.active = false;
    this.result = null;
  }
}
