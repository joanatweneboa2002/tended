"""Health log: quick entries from the caretaker (weight, appetite, water,
energy, potty, symptoms). Every measure is optional, but an entry needs at
least one."""

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

from backend.common import get_pet_row, home_now, parse_day, utc_now_iso
from backend.db import connect

router = APIRouter(prefix="/api")


class HealthIn(BaseModel):
    weight: float | None = Field(default=None, gt=0, le=1000)
    weight_unit: Literal["lb", "kg"] | None = None
    appetite: Literal["none", "some", "normal"] | None = None
    water: Literal["less", "normal", "more"] | None = None
    energy: Literal["low", "normal", "high"] | None = None
    potty: Literal["normal", "off"] | None = None
    symptoms: str = ""
    logged_by: str = ""

    @model_validator(mode="after")
    def something_logged(self) -> "HealthIn":
        self.symptoms = self.symptoms.strip()
        measures = (self.weight, self.appetite, self.water, self.energy, self.potty)
        if all(v is None for v in measures) and not self.symptoms:
            raise ValueError("Log at least one thing.")
        return self


def recent_logs(conn, pet, days: int) -> list[dict]:
    """Entries from the last `days` days (home time, today included), newest first."""
    since = (home_now(pet).date() - timedelta(days=days - 1)).isoformat()
    rows = conn.execute(
        "SELECT * FROM health_logs WHERE pet_id = ? AND log_date >= ? "
        "ORDER BY log_date DESC, logged_at DESC",
        (pet["id"], since),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/pets/{pet_id}/health")
def list_health(pet_id: int, days: int = 7, since: str | None = None) -> list[dict]:
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        if since:
            rows = conn.execute(
                "SELECT * FROM health_logs WHERE pet_id = ? AND log_date >= ? "
                "ORDER BY log_date DESC, logged_at DESC",
                (pet_id, parse_day(since).isoformat()),
            ).fetchall()
            return [dict(r) for r in rows]
        return recent_logs(conn, pet, max(1, min(days, 365)))


@router.post("/pets/{pet_id}/health", status_code=201)
def create_health(pet_id: int, body: HealthIn) -> dict:
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        data = body.model_dump()
        data["weight_unit"] = data["weight_unit"] or pet["weight_unit"]
        data["logged_by"] = data["logged_by"].strip() or pet["caretaker_name"]
        log_id = conn.execute(
            "INSERT INTO health_logs (pet_id, log_date, logged_at, logged_by, weight, "
            "weight_unit, appetite, water, energy, potty, symptoms) VALUES (:pet_id, "
            ":log_date, :logged_at, :logged_by, :weight, :weight_unit, :appetite, :water, "
            ":energy, :potty, :symptoms)",
            {**data, "pet_id": pet_id, "log_date": home_now(pet).date().isoformat(),
             "logged_at": utc_now_iso()},
        ).lastrowid
        return dict(conn.execute("SELECT * FROM health_logs WHERE id = ?", (log_id,)).fetchone())
