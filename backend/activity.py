"""Agent activity: a step-by-step log of what each agent did, per pet.

Every agent writes events here as it works (received instructions, read the
profile, called the model, asked a question, ...). The owner's activity
drawer reads them back. Events are written on their own connection and
committed straight away, so the drawer can show a run while it's going.
"""

import json

from fastapi import APIRouter

from backend.common import get_pet_row, utc_now_iso
from backend.db import connect

router = APIRouter(prefix="/api")


def log_event(pet_id: int, agent: str, kind: str, message: str,
              run_id: int | None = None, detail: dict | None = None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO agent_events (run_id, pet_id, agent, kind, message, detail, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (run_id, pet_id, agent, kind, message,
             json.dumps(detail) if detail is not None else None, utc_now_iso()),
        )


@router.get("/pets/{pet_id}/agent-events")
def list_events(pet_id: int, after_id: int = 0, limit: int = 200) -> list[dict]:
    """Newest first. `after_id` returns only events newer than that id."""
    with connect() as conn:
        get_pet_row(conn, pet_id)
        rows = conn.execute(
            "SELECT * FROM agent_events WHERE pet_id = ? AND id > ? ORDER BY id DESC LIMIT ?",
            (pet_id, after_id, max(1, min(limit, 500))),
        ).fetchall()
    out = []
    for r in rows:
        e = dict(r)
        e["detail"] = json.loads(e["detail"]) if e["detail"] else None
        out.append(e)
    return out
