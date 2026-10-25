"""Invite codes: how a caretaker joins an owner's pet.

The owner creates a code for one pet (e.g. FYNN-K7P2) and sends it to their
caretaker. The caretaker enters it with their name and city; that creates
their profile, linked to that pet only. Codes are random, single use and
expire after 7 days; a wrong, used or expired code can't join anything.
"""

import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.common import get_pet_row, pet_out, read_photo, remove_photo, save_photo, utc_now_iso
from backend.db import connect
from backend.users import Me, new_user, user_out

router = APIRouter(prefix="/api")

VALID_DAYS = 7
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O or 1/I, so codes are easy to read out
RANDOM_CHARS = 4  # 32^4 ≈ 1 million codes per pet name


def _iso(at: datetime) -> str:
    return at.isoformat(timespec="seconds").replace("+00:00", "Z")


def normalise(code: str) -> str:
    return re.sub(r"[^A-Z0-9-]", "", code.upper().replace(" ", "-")).strip("-")


def _new_code(pet_name: str) -> str:
    prefix = re.sub(r"[^A-Z]", "", pet_name.upper())[:6] or "PET"
    return f"{prefix}-{''.join(secrets.choice(ALPHABET) for _ in range(RANDOM_CHARS))}"


class InviteIn(BaseModel):
    name: str = Field(default="", max_length=40)  # the caretaker, for the message
    city: str = Field(default="", max_length=60)


@router.post("/pets/{pet_id}/invites", status_code=201)
def create_invite(pet_id: int, body: InviteIn, user=Me) -> dict:
    """The owner invites their caretaker to this pet."""
    if user["role"] != "owner":
        raise HTTPException(403, "Only the pet's owner can invite a caretaker.")
    now = datetime.now(timezone.utc)
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        for _ in range(20):  # a clash is very unlikely; just pick again
            code = _new_code(pet["name"])
            if not conn.execute("SELECT 1 FROM invites WHERE code = ?", (code,)).fetchone():
                break
        conn.execute(
            "INSERT INTO invites (code, pet_id, created_by, caretaker_name, caretaker_city, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (code, pet_id, user["id"], body.name.strip(), body.city.strip(), _iso(now), _iso(now + timedelta(days=VALID_DAYS))),
        )
    return {"code": code, "pet_name": pet["name"], "caretaker_name": body.name.strip(), "expires_at": _iso(now + timedelta(days=VALID_DAYS))}


def _usable(conn, code: str):
    """The invite row, or a friendly HTTP error saying why it can't be used."""
    row = conn.execute("SELECT * FROM invites WHERE code = ?", (normalise(code),)).fetchone()
    if row is None:
        raise HTTPException(404, "That code doesn't match any pet. Check it with the owner (it looks like FYNN-K7P2).")
    if row["used_at"]:
        raise HTTPException(410, "This code has already been used. Ask the owner for a new one.")
    if row["expires_at"] <= utc_now_iso():
        raise HTTPException(410, "This code has expired (codes last 7 days). Ask the owner for a new one.")
    return row


@router.get("/invites/{code}")
def check_invite(code: str) -> dict:
    """Before joining: which pet is this code for? (Nothing is used up.)"""
    with connect() as conn:
        row = _usable(conn, code)
        pet = pet_out(get_pet_row(conn, row["pet_id"]))
    return {"pet_name": pet["name"], "pet_photo_url": pet["photo_url"], "home_city": pet["home_city"],
            "home_flag": pet["home_flag"], "owner_name": pet["owner_name"],
            "caretaker_name": row["caretaker_name"], "caretaker_city": row["caretaker_city"]}


@router.post("/join-pet", status_code=201)
async def join_pet(
    code: str = Form(...),
    name: str = Form(...),
    city: str = Form(...),
    photo: UploadFile | None = File(None),
) -> dict:
    """The caretaker joins with the owner's code: a new profile, linked to that pet only."""
    checked = await read_photo(photo)
    saved = save_photo(checked, "user") if checked else None
    try:
        with connect() as conn:
            row = _usable(conn, code)
            pet = get_pet_row(conn, row["pet_id"])
            # They're with the pet, so they live on the pet's clock.
            carer = new_user(conn, name, "caretaker", city, pet["home_timezone"], created_by=row["created_by"], photo=saved)
            # Use the code up in the same transaction: a second join with it finds it used.
            taken = conn.execute(
                "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_at IS NULL",
                (carer["id"], utc_now_iso(), row["code"]),
            ).rowcount
            if taken != 1:
                raise HTTPException(410, "This code has already been used. Ask the owner for a new one.")
            conn.execute("UPDATE pets SET caretaker_id = ?, caretaker_name = ? WHERE id = ?",
                         (carer["id"], carer["name"], pet["id"]))
            return user_out(carer)
    except BaseException:
        remove_photo(saved)
        raise
