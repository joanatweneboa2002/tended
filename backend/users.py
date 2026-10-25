"""Demo accounts and who-can-see-what.

Demo only: there are no passwords. The browser says who is using Tended with
an `X-Tended-User` header (the person's id, e.g. "lena"), and every request
is checked here:

- owners see only their own pets; caretakers see only the pets they've been given
- any route that names a pet (directly, or through a task, check-in,
  appointment, agent run or log suggestion) is refused with 403 if the pet
  isn't theirs, so the agents only ever read pets the person may see
- `role` / `sender_role` can't be faked: they must match the person's role
"""

import sqlite3

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


def ensure_users(conn: sqlite3.Connection) -> None:
    """The demo people always exist (and keep these details)."""
    conn.executemany(
        "INSERT INTO users (id, name, role, city, country, flag, timezone, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, city = excluded.city, "
        "country = excluded.country, flag = excluded.flag, timezone = excluded.timezone, note = excluded.note",
        USERS,
    )


def user_out(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in ("id", "name", "role", "city", "country", "flag", "timezone", "note")}


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
_OPEN = {"/api/status", "/api/users"}


def require_pet(conn: sqlite3.Connection, user: sqlite3.Row, pet_id: int) -> None:
    """403 if `user` may not see this pet (404s are left to the route)."""
    pet = conn.execute("SELECT * FROM pets WHERE id = ?", (pet_id,)).fetchone()
    if pet is not None and not can_see(user, pet):
        raise HTTPException(403, f"That pet isn't {user['name']}'s to see.")


def guard(request: Request) -> None:
    """Runs before every API route (see main.py)."""
    if request.url.path in _OPEN or not request.url.path.startswith("/api/"):
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
