"""Accounts and who-can-see-what.

Six demo accounts always exist (USERS); testers can also join with a name,
city and time zone, and owners can add a caretaker for one of their pets.
There are no passwords. The browser says who is using Tended with
an `X-Tended-User` header (the person's id, e.g. "lena"), and every request
is checked here:

- owners see only their own pets; caretakers see only the pets they've been given
- any route that names a pet (directly, or through a task, check-in,
  appointment, agent run or log suggestion) is refused with 403 if the pet
  isn't theirs, so the agents only ever read pets the person may see
- `role` / `sender_role` can't be faked: they must match the person's role
"""

import re
import secrets
import sqlite3
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, HTTPException, Request

from backend.db import connect

USER_HEADER = "X-Tended-User"

# (id, name, role, city, country, flag, timezone, note)
USERS = [
    ("joana", "Joana", "owner", "New Haven", "USA", "🇺🇸", "America/New_York", "Lives in New Haven, CT"),
    ("maya", "Maya", "owner", "London", "UK", "🇬🇧", "Europe/London", "On a six-month stay in London"),
    ("kenji", "Kenji", "owner", "Medellín", "Colombia", "🇨🇴", "America/Bogota", "Lives in Medellín"),
    ("ama", "Ama", "caretaker", "Accra", "Ghana", "🇬🇭", "Africa/Accra", "Looks after Fynn"),
    ("lena", "Lena", "caretaker", "Zurich", "Switzerland", "🇨🇭", "Europe/Zurich", "Looks after Miso"),
    ("yuki", "Yuki", "caretaker", "Tokyo", "Japan", "🇯🇵", "Asia/Tokyo", "Looks after Clover and Kiwi"),
]

# Flags for a pet's home, from its time zone (pets added in the app pick a zone, not a country).
ZONE_FLAGS = {
    "America/New_York": "🇺🇸", "America/Chicago": "🇺🇸", "America/Denver": "🇺🇸", "America/Los_Angeles": "🇺🇸",
    "America/Bogota": "🇨🇴", "America/Mexico_City": "🇲🇽", "America/Sao_Paulo": "🇧🇷", "America/Toronto": "🇨🇦",
    "Europe/London": "🇬🇧", "Europe/Zurich": "🇨🇭", "Europe/Paris": "🇫🇷", "Europe/Berlin": "🇩🇪",
    "Europe/Madrid": "🇪🇸", "Europe/Rome": "🇮🇹", "Europe/Amsterdam": "🇳🇱", "Africa/Accra": "🇬🇭",
    "Africa/Lagos": "🇳🇬", "Africa/Nairobi": "🇰🇪", "Africa/Johannesburg": "🇿🇦", "Asia/Tokyo": "🇯🇵",
    "Asia/Seoul": "🇰🇷", "Asia/Shanghai": "🇨🇳", "Asia/Singapore": "🇸🇬", "Asia/Kolkata": "🇮🇳",
    "Asia/Dubai": "🇦🇪", "Australia/Sydney": "🇦🇺", "Pacific/Auckland": "🇳🇿",
}


def _zone_tables() -> tuple[dict[str, str], dict[str, str]]:
    """{time zone: country code} and {country code: country name}, from the tz database."""
    import importlib.resources
    from pathlib import Path

    def read(name: str) -> str:
        try:
            return importlib.resources.files("tzdata.zoneinfo").joinpath(name).read_text(encoding="utf-8")
        except Exception:  # no tzdata package: the system copy (Mac, Linux)
            path = Path("/usr/share/zoneinfo") / name
            return path.read_text(encoding="utf-8") if path.exists() else ""

    rows = lambda text: [line.split("\t") for line in text.splitlines() if line and not line.startswith("#")]
    zones = {r[2]: r[0] for r in rows(read("zone.tab")) if len(r) >= 3}
    names = {r[0]: r[1] for r in rows(read("iso3166.tab")) if len(r) >= 2}
    return zones, names


_ZONES, _COUNTRIES = _zone_tables()


def _zone_bytes(tz: str) -> bytes:
    import importlib.resources
    try:
        return importlib.resources.files("tzdata.zoneinfo").joinpath(*tz.split("/")).read_bytes()
    except Exception:
        return b""


def _country_by_alias(tz: str) -> str:
    """Browsers often use older names ("Asia/Calcutta" for "Asia/Kolkata"). An old
    name and its current one have identical tz data, so match on the data."""
    data = _zone_bytes(tz)
    if not data:
        return ""
    for zone, code in _ZONES.items():
        if _zone_bytes(zone) == data:
            _ZONES[tz] = code  # remember it
            return code
    return ""


def place_for_zone(tz: str) -> tuple[str, str]:
    """(flag, country) for a time zone, e.g. ("🇵🇹", "Portugal") for Europe/Lisbon."""
    code = _ZONES.get(tz) or _country_by_alias(tz)
    if len(code) != 2:
        return ZONE_FLAGS.get(tz, ""), ""
    flag = "".join(chr(0x1F1E6 + ord(ch) - ord("A")) for ch in code.upper())
    return flag, _COUNTRIES.get(code, "")


def ensure_users(conn: sqlite3.Connection) -> None:
    """The demo people always exist (and keep these details)."""
    conn.executemany(
        "INSERT INTO users (id, name, role, city, country, flag, timezone, note, is_sample) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) "
        "ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, city = excluded.city, "
        "country = excluded.country, flag = excluded.flag, timezone = excluded.timezone, note = excluded.note, "
        "is_sample = 1",
        USERS,
    )


def user_out(row: sqlite3.Row) -> dict:
    from backend.common import photo_url
    out = {k: row[k] for k in ("id", "name", "role", "city", "country", "flag", "timezone", "note")}
    out["photo_url"] = photo_url(row["photo_path"])
    out["is_sample"] = bool(row["is_sample"])
    return out


def people(ids) -> dict[str, sqlite3.Row]:
    """Users by id (for showing a pet's owner and caretaker)."""
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    with connect() as conn:
        rows = conn.execute(f"SELECT * FROM users WHERE id IN ({', '.join('?' * len(ids))})", ids).fetchall()
    return {r["id"]: r for r in rows}


def can_see(user: sqlite3.Row, pet: sqlite3.Row) -> bool:
    return pet["owner_id"] == user["id"] if user["role"] == "owner" else pet["caretaker_id"] == user["id"]


def visible_pets_sql(user: sqlite3.Row) -> tuple[str, tuple]:
    col = "owner_id" if user["role"] == "owner" else "caretaker_id"
    return f"{col} = ?", (user["id"],)


def current_user(request: Request) -> sqlite3.Row:
    uid = (request.headers.get(USER_HEADER) or "").strip().lower()
    if not uid:
        raise HTTPException(401, "Pick who's using Tended first.")
    with connect() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if user is None:
        raise HTTPException(401, f"Unknown user '{uid}'.")
    return user


# Path parameter -> how to find the pet it belongs to.
_OWNING_PET = {
    "pet_id": None,
    "task_id": "SELECT pet_id FROM tasks WHERE id = ?",
    "checkin_id": "SELECT pet_id FROM checkins WHERE id = ?",
    "appt_id": "SELECT pet_id FROM appointments WHERE id = ?",
    "run_id": "SELECT pet_id FROM agent_runs WHERE id = ?",
    "sid": "SELECT pet_id FROM log_suggestions WHERE id = ?",
}
_OPEN = {"/api/status", "/api/users", "/api/join-pet"}


def require_pet(conn: sqlite3.Connection, user: sqlite3.Row, pet_id: int) -> None:
    """403 if `user` may not see this pet (404s are left to the route)."""
    pet = conn.execute("SELECT * FROM pets WHERE id = ?", (pet_id,)).fetchone()
    if pet is not None and not can_see(user, pet):
        raise HTTPException(403, f"That pet isn't {user['name']}'s to see.")


def guard(request: Request) -> None:
    """Runs before every API route (see main.py)."""
    path = request.url.path
    # open: status, the people list, and joining with an invite code (the code is the key)
    if path in _OPEN or path.startswith("/api/invites/") or not path.startswith("/api/"):
        return
    user = current_user(request)
    request.state.user = user
    for name in ("role", "sender_role"):
        claimed = request.query_params.get(name)
        if claimed is not None and claimed != user["role"]:
            raise HTTPException(403, f"{user['name']} is a {user['role']}, not a {claimed}.")
    with connect() as conn:
        for param, sql in _OWNING_PET.items():
            value = request.path_params.get(param)
            if value is None:
                continue
            try:
                key = int(value)
            except ValueError:
                continue  # the route's own validation answers
            if sql is None:
                pet_id = key
            else:
                row = conn.execute(sql, (key,)).fetchone()
                if row is None:
                    continue  # the route answers 404
                pet_id = row["pet_id"]
            require_pet(conn, user, pet_id)


def me(request: Request) -> sqlite3.Row:
    """The signed-in person, for routes that need it (set by `guard`)."""
    return getattr(request.state, "user", None) or current_user(request)


Me = Depends(me)


def valid_zone(tz: str) -> str:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Unknown time zone '{tz}'.") from None
    return tz


def new_user(conn, name: str, role: str, city: str, tz: str, created_by: str | None = None,
              photo: str | None = None) -> sqlite3.Row:
    from backend.common import utc_now_iso
    name, city = name.strip(), city.strip()
    if not (1 <= len(name) <= 40) or not (1 <= len(city) <= 60):
        raise HTTPException(422, "Please give a name (up to 40 letters) and a city.")
    uid = f"{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:20] or 'user'}-{secrets.token_hex(3)}"
    flag, country = place_for_zone(valid_zone(tz))
    conn.execute(
        "INSERT INTO users (id, name, role, city, country, flag, timezone, photo_path, is_sample, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        (uid, name, role, city, country, flag, tz, photo, created_by, utc_now_iso()),
    )
    return conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
