"""Helpers shared by the API routes: pets, photos, dates and time zones.

Time zones: each pet has a `home_timezone` (where the pet and caretaker are)
and an `owner_timezone` (where the owner is, often travelling). Schedule
and appointment times are stored as wall-clock times in the pet's home time
zone. Timestamps (check-ins, messages, health logs) are stored in UTC. The
frontend shows the pet's home time first to everyone; the owner also sees
their own time, smaller. The owner's zone comes from their account (users.py).
"""

import sqlite3
import uuid
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, UploadFile

from backend.config import PHOTOS_DIR
from backend.db import task_runs_on

MAX_PHOTO_BYTES = 8 * 1024 * 1024
PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


# ---- time ----


def utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def utc_now_iso() -> str:
    return utc_iso(datetime.now(timezone.utc))


def clock(dt: datetime) -> str:
    """'7:05 AM' on every OS (strftime's %-I is Mac/Linux only)."""
    return dt.strftime("%I:%M %p").lstrip("0")


def day_clock(dt: datetime) -> str:
    """'Sat Oct 24 7:05 AM'."""
    return f"{dt.strftime('%a %b %d')} {clock(dt)}"


HEADLINE_WORDS = 8
ACTION_WORDS = 15
_DANGLING = {"and", "or", "but", "the", "a", "an", "to", "of", "for", "with", "if", "so", "because", "about",
             "as", "at", "on", "in", "unless", "until", "before", "after", "when", "while", "than", "that", "without",
             "not", "do", "don't", "never", "no", "your", "her", "his", "their", "its", "any", "every", "each"}


def limit_words(text: str, n: int) -> tuple[str, bool]:
    """Keep at most n words. Prefers the first whole clause (before ; or a dash)
    so a sentence is never cut mid-thought. Returns (text, was_cut)."""
    text = text.strip()
    words = text.split()
    if len(words) <= n:
        return text, False
    for sep in (";", " — ", " - ", ": "):
        first = text.split(sep)[0].strip().rstrip(",")
        if first != text and 3 <= len(first.split()) <= n:
            return (first if first.endswith((".", "!", "?")) else first + "."), True
    words = words[:n]
    while len(words) > 1 and words[-1].strip(",;:—-").lower() in _DANGLING:
        words.pop()
    out = " ".join(words).rstrip(",;:—- ")
    return (out if out.endswith((".", "!", "?")) else out + "."), True


def home_tz(pet: sqlite3.Row | dict) -> ZoneInfo:
    return ZoneInfo(pet["home_timezone"])


def home_now(pet: sqlite3.Row | dict) -> datetime:
    """The current time where the pet lives."""
    return datetime.now(home_tz(pet))


def home_to_utc(pet: sqlite3.Row | dict, day: date | str, hhmm: str) -> datetime:
    """A wall-clock date + HH:MM in the pet's home time zone, as a UTC datetime."""
    if isinstance(day, str):
        day = date.fromisoformat(day)
    local = datetime.combine(day, time.fromisoformat(hhmm), tzinfo=home_tz(pet))
    return local.astimezone(timezone.utc)


def parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, f"'{value}' is not a date (use YYYY-MM-DD).") from None


# ---- rows ----


def photo_url(path: str | None) -> str | None:
    """Uploaded photos live in data/photos (/photos/...). Paths that already start with
    "/" are bundled files in frontend/public (e.g. /pets/fynn.jpg) and are used as-is."""
    if not path:
        return None
    return path if path.startswith("/") else f"/photos/{path}"


def with_photo_url(row: sqlite3.Row) -> dict:
    out = dict(row)
    out["photo_url"] = photo_url(out.pop("photo_path"))
    return out


def pet_out(row: sqlite3.Row) -> dict:
    """A pet for the browser, with where its owner and caretaker are."""
    from backend.users import USERS
    people = {u[0]: u for u in USERS}
    pet = with_photo_url(row)
    pet["is_sample"] = bool(pet["is_sample"])
    owner, carer = people.get(pet.get("owner_id")), people.get(pet.get("caretaker_id"))
    if owner:  # the owner's clock is their account's, never a stale copy
        pet["owner_timezone"] = owner[6]
    pet["owner_name"] = owner[1] if owner else ""
    pet["owner_city"] = owner[3] if owner else ""
    pet["owner_flag"] = owner[5] if owner else ""
    pet["caretaker_city"] = carer[3] if carer else ""
    pet["caretaker_flag"] = carer[5] if carer else ""
    return pet


def get_pet_row(conn: sqlite3.Connection, pet_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM pets WHERE id = ?", (pet_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Pet {pet_id} not found.")
    return row


def person_name(conn: sqlite3.Connection, pet: sqlite3.Row, role: str) -> str:
    """Display name for the owner or caretaker of this pet."""
    if role == "caretaker":
        return pet["caretaker_name"] or "Caretaker"
    owner = conn.execute("SELECT name FROM users WHERE id = ?", (pet["owner_id"],)).fetchone()
    if owner:
        return owner["name"]
    row = conn.execute(
        "SELECT owner_name FROM emergency_cards WHERE pet_id = ?", (pet["id"],)
    ).fetchone()
    return (row["owner_name"] if row else "") or "Owner"


def day_tasks(conn: sqlite3.Connection, pet_id: int, day: date) -> list[dict]:
    """Tasks scheduled on `day`, in time order, each with that day's check-ins."""
    tasks = conn.execute(
        "SELECT * FROM tasks WHERE pet_id = ? AND active = 1 ORDER BY time, id", (pet_id,)
    ).fetchall()
    checkins = conn.execute(
        "SELECT * FROM checkins WHERE pet_id = ? AND slot_date = ? ORDER BY created_at",
        (pet_id, day.isoformat()),
    ).fetchall()
    out = []
    for t in tasks:
        if not task_runs_on(t, day):
            continue
        mine = [with_photo_url(c) for c in checkins if c["task_id"] == t["id"]]
        out.append({
            **dict(t),
            "checkins": mine,
            "dose_given": t["type"] == "meds" and any(c["status"] == "done" for c in mine),
        })
    return out


# ---- photos ----


async def read_photo(upload: UploadFile | None) -> tuple[bytes, str] | None:
    """Validate an uploaded photo. Returns (bytes, extension) or None if no photo."""
    if upload is None or not upload.filename:
        return None
    ext = PHOTO_TYPES.get(upload.content_type or "")
    if ext is None:
        raise HTTPException(415, "Photo must be a JPEG, PNG, WebP or GIF image.")
    data = await upload.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Photo is too large (8 MB max).")
    if not data:
        return None
    return data, ext


def save_photo(photo: tuple[bytes, str], prefix: str) -> str:
    data, ext = photo
    name = f"{prefix}-{uuid.uuid4().hex[:12]}{ext}"
    (PHOTOS_DIR / name).write_bytes(data)
    return name


def remove_photo(name: str | None) -> None:
    if name and not name.startswith("/"):  # never delete bundled files in frontend/public
        (PHOTOS_DIR / name).unlink(missing_ok=True)
