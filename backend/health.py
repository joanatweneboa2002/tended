"""Health log: quick entries from the caretaker. Every measure is optional, but
an entry needs at least one.

Which measures make sense depends on the species (the Health tab only shows
those): dogs and cats get weight, appetite, water, energy and potty; birds get
appetite, droppings, feathers and activity (stored as energy); fish get eating
(stored as appetite), swimming and water clarity; reptiles get eating,
shedding and basking; any other species gets appetite and energy. Everyone
gets notes. Sharing the appetite and energy columns keeps the Watchdog's trend
checks working for every species."""

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

from backend.common import get_pet_row, home_now, parse_day, utc_now_iso
from backend.db import connect
from backend.users import Me

router = APIRouter(prefix="/api")

EXTRA_FIELDS = ("droppings", "feathers", "swimming", "water_clarity", "shedding", "basking")


class HealthIn(BaseModel):
    weight: float | None = Field(default=None, gt=0, le=1000)
    weight_unit: Literal["lb", "kg"] | None = None
    appetite: Literal["none", "some", "normal"] | None = None
    water: Literal["less", "normal", "more"] | None = None
    energy: Literal["low", "normal", "high"] | None = None
    potty: Literal["normal", "off"] | None = None
    droppings: Literal["normal", "off"] | None = None
    feathers: Literal["normal", "plucking", "ruffled"] | None = None
    swimming: Literal["normal", "slow", "odd"] | None = None
    water_clarity: Literal["clear", "cloudy"] | None = None
    shedding: Literal["none", "normal", "stuck"] | None = None
    basking: Literal["less", "normal", "more"] | None = None
    symptoms: str = ""
    logged_by: str = ""

    @model_validator(mode="after")
    def something_logged(self) -> "HealthIn":
        self.symptoms = self.symptoms.strip()
        measures = (self.weight, self.appetite, self.water, self.energy, self.potty, *(getattr(self, f) for f in EXTRA_FIELDS))
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
def create_health(pet_id: int, body: HealthIn, user=Me) -> dict:
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        data = body.model_dump()
        data["weight_unit"] = data["weight_unit"] or pet["weight_unit"]
        data["logged_by"] = user["name"]  # whoever is signed in
        extra = ", ".join(EXTRA_FIELDS)
        log_id = conn.execute(
            "INSERT INTO health_logs (pet_id, log_date, logged_at, logged_by, weight, "
            f"weight_unit, appetite, water, energy, potty, symptoms, {extra}) VALUES (:pet_id, "
            ":log_date, :logged_at, :logged_by, :weight, :weight_unit, :appetite, :water, "
            f":energy, :potty, :symptoms, {', '.join(':' + f for f in EXTRA_FIELDS)})",
            {**data, "pet_id": pet_id, "log_date": home_now(pet).date().isoformat(),
             "logged_at": utc_now_iso()},
        ).lastrowid
        return dict(conn.execute("SELECT * FROM health_logs WHERE id = ?", (log_id,)).fetchone())
