"""SQLite schema and helpers for Tended (data/tended.db)."""

import sqlite3
from datetime import date

from backend.config import DB_PATH, PHOTOS_DIR

TASK_TYPES = ("feed", "walk", "meds", "potty", "other")
REPEATS = ("daily", "weekdays", "weekends", "weekly", "once")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
CHECKIN_STATUSES = ("done", "could_not")
ROLES = ("owner", "caretaker")
APPOINTMENT_KINDS = ("vet", "groomer", "other")
APPETITE = ("none", "some", "normal")
WATER = ("less", "normal", "more")
ENERGY = ("low", "normal", "high")
POTTY = ("normal", "off")

SCHEMA = """
-- Demo accounts (no passwords). See backend/users.py.
CREATE TABLE IF NOT EXISTS users (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    role      TEXT NOT NULL CHECK (role IN ('owner', 'caretaker')),
    city      TEXT NOT NULL DEFAULT '',
    country   TEXT NOT NULL DEFAULT '',
    flag      TEXT NOT NULL DEFAULT '',
    timezone  TEXT NOT NULL,
    note      TEXT NOT NULL DEFAULT '',
    photo_path  TEXT,
    is_sample   INTEGER NOT NULL DEFAULT 0,  -- 1 = demo account, 0 = someone who joined
    created_by  TEXT,                        -- the owner who added this caretaker
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- owner_timezone mirrors the owner's account; home_* is where the pet (and its
-- caretaker) is. owner_id / caretaker_id decide who may see the pet.
CREATE TABLE IF NOT EXISTS pets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    species         TEXT NOT NULL,
    breed           TEXT NOT NULL DEFAULT '',
    age_years       REAL,
    weight          REAL,
    weight_unit     TEXT NOT NULL DEFAULT 'lb' CHECK (weight_unit IN ('lb', 'kg')),
    photo_path      TEXT,
    quirks          TEXT NOT NULL DEFAULT '',
    owner_timezone  TEXT NOT NULL DEFAULT 'America/New_York',
    home_timezone   TEXT NOT NULL DEFAULT 'America/New_York',
    caretaker_name  TEXT NOT NULL DEFAULT '',
    owner_id        TEXT REFERENCES users(id),
    caretaker_id    TEXT REFERENCES users(id),
    home_city       TEXT NOT NULL DEFAULT '',
    home_flag       TEXT NOT NULL DEFAULT '',
    is_sample       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Times are HH:MM in the pet's home time. repeat_on holds the weekday
-- ('mon'..'sun') for weekly tasks and the date (YYYY-MM-DD) for one-off tasks.
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id      INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('feed', 'walk', 'meds', 'potty', 'other')),
    time        TEXT NOT NULL,
    repeat      TEXT NOT NULL DEFAULT 'daily'
                CHECK (repeat IN ('daily', 'weekdays', 'weekends', 'weekly', 'once')),
    repeat_on   TEXT,
    notes       TEXT NOT NULL DEFAULT '',
    dose        TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    replaces_task_id INTEGER REFERENCES tasks(id),
    CHECK (type != 'meds' OR (dose IS NOT NULL AND dose != ''))
);

-- One row per caretaker check-in. slot_date + slot_time identify which
-- occurrence of the task this is. created_at is set by the server.
CREATE TABLE IF NOT EXISTS checkins (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    pet_id          INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    task_type       TEXT NOT NULL,
    slot_date       TEXT NOT NULL,
    slot_time       TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('done', 'could_not')),
    reason          TEXT,
    note            TEXT NOT NULL DEFAULT '',
    photo_path      TEXT,
    caretaker_name  TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    CHECK (status != 'could_not' OR (reason IS NOT NULL AND reason != ''))
);

-- Meds rule backstop: the database itself refuses a second "given" dose
-- for the same task on the same day, even if the API check were bypassed.
-- (Each task has one time per day, so task + date is the time slot.)
CREATE UNIQUE INDEX IF NOT EXISTS one_dose_per_slot
    ON checkins (task_id, slot_date)
    WHERE task_type = 'meds' AND status = 'done';

CREATE INDEX IF NOT EXISTS checkins_by_pet_date ON checkins (pet_id, slot_date);

CREATE TABLE IF NOT EXISTS emergency_cards (
    pet_id                    INTEGER PRIMARY KEY REFERENCES pets(id) ON DELETE CASCADE,
    owner_name                TEXT NOT NULL DEFAULT '',
    owner_phone               TEXT NOT NULL DEFAULT '',
    backup_name               TEXT NOT NULL DEFAULT '',
    backup_phone              TEXT NOT NULL DEFAULT '',
    vet_name                  TEXT NOT NULL DEFAULT '',
    vet_phone                 TEXT NOT NULL DEFAULT '',
    vet_address               TEXT NOT NULL DEFAULT '',
    allergies                 TEXT NOT NULL DEFAULT '',
    conditions                TEXT NOT NULL DEFAULT '',
    medications               TEXT NOT NULL DEFAULT '',
    vaccines                  TEXT NOT NULL DEFAULT '',
    diet                      TEXT NOT NULL DEFAULT '',
    emergency_spending_limit  REAL,
    microchip_number          TEXT NOT NULL DEFAULT ''
);

-- date + time are wall-clock in the pet's home time zone.
-- visit_notes is filled in after the visit.
CREATE TABLE IF NOT EXISTS appointments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id       INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('vet', 'groomer', 'other')),
    title        TEXT NOT NULL,
    date         TEXT NOT NULL,
    time         TEXT NOT NULL,
    place_name   TEXT NOT NULL DEFAULT '',
    address      TEXT NOT NULL DEFAULT '',
    taken_by     TEXT NOT NULL CHECK (taken_by IN ('owner', 'caretaker')),
    bring        TEXT NOT NULL DEFAULT '',
    visit_notes  TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_by_pet_date ON appointments (pet_id, date, time);

-- One row per health entry from the caretaker. Every measure is optional;
-- NULL means "not recorded this time". log_date is the pet's home-time date.
CREATE TABLE IF NOT EXISTS health_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id       INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    log_date     TEXT NOT NULL,
    logged_at    TEXT NOT NULL,
    logged_by    TEXT NOT NULL DEFAULT '',
    weight       REAL,
    weight_unit  TEXT NOT NULL DEFAULT 'lb' CHECK (weight_unit IN ('lb', 'kg')),
    appetite     TEXT CHECK (appetite IN ('none', 'some', 'normal')),
    water        TEXT CHECK (water IN ('less', 'normal', 'more')),
    energy       TEXT CHECK (energy IN ('low', 'normal', 'high')),
    potty        TEXT CHECK (potty IN ('normal', 'off')),
    symptoms     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS health_by_pet_date ON health_logs (pet_id, log_date);

-- Owner <-> caretaker chat, one thread per pet. Plain text only, so agents
-- can read it later. created_at is UTC. read_at is set when the other person
-- opens the thread.
CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id       INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    sender_role  TEXT NOT NULL CHECK (sender_role IN ('owner', 'caretaker')),
    sender_name  TEXT NOT NULL,
    text         TEXT NOT NULL DEFAULT '',
    photo_path   TEXT,
    created_at   TEXT NOT NULL,
    read_at      TEXT,
    CHECK (text != '' OR photo_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS messages_by_pet ON messages (pet_id, created_at);

-- One row per agent conversation (e.g. one setup-agent session). `state` is
-- the agent's working JSON: questions, answers, the proposal and each item's
-- approve/remove status. Nothing in here touches the real schedule; items
-- are only written to tasks/appointments/pets when the owner approves them.
CREATE TABLE IF NOT EXISTS agent_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id      INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    agent       TEXT NOT NULL,
    status      TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_runs_by_pet ON agent_runs (pet_id, created_at);

-- Step-by-step log of what each agent did, for the activity drawer.
CREATE TABLE IF NOT EXISTS agent_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER REFERENCES agent_runs(id) ON DELETE CASCADE,
    pet_id      INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    agent       TEXT NOT NULL,
    kind        TEXT NOT NULL,
    message     TEXT NOT NULL,
    detail      TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_events_by_pet ON agent_events (pet_id, id);

-- Health-log entries the watchdog spotted in messages ("she only ate half
-- today"). Nothing is logged until the caretaker approves one.
CREATE TABLE IF NOT EXISTS log_suggestions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id         INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    run_id         INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
    message_id     INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    log_date       TEXT NOT NULL,
    fields         TEXT NOT NULL,
    quote          TEXT NOT NULL DEFAULT '',
    reason         TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
    health_log_id  INTEGER REFERENCES health_logs(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL,
    decided_at     TEXT
);
CREATE INDEX IF NOT EXISTS log_suggestions_by_pet ON log_suggestions (pet_id, status);
"""

# Columns added after the first version, so older databases get them too.
MIGRATIONS = {
    "users": [
        ("photo_path", "TEXT"),
        ("is_sample", "INTEGER NOT NULL DEFAULT 0"),
        ("created_by", "TEXT"),
        ("created_at", "TEXT NOT NULL DEFAULT ''"),
    ],
    "pets": [
        ("home_timezone", "TEXT NOT NULL DEFAULT 'America/New_York'"),
        ("caretaker_name", "TEXT NOT NULL DEFAULT ''"),
        ("owner_id", "TEXT REFERENCES users(id)"),
        ("caretaker_id", "TEXT REFERENCES users(id)"),
        ("home_city", "TEXT NOT NULL DEFAULT ''"),
        ("home_flag", "TEXT NOT NULL DEFAULT ''"),
    ],
    "tasks": [
        ("replaces_task_id", "INTEGER REFERENCES tasks(id)"),
    ],
}


class _Connection(sqlite3.Connection):
    """`with connect() as conn:` commits (or rolls back) and then closes."""

    def __exit__(self, *exc):
        try:
            return super().__exit__(*exc)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, factory=_Connection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        for table, columns in MIGRATIONS.items():
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if not existing:
                continue  # new database: SCHEMA creates the table with every column
            for name, decl in columns:
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
        conn.executescript(SCHEMA)
        from backend.users import ensure_users  # (users imports db)
        ensure_users(conn)


def task_runs_on(task: sqlite3.Row | dict, day: date) -> bool:
    """True if this task is scheduled on `day`."""
    repeat = task["repeat"]
    weekday = day.weekday()  # Mon = 0
    if repeat == "daily":
        return True
    if repeat == "weekdays":
        return weekday < 5
    if repeat == "weekends":
        return weekday >= 5
    if repeat == "weekly":
        return task["repeat_on"] == WEEKDAYS[weekday]
    if repeat == "once":
        return task["repeat_on"] == day.isoformat()
    return False
