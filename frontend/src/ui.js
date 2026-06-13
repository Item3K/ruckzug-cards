// UI-Overlay (reines DOM über dem Canvas). Modi steuern, was sichtbar ist:
//   select  : Pack-Auswähler + "Öffnen"
//   opening : alles aus, nur Status (Animation/Beam läuft)
//   reveal  : Hinweis + Fortschritt (Tippen zum Aufdecken)
//   done    : Status + "Zurück zur Auswahl"
// Kennt die 3D-Welt nicht — nur Callbacks. Mobil-taugliche Touch-Flächen.

/**
 * @param {object} opts
 * @param {Array<{id:string,label:string}>} opts.packs
 * @param {string} opts.initialId
 * @param {(id:string)=>void} opts.onSelectPack
 * @param {()=>void} opts.onOpen
 * @param {()=>void} opts.onBack
 */
export function createUI({ packs = [], initialId, onSelectPack, onOpen, onBack, showPicker = true }) {
  const root = document.createElement('div');
  root.className = 'ui';

  // --- Pack-Auswähler (optional; auf der Landing-Page wird das Pack gewählt) ---
  const picker = document.createElement('div');
  picker.className = 'pack-picker';
  const packButtons = new Map();
  if (showPicker) {
    for (const pack of packs) {
      const btn = document.createElement('button');
      btn.className = 'pack-btn';
      btn.textContent = pack.label;
      btn.addEventListener('click', () => {
        setActivePack(pack.id);
        onSelectPack(pack.id);
      });
      picker.appendChild(btn);
      packButtons.set(pack.id, btn);
    }
  }
  function setActivePack(id) {
    packButtons.forEach((b, key) => b.classList.toggle('active', key === id));
  }

  // --- Mittiger Hinweis (Reveal) ---
  const hint = document.createElement('div');
  hint.className = 'hint';

  // --- Status-/Fortschrittszeile ---
  const status = document.createElement('div');
  status.className = 'status';

  // Hinweis: Öffnen läuft über Doppel-Tap aufs Pack, Zurück über Auto-Return
  // (nach der letzten Karte) — daher KEINE Öffnen-/Zurück-Buttons mehr.

  root.appendChild(picker);
  root.appendChild(hint);
  root.appendChild(status);
  document.body.appendChild(root);

  setActivePack(initialId);

  function setMode(mode) {
    root.dataset.mode = mode; // CSS blendet je Modus ein/aus
  }
  setMode('select');

  return {
    setActivePack,
    setMode,
    setVisible(b) {
      root.style.display = b ? 'flex' : 'none';
    },
    setStatus(text) {
      status.textContent = text || '';
    },
    setHint(text) {
      hint.textContent = text || '';
    },
    setProgress(revealed, total) {
      status.textContent = `Karte ${Math.min(revealed + 1, total)} / ${total}`;
    },
    setOpenEnabled() {
      // No-op: kein Öffnen-Button mehr (Öffnen via Doppel-Tap).
    },
  };
}
