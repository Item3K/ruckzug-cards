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
export function createUI({ packs, initialId, onSelectPack, onOpen, onBack }) {
  const root = document.createElement('div');
  root.className = 'ui';

  // --- Pack-Auswähler ---
  const picker = document.createElement('div');
  picker.className = 'pack-picker';
  const packButtons = new Map();
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
  function setActivePack(id) {
    packButtons.forEach((b, key) => b.classList.toggle('active', key === id));
  }

  // --- Nudge-Pfeile (markieren die Tap-Zonen links/rechts beim Wegwischen) ---
  const arrowLeft = document.createElement('div');
  arrowLeft.className = 'nudge nudge-left';
  arrowLeft.textContent = '‹';
  const arrowRight = document.createElement('div');
  arrowRight.className = 'nudge nudge-right';
  arrowRight.textContent = '›';

  // --- Mittiger Hinweis (Reveal) ---
  const hint = document.createElement('div');
  hint.className = 'hint';

  // --- Status-/Fortschrittszeile ---
  const status = document.createElement('div');
  status.className = 'status';

  // --- Aktionen unten ---
  const actions = document.createElement('div');
  actions.className = 'actions';

  const openBtn = document.createElement('button');
  openBtn.className = 'open-btn';
  openBtn.textContent = 'Öffnen';
  openBtn.addEventListener('click', () => onOpen());

  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn';
  backBtn.textContent = 'Zurück zur Auswahl';
  backBtn.addEventListener('click', () => onBack());

  actions.appendChild(openBtn);
  actions.appendChild(backBtn);

  root.appendChild(picker);
  root.appendChild(arrowLeft);
  root.appendChild(arrowRight);
  root.appendChild(hint);
  root.appendChild(status);
  root.appendChild(actions);
  document.body.appendChild(root);

  setActivePack(initialId);

  function setMode(mode) {
    root.dataset.mode = mode; // CSS blendet je Modus ein/aus
  }
  setMode('select');

  return {
    setActivePack,
    setMode,
    setStatus(text) {
      status.textContent = text || '';
    },
    setHint(text) {
      hint.textContent = text || '';
    },
    setProgress(revealed, total) {
      status.textContent = `Karte ${Math.min(revealed + 1, total)} / ${total}`;
    },
    setOpenEnabled(enabled) {
      openBtn.disabled = !enabled;
    },
    setArrows(visible, leftX, rightX) {
      root.classList.toggle('arrows-on', !!visible);
      if (visible && Number.isFinite(leftX) && Number.isFinite(rightX)) {
        // Pfeile direkt neben die linke/rechte Kartenkante setzen.
        arrowLeft.style.left = `${leftX - 38}px`;
        arrowRight.style.left = `${rightX + 8}px`;
      }
    },
  };
}
