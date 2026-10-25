"""Request models shared by more than one route (the schedule editor and the
setup agent's approve step use the same task validation)."""

import sqlite3
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from backend.common import TIME_PATTERN
from backend.db import WEEKDAYS


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    type: Literal["feed", "walk", "meds", "potty", "other"]
    time: str = Field(pattern=TIME_PATTERN, description="HH:MM, pet's home time")
    repeat: Literal["daily", "weekdays", "weekends", "weekly", "once"] = "daily"
    repeat_on: str | None = None
    notes: str = ""
    dose: str | None = None

    @model_validator(mode="after")
    def check_rules(self) -> "TaskIn":
        if self.type == "meds":
            if not (self.dose and self.dose.strip()):
                raise ValueError("Meds tasks need a dose.")
            self.dose = self.dose.strip()
        else:
            self.dose = None
        if self.repeat == "weekly":
            if self.repeat_on not in WEEKDAYS:
                raise ValueError("Weekly tasks need repeat_on set to mon, tue, ... sun.")
        elif self.repeat == "once":
            try:
                date.fromisoformat(self.repeat_on or "")
            except ValueError:
                raise ValueError("One-off tasks need repeat_on set to a date (YYYY-MM-DD).") from None
        else:
            self.repeat_on = None
        return self


def insert_task(conn: sqlite3.Connection, pet_id: int, body: TaskIn) -> dict:
    task_id = conn.execute(
        "INSERT INTO tasks (pet_id, title, type, time, repeat, repeat_on, notes, dose) "
        "VALUES (:pet_id, :title, :type, :time, :repeat, :repeat_on, :notes, :dose)",
        {**body.model_dump(), "pet_id": pet_id},
    ).lastrowid
    return dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
