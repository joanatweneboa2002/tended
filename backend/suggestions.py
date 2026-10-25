"""Health-log suggestions from the Watchdog: approve or dismiss with one tap.

The Watchdog only stores suggestions as *pending*. A health-log entry is
written here, and only when a person approves it.
"""

import json

from fastapi import APIRouter, HTTPException

from backend.activity import log_event
from backend.common import get_pet_row, person_name, utc_now_iso
from backend.db import connect

router = APIRouter(prefix="/api")

FIELDS = ("appetite", "water", "energy", "potty", "weight", "symptoms")


def _out(row) -> dict:
    s = dict(row)
    s["fields"] = json.loads(s["fields"])
    return s


@router.get("/pets/{pet_id}/log-suggestions")
def list_suggestions(pet_id: int, status: str = "pending") -> list[dict]:
    with connect() as conn:
        get_pet_row(conn, pet_id)
        rows = conn.execute(
            "SELECT * FROM log_suggestions WHERE pet_id = ? AND status = ? ORDER BY log_date, id",
            (pet_id, status)).fetchall()
    return [_out(r) for r in rows]


def _pending(conn, sid: int):
    row = conn.execute("SELECT * FROM log_suggestions WHERE id = ?", (sid,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Suggestion {sid} not found.")
    if row["status"] != "pending":
        raise HTTPException(409, f"This suggestion was already {row['status']}.")
    return row


@router.post("/log-suggestions/{sid}/approve")
def approve(sid: int) -> dict:
    with connect() as conn:
        row = _pending(conn, sid)
        pet = get_pet_row(conn, row["pet_id"])
        f = json.loads(row["fields"])
        who = person_name(conn, pet, "caretaker")
        log_id = conn.execute(
            "INSERT INTO health_logs (pet_id, log_date, logged_at, logged_by, weight, weight_unit, appetite, water, "
            "energy, potty, symptoms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (pet["id"], row["log_date"], utc_now_iso(), f"{who} (from chat)", f.get("weight"), pet["weight_unit"],
             f.get("appetite"), f.get("water"), f.get("energy"), f.get("potty"), f.get("symptoms", "")),
        ).lastrowid
        conn.execute("UPDATE log_suggestions SET status = 'approved', health_log_id = ?, decided_at = ? WHERE id = ?",
                     (log_id, utc_now_iso(), sid))
        out = _out(conn.execute("SELECT * FROM log_suggestions WHERE id = ?", (sid,)).fetchone())
    log_event(pet["id"], "watchdog", "approved",
              f"{who} approved a health-log entry for {row['log_date']} ("
              + ", ".join(f"{k} {v}" for k, v in f.items()) + "). Saved.", row["run_id"])
    return out


@router.post("/log-suggestions/{sid}/dismiss")
def dismiss(sid: int) -> dict:
    with connect() as conn:
        row = _pending(conn, sid)
        conn.execute("UPDATE log_suggestions SET status = 'dismissed', decided_at = ? WHERE id = ?", (utc_now_iso(), sid))
        out = _out(conn.execute("SELECT * FROM log_suggestions WHERE id = ?", (sid,)).fetchone())
    log_event(row["pet_id"], "watchdog", "removed",
              f"Caretaker dismissed the suggested health-log entry for {row['log_date']}. Nothing logged.", row["run_id"])
    return out
