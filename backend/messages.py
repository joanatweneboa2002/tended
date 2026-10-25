"""Owner <-> caretaker chat, one thread per pet.

Each message is stored as plain fields (pet, sender role, sender name, UTC
time, text, optional photo) so an agent can read the thread later.
"""

from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.common import (
    get_pet_row,
    person_name,
    read_photo,
    remove_photo,
    save_photo,
    utc_now_iso,
    with_photo_url,
)
from backend.db import connect

router = APIRouter(prefix="/api")

Role = Literal["owner", "caretaker"]
MAX_TEXT = 2000


def unread_count(conn, pet_id: int, role: str) -> int:
    """Messages from the other person that `role` hasn't opened yet."""
    return conn.execute(
        "SELECT COUNT(*) FROM messages WHERE pet_id = ? AND sender_role != ? AND read_at IS NULL",
        (pet_id, role),
    ).fetchone()[0]


def latest_message(conn, pet_id: int) -> dict | None:
    row = conn.execute(
        "SELECT * FROM messages WHERE pet_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        (pet_id,),
    ).fetchone()
    return with_photo_url(row) if row else None


@router.get("/pets/{pet_id}/messages")
def list_messages(pet_id: int, after_id: int = 0) -> list[dict]:
    """The thread oldest first. `after_id` returns only newer messages."""
    with connect() as conn:
        get_pet_row(conn, pet_id)
        rows = conn.execute(
            "SELECT * FROM messages WHERE pet_id = ? AND id > ? ORDER BY created_at, id",
            (pet_id, after_id),
        ).fetchall()
    return [with_photo_url(r) for r in rows]


@router.post("/pets/{pet_id}/messages", status_code=201)
async def send_message(
    pet_id: int,
    sender_role: Role = Form(...),
    text: str = Form(""),
    photo: UploadFile | None = File(None),
) -> dict:
    text = text.strip()
    if len(text) > MAX_TEXT:
        raise HTTPException(422, f"Messages can be up to {MAX_TEXT} characters.")
    checked = await read_photo(photo)
    if not text and checked is None:
        raise HTTPException(422, "Write something or add a photo.")
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        name = person_name(conn, pet, sender_role)
    saved = save_photo(checked, f"msg{pet_id}") if checked else None
    try:
        with connect() as conn:
            msg_id = conn.execute(
                "INSERT INTO messages (pet_id, sender_role, sender_name, text, photo_path, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (pet_id, sender_role, name, text, saved, utc_now_iso()),
            ).lastrowid
            # Sending a reply means you've seen everything before it.
            conn.execute(
                "UPDATE messages SET read_at = ? WHERE pet_id = ? AND sender_role != ? "
                "AND read_at IS NULL",
                (utc_now_iso(), pet_id, sender_role),
            )
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (msg_id,)).fetchone()
    except BaseException:
        remove_photo(saved)
        raise
    return with_photo_url(row)


@router.post("/pets/{pet_id}/messages/read")
def mark_read(pet_id: int, role: Role) -> dict:
    """`role` has opened the thread: mark the other person's messages read."""
    with connect() as conn:
        get_pet_row(conn, pet_id)
        conn.execute(
            "UPDATE messages SET read_at = ? WHERE pet_id = ? AND sender_role != ? "
            "AND read_at IS NULL",
            (utc_now_iso(), pet_id, role),
        )
    return {"unread": 0}


@router.get("/pets/{pet_id}/messages/unread")
def get_unread(pet_id: int, role: Role) -> dict:
    with connect() as conn:
        get_pet_row(conn, pet_id)
        return {"unread": unread_count(conn, pet_id, role)}
