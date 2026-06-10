# RuckZUG Cards

Sammelkarten-System für den RuckZUG-Discord-Server. Booster-Packs werden auf einer
Website in **3D** geöffnet (Three.js), das **Backend** (FastAPI) würfelt serverseitig
die Karten und verwaltet die Bestände in einer eigenen Datenbank **`cards.db`**.

Dieses Repo enthält den **Web-Teil** (Frontend + Backend + Datenmodell). Der bestehende
Discord-Bot lebt in einem **separaten Repo** und bekommt später nur einen neuen Cog
(siehe [`ROADMAP.md`](ROADMAP.md) §3.7 und Phase 6).

> Die [`ROADMAP.md`](ROADMAP.md) ist die Projekt-Bibel und hat in allem Vorrang.

## Projektstruktur

```
ruckzug-cards/
├─ frontend/        # Vite + Three.js (3D-Pack-Opening). Aktuell: leere Szene.
│  ├─ index.html
│  ├─ vite.config.js
│  └─ src/main.js
├─ backend/         # FastAPI + Datenmodell (cards.db)
│  ├─ main.py       # FastAPI-App mit /health
│  ├─ db.py         # gemeinsamer DB-Zugriffs-Layer (WAL + busy_timeout)
│  ├─ schema.sql    # Tabellen für cards.db
│  ├─ init_db.py    # legt cards.db an + erstellt Tabellen
│  ├─ seed.py       # spielt Testdaten ein
│  └─ requirements.txt
├─ SCHEMA.md        # Doku des Datenmodells
├─ ROADMAP.md       # Projekt-Bibel
├─ .env.example     # Vorlage für Secrets (echte .env wird NIE committet)
└─ .gitignore
```

## Voraussetzungen

- **Python 3.10+** (für das Backend)
- **Node.js 18+** (für das Frontend / Vite)

## Backend starten (FastAPI)

```bash
cd backend

# Virtuelle Umgebung anlegen (einmalig)
python -m venv venv
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# macOS/Linux:
# source venv/bin/activate

pip install -r requirements.txt

# 1) Datenbank anlegen (erzeugt cards.db im WAL-Modus)
python init_db.py

# 2) Testdaten einspielen
python seed.py

# 3) API starten
uvicorn main:app --reload
```

Test: <http://127.0.0.1:8000/health> → liefert `{"status":"ok"}`
(API-Doku automatisch unter <http://127.0.0.1:8000/docs>).

## Frontend starten (Vite + Three.js)

```bash
cd frontend
npm install
npm run dev
```

Vite öffnet (standardmäßig) <http://127.0.0.1:5173> und zeigt eine leere 3D-Szene
mit Hilfsgitter. Das Frontend proxyt `/api/*` an das Backend (siehe
[`frontend/vite.config.js`](frontend/vite.config.js)), Backend also parallel laufen lassen.

## Konfiguration / Secrets

Kopiere [`.env.example`](.env.example) nach `.env` und trage Werte ein. Die echte
`.env` und alle `*.db`-Dateien sind in [`.gitignore`](.gitignore) ausgeschlossen und
werden **nie** committet.

## Datenbank prüfen

```bash
cd backend
# WAL-Modus bestätigen:
sqlite3 cards.db "PRAGMA journal_mode;"          # -> wal
# Tabellen auflisten:
sqlite3 cards.db ".tables"
# Testdaten ansehen:
sqlite3 cards.db "SELECT name FROM sets; SELECT name FROM packs; SELECT name, rarity, pack_exclusive_to FROM card_defs;"
```

Mehr zum Datenmodell: [`SCHEMA.md`](SCHEMA.md).

## Aktueller Stand

- **Phase 0** ✓ Projektgerüst (Frontend leere Szene, Backend `/health`).
- **Phase 1** ✓ Datenmodell `cards.db` (Schema, Zugriffs-Layer, Init- & Seed-Skript).

Nächste Phasen siehe [`ROADMAP.md`](ROADMAP.md) §8.
