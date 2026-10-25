"""Appointments: vet, groomer or other visits.

date + time are wall-clock in the pet's home time zone (where the visit
happens). Each appointment is returned with `starts_at` in UTC so any viewer
can show it in their own local time.
"""

from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.common import TIME_PATTERN, get_pet_row, home_to_utc, utc_iso, utc_now_iso
from backend.db import connect

router = APIRouter(prefix="/api")


class AppointmentIn(BaseModel):
    kind: Literal["vet", "groomer", "other"]
    title: str = Field(min_length=1, max_length=120)
    date: str = Field(description="YYYY-MM-DD, pet's home time")
    time: str = Field(pattern=TIME_PATTERN, description="HH:MM, pet's home time")
    place_name: str = ""
    address: str = ""
    taken_by: Literal["owner", "caretaker"]
    bring: str = ""
    visit_notes: str = ""

    @field_validator("date")
    @classmethod
    def valid_date(cls, v: str) -> str:
        try:
            return date.fromisoformat(v).isoformat()
        except ValueError:
            raise ValueError("Use a date like 2026-10-25.") from None


def appointment_out(pet, row) -> dict:
    a = dict(row)
    starts = home_to_utc(pet, a["date"], a["time"])
    a["starts_at"] = utc_iso(starts)
    a["is_past"] = starts < datetime.now(timezone.utc)
    return a


def pet_appointments(conn, pet) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM appointments WHERE pet_id = ? ORDER BY date, time, id", (pet["id"],)
    ).fetchall()
    return [appointment_out(pet, r) for r in rows]


@router.get("/pets/{pet_id}/appointments")
def list_appointments(pet_id: int) -> list[dict]:
    with connect() as conn:
        return pet_appointments(conn, get_pet_row(conn, pet_id))


@router.post("/pets/{pet_id}/appointments", status_code=201)
def create_appointment(pet_id: int, body: AppointmentIn) -> dict:
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        appt_id = conn.execute(
            "INSERT INTO appointments (pet_id, kind, title, date, time, place_name, address, "
            "taken_by, bring, visit_notes, created_at) VALUES (:pet_id, :kind, :title, :date, "
            ":time, :place_name, :address, :taken_by, :bring, :visit_notes, :created_at)",
            {**body.model_dump(), "pet_id": pet_id, "created_at": utc_now_iso()},
        ).lastrowid
        row = conn.execute("SELECT * FROM appointments WHERE id = ?", (appt_id,)).fetchone()
        return appointment_out(pet, row)


@router.put("/appointments/{appt_id}")
def update_appointment(appt_id: int, body: AppointmentIn) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT * FROM appointments WHERE id = ?", (appt_id,)).fetchone()
        if row is None:
            raise HTTPException(404, f"Appointment {appt_id} not found.")
        conn.execute(
            "UPDATE appointments SET kind = :kind, title = :title, date = :date, time = :time, "
            "place_name = :place_name, address = :address, taken_by = :taken_by, "
            "bring = :bring, visit_notes = :visit_notes WHERE id = :id",
            {**body.model_dump(), "id": appt_id},
        )
        pet = get_pet_row(conn, row["pet_id"])
        row = conn.execute("SELECT * FROM appointments WHERE id = ?", (appt_id,)).fetchone()
        return appointment_out(pet, row)


@router.delete("/appointments/{appt_id}", status_code=204)
def delete_appointment(appt_id: int) -> None:
    with connect() as conn:
        if conn.execute("DELETE FROM appointments WHERE id = ?", (appt_id,)).rowcount == 0:
            raise HTTPException(404, f"Appointment {appt_id} not found.")
