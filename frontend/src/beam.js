// Light-Beam nach ROADMAP §6:
// - Plane mit Beam-PNG, HINTER dem Pack (Ursprung verdeckt), Spitze am Riss.
// - AdditiveBlending + depthWrite:false, zur Kamera ausgerichtet (Billboard).
// - Im Riss-Moment Opacity + Skalierung hoch, dann abblenden.
// Stufen kommen vom Server (beam_stage): normal = kein/kaum Beam,
// selten = weißer Beam, jackpot = goldener Beam (heller, größer).

import * as THREE from 'three';
import { BEAM_INTENSITY, BEAM_SCALE, BEAM_DURATION } from './config.js';

// Fallback-Seitenverhältnis (Breite/Höhe) der Beam-PNGs (3072×4096), falls die Textur
// beim ersten Anzeigen noch nicht geladen ist (sonst wird es aus tex.image gelesen).
const BEAM_TEX_ASPECT = 3072 / 4096;

const BEAM_TEX = {
  selten: '/textures/beam_weiss_4k.png',
  jackpot: '/textures/beam_gold_4k.png',
};

// Beam-Texturen MODULWEIT teilen (nicht pro Beam-Instanz neu laden) — sonst würden
// beim x10 bis zu 10 große 4K-Texturen pro Durchlauf erneut geladen (Lag/verzögerte
// Beams). Eine geteilte Textur pro Stufe, gecached.
const _beamLoader = new THREE.TextureLoader();
const _beamTexCache = {};

function loadBeamTexture(stage) {
  if (!_beamTexCache[stage]) {
    const tex = _beamLoader.load(BEAM_TEX[stage]);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Ränder NICHT kacheln/spiegeln -> an den Kanten sauberer (transparenter) Auslauf.
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    _beamTexCache[stage] = tex;
  }
  return _beamTexCache[stage];
}

/** Beam-Texturen vorab laden + (falls renderer da) auf die GPU hochladen. */
export function preloadBeamTextures(renderer) {
  for (const stage of Object.keys(BEAM_TEX)) {
    const tex = loadBeamTexture(stage);
    if (renderer) renderer.initTexture(tex);
  }
}

// Pro Stufe: Spitzen-Deckkraft und Skalierungs-Faktor (jackpot kräftiger).
const STAGE_PARAMS = {
  normal: { peak: 0.0, scale: 1.0 }, // kaum/kein Beam
  selten: { peak: 0.85, scale: 1.0 },
  jackpot: { peak: 1.0, scale: 1.25 },
};

export class Beam {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.mesh = null;
    this.material = null;
    this.t = 0;
    this.active = false;
    this.stage = 'normal';
    this._baseScale = 1;
    this._params = STAGE_PARAMS.normal;
  }

  _getTexture(stage) {
    return loadBeamTexture(stage); // geteilte, gecachte Textur
  }

  /**
   * Beam vorbereiten und starten.
   * @param {string} stage  'normal' | 'selten' | 'jackpot'
   * @param {THREE.Vector3} ripPosition  Weltposition des Risses (Beam-Spitze)
   * @param {number} packHeight  Höhe des Packs (zur Beam-Größe)
   */
  show(stage, ripPosition, packHeight) {
    this.dispose();
    this.stage = stage;
    this._params = STAGE_PARAMS[stage] || STAGE_PARAMS.normal;
    if (!BEAM_TEX[stage] || this._params.peak <= 0) {
      // Stufe "normal": kein Beam.
      this.active = false;
      return;
    }

    // BEAM_SCALE/BEAM_INTENSITY live aus der Config (Dev-Panel) übernehmen.
    this._peak = this._params.peak * BEAM_INTENSITY;
    const height = packHeight * 2.2 * this._params.scale * BEAM_SCALE;
    // Plane an das SEITENVERHÄLTNIS der Textur koppeln (sonst horizontales Quetschen ->
    // seitlicher Auslauf wirkt hart abgeschnitten). Aspekt aus der geladenen Textur lesen.
    const tex = this._getTexture(stage);
    const aspect = (tex.image && tex.image.width) ? tex.image.width / tex.image.height : BEAM_TEX_ASPECT;
    const width = height * aspect;
    const geo = new THREE.PlaneGeometry(width, height);
    // Pivot an die Spitze legen: Geometrie so verschieben, dass die untere
    // Kante (Spitze des Kegel-PNG) im Ursprung des Mesh sitzt -> Spitze bleibt
    // beim Billboarden am Riss.
    geo.translate(0, height / 2, 0);

    this.material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,   // §6
      depthTest: true,     // Pack verdeckt den Beam, bis es aufreißt
      opacity: 0,
      side: THREE.DoubleSide,
      toneMapped: false,   // Beam soll knallen, nicht vom Tone-Mapping gedämpft
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    // Spitze an den Riss, leicht HINTER das Pack (kleineres z = weg von der Kamera).
    this.mesh.position.copy(ripPosition);
    this.mesh.position.z -= packHeight * 0.15;
    this.mesh.renderOrder = -1; // hinter den Karten/Pack einsortiert
    this.scene.add(this.mesh);

    this._baseScale = 1;
    this.t = 0;
    this.active = true;
  }

  update(delta) {
    if (!this.active || !this.mesh) return;
    this.t += delta;
    const p = Math.min(this.t / BEAM_DURATION, 1);

    // Billboard: immer zur Kamera ausrichten (Spitze bleibt durch Pivot am Riss).
    this.mesh.quaternion.copy(this.camera.quaternion);

    // Schnelles Aufblenden (feste kurze Zeit), danach LANGES Ausfaden über den Rest von
    // BEAM_DURATION -> sanfteres, längeres Auslaufen (justierbar via BEAM_DURATION).
    const RISE = 0.22;
    let opacity;
    if (this.t < RISE) opacity = (this.t / RISE) * this._peak;
    else opacity = this._peak * (1 - (this.t - RISE) / Math.max(0.001, BEAM_DURATION - RISE));
    this.material.opacity = Math.max(0, opacity);

    // Skalierung: von klein auf groß wachsen lassen.
    const s = (0.6 + 0.6 * p) * this._params.scale;
    this.mesh.scale.set(s, s, s);

    if (p >= 1) {
      this.active = false;
      this.mesh.visible = false;
    }
  }

  dispose() {
    this.active = false;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }
}
