"""RuckZUG Cards — Web-Backend (FastAPI).

Phase 0: Grundgerüst mit /health.
Phase 3a: serverseitiges Pack-Öffnen (POST /api/open-pack) — die gesamte
Zufalls-/Wahrscheinlichkeitslogik liegt im Backend (ROADMAP §6, Cheat-Schutz),
NIE im Frontend. OAuth folgt in Phase 3b; bis dahin kommt die user_id als
Parameter rein (klar als Platzhalter markiert).

Lokal starten (aus dem backend-Ordner)::

    uvicorn main:app --reload

Endpoints im Browser testbar über die Auto-Doku: http://127.0.0.1:8000/docs
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db
import pack_logic

app = FastAPI(title="RuckZUG Cards API", version="0.3.0")

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


# =====================================================================
# Pack öffnen (Phase 3a)
# =====================================================================
class OpenPackRequest(BaseModel):
    pack_id: str = Field(..., examples=["pack_wald"])
    # TODO(Phase 3b/OAuth): user_id NICHT vom Client annehmen! Sie kommt dann
    # verifiziert aus der Discord-OAuth-Session. Bis dahin Platzhalter-Parameter,
    # damit der Flow lokal testbar ist.
    user_id: str = Field(..., examples=["test_user_1"])


@app.post("/api/open-pack")
def open_pack(req: OpenPackRequest) -> dict:
    """Öffnet ein Pack serverseitig: zieht Sanduhr, würfelt Karten, verbucht sie.

    Gibt die gezogenen Karten, die Beam-Stufe und den neuen Sanduhr-Stand zurück.
    Würfeln/Wahrscheinlichkeiten passieren ausschließlich hier im Backend.
    """
    try:
        return pack_logic.open_pack(user_id=req.user_id, pack_id=req.pack_id)
    except pack_logic.PackError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


# =====================================================================
# DEV-ONLY Helfer
# TODO: vor Live ENTFERNEN oder hinter Admin-Auth absichern! Dieser Endpoint
# vergibt ungeprüft Sanduhren und darf niemals öffentlich erreichbar sein.
# =====================================================================
class GiveHourglassesRequest(BaseModel):
    user_id: str = Field(..., examples=["test_user_1"])
    amount: int = Field(..., gt=0, examples=[5])


@app.post("/api/dev/give-hourglasses")
def dev_give_hourglasses(req: GiveHourglassesRequest) -> dict:
    """DEV-ONLY: schreibt einem User Sanduhren gut (zum lokalen Testen)."""
    with db.connection() as conn:
        conn.execute(
            "INSERT INTO hourglasses (user_id, count, updated_at) "
            "VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(user_id) DO UPDATE SET "
            "count = count + excluded.count, updated_at = datetime('now')",
            (req.user_id, req.amount),
        )
        new_count = conn.execute(
            "SELECT count FROM hourglasses WHERE user_id = ?", (req.user_id,)
        ).fetchone()["count"]
    return {"user_id": req.user_id, "hourglasses": new_count}
