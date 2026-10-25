"""FastAPI backend for Tended.

Run from the repo folder (one process, no auto-reloader):
    uvicorn backend.main:app --port 8000

The meds rule lives in `create_checkin`: once a meds task's dose is marked
given for a day's time slot, any further check-in for that slot is blocked.
Each task happens once a day, so the slot is (task, date); a twice-daily med
is two tasks. Keying on the date (not the time) means moving a task's time
after a dose was given can't open a second slot that day. The database has
a unique index (one_dose_per_slot) as a second line of defence.
"""

import sqlite3
from contextlib import asynccontextmanager
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from backend import (
    activity,
    appointments,
    coordinator,
    dashboard,
    health,
    helper_agent,
    messages,
    setup_agent,
    suggestions,
)
from backend.common import (
    day_tasks,
    get_pet_row,
    parse_day,
    pet_out,
    read_photo,
    remove_photo,
    save_photo,
    utc_now_iso,
    with_photo_url,
)
from backend.config import LOADED_ENV_FILES, PHOTOS_DIR, AIUnavailable, ai_provider, ai_status_line
from backend.db import connect, init_db, task_runs_on
from backend.schemas import TaskIn, insert_task
from backend.seed import reset_sample_data, seed_if_empty
from backend.token_log import ensure_token_log


def _ai_status() -> dict:
    """Which AI provider/model is in use. Never includes the key."""
    try:
        p = ai_provider()
        return {"ai_ready": True, "ai_provider": p.name, "ai_model": p.model, "ai_message": None}
    except AIUnavailable as exc:
        return {"ai_ready": False, "ai_provider": None, "ai_model": None, "ai_message": str(exc)}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    print(ai_status_line(), flush=True)
    init_db()
    seed_if_empty()
    ensure_token_log()
    yield


app = FastAPI(title="Tended API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/photos", StaticFiles(directory=PHOTOS_DIR), name="photos")
app.include_router(dashboard.router)
app.include_router(appointments.router)
app.include_router(health.router)
app.include_router(messages.router)
app.include_router(activity.router)
app.include_router(setup_agent.router)
app.include_router(helper_agent.router)
app.include_router(coordinator.router)
app.include_router(suggestions.router)


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class PetIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    species: str = Field(min_length=1, max_length=40)
    breed: str = ""
    age_years: float | None = Field(default=None, ge=0, le=100)
    weight: float | None = Field(default=None, gt=0, le=1000)
    weight_unit: Literal["lb", "kg"] = "lb"
    quirks: str = ""
    owner_timezone: str = "America/New_York"
    home_timezone: str = "America/New_York"
    caretaker_name: str = Field(default="", max_length=80)

    @field_validator("owner_timezone", "home_timezone")
    @classmethod
    def valid_timezone(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"Unknown time zone '{v}'.") from None
        return v


class EmergencyIn(BaseModel):
    owner_name: str = ""
    owner_phone: str = ""
    backup_name: str = ""
    backup_phone: str = ""
    vet_name: str = ""
    vet_phone: str = ""
    vet_address: str = ""
    allergies: str = ""
    conditions: str = ""
    medications: str = ""
    vaccines: str = ""
    diet: str = ""
    emergency_spending_limit: float | None = Field(default=None, ge=0)
    microchip_number: str = ""


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@app.get("/api/status")
def status() -> dict:
    """What the backend sees. Never returns the key itself."""
    return {
        "ok": True,
        **_ai_status(),
        "env_files_loaded": [str(p) for p in LOADED_ENV_FILES],
    }


# ---------------------------------------------------------------------------
# Pets
# ---------------------------------------------------------------------------


@app.get("/api/pets")
def list_pets() -> list[dict]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM pets ORDER BY is_sample DESC, id").fetchall()
    return [pet_out(r) for r in rows]


@app.post("/api/pets", status_code=201)
def create_pet(body: PetIn) -> dict:
    with connect() as conn:
        pet_id = conn.execute(
            "INSERT INTO pets (name, species, breed, age_years, weight, weight_unit, quirks, "
            "owner_timezone, home_timezone, caretaker_name) VALUES (:name, :species, :breed, "
            ":age_years, :weight, :weight_unit, :quirks, :owner_timezone, :home_timezone, "
            ":caretaker_name)",
            body.model_dump(),
        ).lastrowid
        conn.execute("INSERT INTO emergency_cards (pet_id) VALUES (?)", (pet_id,))
        return pet_out(get_pet_row(conn, pet_id))


@app.get("/api/pets/{pet_id}")
def get_pet(pet_id: int) -> dict:
    with connect() as conn:
        return pet_out(get_pet_row(conn, pet_id))


@app.put("/api/pets/{pet_id}")
def update_pet(pet_id: int, body: PetIn) -> dict:
    with connect() as conn:
        get_pet_row(conn, pet_id)
        conn.execute(
            "UPDATE pets SET name = :name, species = :species, breed = :breed, "
            "age_years = :age_years, weight = :weight, weight_unit = :weight_unit, "
            "quirks = :quirks, owner_timezone = :owner_timezone, "
            "home_timezone = :home_timezone, caretaker_name = :caretaker_name WHERE id = :id",
            {**body.model_dump(), "id": pet_id},
        )
        return pet_out(get_pet_row(conn, pet_id))


@app.delete("/api/pets/{pet_id}", status_code=204)
def delete_pet(pet_id: int) -> None:
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        photos = [r[0] for r in conn.execute(
            "SELECT photo_path FROM checkins WHERE pet_id = ? AND photo_path IS NOT NULL "
            "UNION SELECT photo_path FROM messages WHERE pet_id = ? AND photo_path IS NOT NULL",
            (pet_id, pet_id),
        )]
        conn.execute("DELETE FROM pets WHERE id = ?", (pet_id,))
    for name in [pet["photo_path"], *photos]:
        remove_photo(name)


@app.post("/api/pets/{pet_id}/photo")
async def upload_pet_photo(pet_id: int, photo: UploadFile = File(...)) -> dict:
    with connect() as conn:
        old = get_pet_row(conn, pet_id)["photo_path"]
    checked = await read_photo(photo)
    if checked is None:
        raise HTTPException(422, "No photo uploaded.")
    name = save_photo(checked, f"pet{pet_id}")
    with connect() as conn:
        conn.execute("UPDATE pets SET photo_path = ? WHERE id = ?", (name, pet_id))
        pet = pet_out(get_pet_row(conn, pet_id))
    remove_photo(old)
    return pet


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------


@app.get("/api/pets/{pet_id}/tasks")
def list_tasks(pet_id: int) -> list[dict]:
    with connect() as conn:
        get_pet_row(conn, pet_id)
        rows = conn.execute(
            "SELECT * FROM tasks WHERE pet_id = ? AND active = 1 ORDER BY time, id", (pet_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/pets/{pet_id}/tasks", status_code=201)
def create_task(pet_id: int, body: TaskIn) -> dict:
    with connect() as conn:
        get_pet_row(conn, pet_id)
        return insert_task(conn, pet_id, body)


@app.put("/api/tasks/{task_id}")
def update_task(task_id: int, body: TaskIn) -> dict:
    with connect() as conn:
        task = conn.execute(
            "SELECT * FROM tasks WHERE id = ? AND active = 1", (task_id,)
        ).fetchone()
        if task is None:
            raise HTTPException(404, f"Task {task_id} not found.")
        if task["type"] != body.type and conn.execute(
            "SELECT 1 FROM checkins WHERE task_id = ? LIMIT 1", (task_id,)
        ).fetchone():
            raise HTTPException(
                409, "This task already has check-ins, so its type can't change. "
                "Remove it and add a new task instead."
            )
        conn.execute(
            "UPDATE tasks SET title = :title, type = :type, time = :time, repeat = :repeat, "
            "repeat_on = :repeat_on, notes = :notes, dose = :dose WHERE id = :id",
            {**body.model_dump(), "id": task_id},
        )
        return dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int) -> None:
    """Soft delete: the task leaves the schedule but its check-in history stays."""
    with connect() as conn:
        cur = conn.execute("UPDATE tasks SET active = 0 WHERE id = ? AND active = 1", (task_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, f"Task {task_id} not found.")


@app.get("/api/pets/{pet_id}/day")
def pet_day(pet_id: int, day_str: str = Query(alias="date")) -> dict:
    """Tasks scheduled for one day, each with that day's check-ins."""
    day = parse_day(day_str)
    with connect() as conn:
        get_pet_row(conn, pet_id)
        return {"date": day.isoformat(), "tasks": day_tasks(conn, pet_id, day)}


# ---------------------------------------------------------------------------
# Check-ins
# ---------------------------------------------------------------------------


@app.get("/api/pets/{pet_id}/checkins")
def list_checkins(pet_id: int, since: str | None = None) -> list[dict]:
    """Check-ins newest first, with the task's title. `since` = YYYY-MM-DD (inclusive)."""
    with connect() as conn:
        get_pet_row(conn, pet_id)
        sql = (
            "SELECT c.*, t.title AS task_title, t.dose AS task_dose FROM checkins c "
            "JOIN tasks t ON t.id = c.task_id WHERE c.pet_id = ?"
        )
        args: list = [pet_id]
        if since:
            sql += " AND c.slot_date >= ?"
            args.append(parse_day(since).isoformat())
        rows = conn.execute(sql + " ORDER BY c.slot_date DESC, c.created_at DESC", args).fetchall()
    return [with_photo_url(r) for r in rows]


@app.post("/api/checkins", status_code=201)
async def create_checkin(
    task_id: int = Form(...),
    slot_date: str = Form(..., description="YYYY-MM-DD"),
    status: Literal["done", "could_not"] = Form(...),
    reason: str = Form(""),
    note: str = Form(""),
    caretaker_name: str = Form(""),
    photo: UploadFile | None = File(None),
) -> dict:
    day = parse_day(slot_date)
    reason = reason.strip()
    if status == "could_not" and not reason:
        raise HTTPException(422, "Please say why the task couldn't be done.")
    checked_photo = await read_photo(photo)

    conn = connect()
    conn.isolation_level = None  # manage the transaction by hand
    saved_name = None
    try:
        # BEGIN IMMEDIATE takes the write lock now, so two check-ins for the same
        # dose can't both pass the check below before either is written.
        conn.execute("BEGIN IMMEDIATE")
        task = conn.execute(
            "SELECT * FROM tasks WHERE id = ? AND active = 1", (task_id,)
        ).fetchone()
        if task is None:
            raise HTTPException(404, f"Task {task_id} not found.")
        if not task_runs_on(task, day):
            raise HTTPException(422, f"'{task['title']}' isn't scheduled on {day.isoformat()}.")
        if not caretaker_name.strip():
            caretaker_name = get_pet_row(conn, task["pet_id"])["caretaker_name"]

        # --- Meds rule (hard rule, not AI) ---------------------------------
        if task["type"] == "meds":
            # A dose given under a task this one replaced (e.g. the pill moved
            # from breakfast to dinner today) counts as given for this slot.
            lineage = [task_id]
            prev = task["replaces_task_id"]
            while prev is not None and prev not in lineage and len(lineage) < 10:
                lineage.append(prev)
                row = conn.execute("SELECT replaces_task_id FROM tasks WHERE id = ?", (prev,)).fetchone()
                prev = row["replaces_task_id"] if row else None
            given = conn.execute(
                "SELECT slot_time, created_at, caretaker_name FROM checkins "
                f"WHERE task_id IN ({', '.join('?' * len(lineage))}) AND slot_date = ? "
                "AND status = 'done' AND task_type = 'meds'",
                (*lineage, day.isoformat()),
            ).fetchone()
            if given is not None:
                who = f" by {given['caretaker_name']}" if given["caretaker_name"] else ""
                raise HTTPException(
                    409,
                    f"Blocked: the {given['slot_time']} dose of {task['dose']} was already marked "
                    f"given{who} at {given['created_at']}. Do not give another dose.",
                )

        if checked_photo:
            saved_name = save_photo(checked_photo, f"checkin{task_id}")
        now = utc_now_iso()
        checkin_id = conn.execute(
            "INSERT INTO checkins (task_id, pet_id, task_type, slot_date, slot_time, status, "
            "reason, note, photo_path, caretaker_name, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (task_id, task["pet_id"], task["type"], day.isoformat(), task["time"], status,
             reason or None, note.strip(), saved_name, caretaker_name.strip(), now),
        ).lastrowid
        conn.execute("COMMIT")
    except sqlite3.IntegrityError:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        remove_photo(saved_name)
        raise HTTPException(409, "Blocked: this dose was already marked given.") from None
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        remove_photo(saved_name)
        raise
    finally:
        conn.close()

    with connect() as conn:
        row = conn.execute("SELECT * FROM checkins WHERE id = ?", (checkin_id,)).fetchone()
    return with_photo_url(row)


# ---------------------------------------------------------------------------
# Emergency card
# ---------------------------------------------------------------------------


@app.get("/api/pets/{pet_id}/emergency")
def get_emergency(pet_id: int) -> dict:
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        card = conn.execute(
            "SELECT * FROM emergency_cards WHERE pet_id = ?", (pet_id,)
        ).fetchone()
        meds = conn.execute(
            "SELECT title, time, dose FROM tasks WHERE pet_id = ? AND active = 1 "
            "AND type = 'meds' ORDER BY time",
            (pet_id,),
        ).fetchall()
    data = dict(card) if card else {"pet_id": pet_id, **EmergencyIn().model_dump()}
    data["pet"] = pet_out(pet)
    data["scheduled_meds"] = [dict(m) for m in meds]
    return data


@app.put("/api/pets/{pet_id}/emergency")
def update_emergency(pet_id: int, body: EmergencyIn) -> dict:
    fields = body.model_dump()
    cols = ", ".join(fields)
    updates = ", ".join(f"{k} = excluded.{k}" for k in fields)
    with connect() as conn:
        get_pet_row(conn, pet_id)
        conn.execute(
            f"INSERT INTO emergency_cards (pet_id, {cols}) "
            f"VALUES (:pet_id, {', '.join(':' + k for k in fields)}) "
            f"ON CONFLICT(pet_id) DO UPDATE SET {updates}",
            {**fields, "pet_id": pet_id},
        )
    return get_emergency(pet_id)


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------


@app.post("/api/sample/reset")
def reset_samples() -> dict:
    """Re-create the two sample pets with a fresh week ending yesterday."""
    reset_sample_data()
    return {"ok": True}
