"""RuckZUG Cards — Web-Backend (FastAPI).

Phase 0: nur ein Grundgerüst mit einem /health-Endpoint.
Noch KEINE Spiel-Logik, kein Pack-Öffnen, kein OAuth (kommt in Phase 3).

Lokal starten (aus dem backend-Ordner)::

    uvicorn main:app --reload

Dann im Browser/curl: http://127.0.0.1:8000/health  -> {"status":"ok"}
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="RuckZUG Cards API", version="0.1.0")

# Für lokale Entwicklung: Vite-Dev-Server darf das Backend ansprechen.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness-Check. Gibt {"status": "ok"} zurück."""
    return {"status": "ok"}
