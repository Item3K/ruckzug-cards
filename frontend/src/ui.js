// UI-Overlay (reines DOM über dem Canvas): Pack-Auswähler + "Öffnen"-Button.
// Kennt die 3D-Welt nicht — kommuniziert nur über Callbacks. So bleibt die
// Bedienung mobil-tauglich (große Touch-Flächen) und 4b kann leicht erweitern.

/**
 * @param {object}   opts
 * @param {Array<{id:string,label:string,file:string}>} opts.packs
 * @param {string}   opts.initialId
 * @param {(file:string,id:string)=>void} opts.onSelectPack
 * @param {()=>void} opts.onOpen
 */
export function createUI({ packs, initialId, onSelectPack, onOpen }) {
  const root = document.createElement('div');
  root.className = 'ui';

  // --- Pack-Auswähler (ein Button je Pack) ---
  const picker = document.createElement('div');
  picker.className = 'pack-picker';

  const packButtons = new Map();
  for (const pack of packs) {
    const btn = document.createElement('button');
    btn.className = 'pack-btn';
    btn.textContent = pack.label;
    btn.addEventListener('click', () => {
      setActivePack(pack.id);
      onSelectPack(pack.file, pack.id);
    });
    picker.appendChild(btn);
    packButtons.set(pack.id, btn);
  }

  function setActivePack(id) {
    packButtons.forEach((b, key) => b.classList.toggle('active', key === id));
  }

  // --- "Öffnen"-Button ---
  const actions = document.createElement('div');
  actions.className = 'actions';

  const openBtn = document.createElement('button');
  openBtn.className = 'open-btn';
  openBtn.textContent = 'Öffnen';
  openBtn.addEventListener('click', () => onOpen());
  actions.appendChild(openBtn);

  root.appendChild(picker);
  root.appendChild(actions);
  document.body.appendChild(root);

  setActivePack(initialId);

  // Steuer-API für main.js (z.B. Button sperren während Ladevorgang / nach Öffnen).
  return {
    setActivePack,
    setOpenEnabled(enabled) {
      openBtn.disabled = !enabled;
    },
    setStatus(text) {
      openBtn.textContent = text;
    },
  };
}
