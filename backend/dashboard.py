"""Home dashboard: one call that gathers everything the Home screen shows.

Alerts here are plain rules (no AI) and only look at today and tomorrow:
overdue tasks, "couldn't do it" check-ins, today's health entries and
appointment reminders. Spotting patterns across the week is left to the
agents.
"""

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter

from backend.appointments import pet_appointments
from backend.common import day_tasks, get_pet_row, home_now, home_to_utc, pet_out, utc_iso
from backend.db import connect
from backend.health import recent_logs
from backend.messages import latest_message, unread_count

router = APIRouter(prefix="/api")

# How long after a task's time before it counts as overdue.
GRACE_MINUTES = {"meds": 30}
DEFAULT_GRACE_MINUTES = 60


def alert(level: str, kind: str, text: str, at: str | None = None) -> dict:
    """level: 'urgent' | 'warning' | 'info'. `at` is a UTC time the UI shows in local time."""
    return {"level": level, "kind": kind, "text": text, "at": at}


@router.get("/pets/{pet_id}/dashboard")
def dashboard(pet_id: int, role: Literal["owner", "caretaker"]) -> dict:
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        now = home_now(pet)
        today = now.date()
        tasks = day_tasks(conn, pet_id, today)
        appointments = pet_appointments(conn, pet)
        logs = recent_logs(conn, pet, 8)
        last_msg = latest_message(conn, pet_id)
        unread = unread_count(conn, pet_id, role)
        last_checkin = conn.execute(
            "SELECT c.*, t.title AS task_title FROM checkins c JOIN tasks t ON t.id = c.task_id "
            "WHERE c.pet_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 1",
            (pet_id,),
        ).fetchone()
        last_photo = conn.execute(
            "SELECT c.*, t.title AS task_title FROM checkins c JOIN tasks t ON t.id = c.task_id "
            "WHERE c.pet_id = ? AND c.photo_path IS NOT NULL "
            "ORDER BY c.created_at DESC, c.id DESC LIMIT 1",
            (pet_id,),
        ).fetchone()

    now_hhmm = now.strftime("%H:%M")
    for t in tasks:
        t["due_at"] = utc_iso(home_to_utc(pet, today, t["time"]))
        t["state"] = (
            "done" if any(c["status"] == "done" for c in t["checkins"])
            else "could_not" if t["checkins"]
            else "pending"
        )

    done = sum(t["state"] == "done" for t in tasks)
    upcoming = [t for t in tasks if t["state"] == "pending" and t["time"] >= now_hhmm]
    next_task = upcoming[0] if upcoming else None

    alerts = []
    # Overdue and skipped tasks
    for t in tasks:
        grace = timedelta(minutes=GRACE_MINUTES.get(t["type"], DEFAULT_GRACE_MINUTES))
        due = home_to_utc(pet, today, t["time"])
        if t["state"] == "pending" and now >= due + grace:
            if t["type"] == "meds":
                alerts.append(alert("urgent", "overdue_meds",
                                    f"{t['title']} isn't marked given yet. Dose: {t['dose']}.",
                                    t["due_at"]))
            else:
                alerts.append(alert("warning", "overdue", f"{t['title']} isn't checked off yet.",
                                    t["due_at"]))
        elif t["state"] == "could_not":
            reason = next((c["reason"] for c in t["checkins"] if c["reason"]), "")
            alerts.append(alert("warning", "could_not",
                                f"Couldn't do {t['title']}: {reason}", t["due_at"]))

    # Today's health entries
    todays_logs = [lg for lg in logs if lg["log_date"] == today.isoformat()]
    for lg in todays_logs:
        if lg["appetite"] == "none":
            alerts.append(alert("urgent", "health", "Not eating today.", lg["logged_at"]))
        if lg["energy"] == "low":
            alerts.append(alert("warning", "health", "Low energy today.", lg["logged_at"]))
        if lg["potty"] == "off":
            alerts.append(alert("warning", "health", "Potty was off today.", lg["logged_at"]))
        if lg["symptoms"]:
            alerts.append(alert("warning", "health", f"Symptoms noted: {lg['symptoms']}",
                                lg["logged_at"]))

    # Appointment reminders: today and the day before
    tomorrow = (today + timedelta(days=1)).isoformat()
    for a in appointments:
        who = "you're" if a["taken_by"] == role else (
            "the caretaker is" if a["taken_by"] == "caretaker" else "the owner is"
        )
        place = f" at {a['place_name']}" if a["place_name"] else ""
        bring = f" Bring: {a['bring']}." if a["bring"] else ""
        if a["date"] == tomorrow:
            alerts.append(alert("info", "appointment_tomorrow",
                                f"Tomorrow: {a['title']}{place}, {who} taking {pet['name']}.{bring}",
                                a["starts_at"]))
        elif a["date"] == today.isoformat() and not a["is_past"]:
            alerts.append(alert("info", "appointment_today",
                                f"Today: {a['title']}{place}, {who} taking {pet['name']}.{bring}",
                                a["starts_at"]))

    order = {"urgent": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: order[a["level"]])

    next_appt = next((a for a in appointments if not a["is_past"]), None)

    return {
        "pet": pet_out(pet),
        "role": role,
        "today": today.isoformat(),
        "home_time": now_hhmm,
        "progress": {"done": done, "total": len(tasks)},
        "tasks": tasks,
        "next_task": next_task,
        "alerts": alerts,
        "next_appointment": next_appt,
        "latest_message": last_msg,
        "unread_messages": unread,
        "latest_checkin": _checkin(last_checkin),
        "latest_photo_checkin": _checkin(last_photo),
        "health": health_snapshot(logs),
    }


def _checkin(row) -> dict | None:
    if row is None:
        return None
    c = dict(row)
    path = c.pop("photo_path")
    c["photo_url"] = f"/photos/{path}" if path else None
    return c


def health_snapshot(logs: list[dict]) -> dict:
    """Latest value of each measure over the last week, plus the weight change."""
    def latest(field):
        for lg in logs:  # newest first
            if lg[field] not in (None, ""):
                return {"value": lg[field], "date": lg["log_date"]}
        return None

    weights = [lg for lg in logs if lg["weight"] is not None]
    weight = None
    if weights:
        newest, oldest = weights[0], weights[-1]
        weight = {
            "value": newest["weight"],
            "unit": newest["weight_unit"],
            "date": newest["log_date"],
            "change": round(newest["weight"] - oldest["weight"], 2) if len(weights) > 1 else None,
            "since": oldest["log_date"] if len(weights) > 1 else None,
        }
    return {
        "entries": len(logs),
        "weight": weight,
        "appetite": latest("appetite"),
        "water": latest("water"),
        "energy": latest("energy"),
        "potty": latest("potty"),
        "symptoms": latest("symptoms"),
    }
