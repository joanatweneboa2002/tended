"""Caretaker helper ("Ask Tended"): answers the caretaker's quick questions
using only three sources: the pet's profile + emergency card, the recent log,
and data/pet_reference.csv.

Order of work for each question
1. Read the profile and emergency card, check the recent log, check the
   reference rows for the pet's species (each step is logged).
2. Emergency override, in code, before any model call: if the question
   mentions poison, bleeding, a seizure, collapse or trouble breathing, or
   says the pet ate/licked something the reference marks as an emergency
   for this species, skip the normal answer and escalate.
3. Otherwise one model call: fixed system prompt (rules + the whole reference
   table, so it caches) plus the pet's context and the question.
4. Code checks the answer: every citation must exist (and reference rows must
   match the species); no citations means "not sure"; the model can escalate
   too; reassuring phrases get a "call the vet if..." line added.
"""

import json
import re
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend import reference
from backend.activity import log_event
from backend.ai import ask_structured
from backend.common import day_clock, get_pet_row, home_now, person_name, utc_now_iso
from backend.config import REPO_DIR
from backend.db import connect

router = APIRouter(prefix="/api")

AGENT = "caretaker_helper"
LOG_DAYS = 3
MAX_LOG_LINES = 40

# Fixed for the life of the process: rules + the whole reference table.
SYSTEM_PROMPT = (
    (REPO_DIR / "backend" / "prompts" / "caretaker_helper.md").read_text(encoding="utf-8")
    + reference.as_prompt_table()
    + "\n"
)

EMERGENCY_WORDS = [
    (r"\bpoison|\btoxic\b|\bantifreeze\b|\brat (poison|bait)", "possible poisoning"),
    # "they took blood" / "blood test" are vet procedures, not bleeding.
    (r"(?<!took )(?<!drew )(?<!draw )(?<!taking )(?<!drawing )(?<!took some )(?<!took her )(?<!took his )\bblood\b(?!\s*(test|tests|work|panel|draw|drawn|sample|pressure|sugar))|\bbloody\b|\bbleed", "bleeding"),
    (r"\bseizure|\bseizing\b|\bfitting\b|\bconvuls", "a seizure"),
    (r"\bcollaps|\bpassed out\b|\bfainted\b", "collapse"),
    (r"(can'?t|cannot|isn'?t|not|trouble|struggling to|hard to|hard time) breath|\bgasping\b|\bchoking\b|\bblue (gums|tongue)\b",
     "trouble breathing"),
    (r"\bunconscious\b|\bunresponsive\b|won'?t wake|\bhit by a car\b", "unresponsive or seriously injured"),
]

REASSURING = re.compile(
    r"\b(she'?s|he'?s|they'?re|it'?s|is|seems|looks)\s+(totally |perfectly |completely |probably |likely )?"
    r"(fine|okay|ok|normal|healthy)\b|nothing to worry|no need to (worry|call|see)|don'?t worry",
    re.IGNORECASE,
)


class HelperAnswer(BaseModel):
    status: Literal["answered", "not_sure", "emergency"]
    answer: str = Field(description="2-3 friendly sentences, or empty for not_sure/emergency.")
    citations: list[str]
    emergency_reason: str | None
    suggest_message_owner: bool


# ---------------------------------------------------------------------------
# Context: the only three sources, each line with an id the model must cite
# ---------------------------------------------------------------------------

# Emergency-card fields the model may see. Phone numbers, addresses and the
# microchip number are left out on purpose (privacy): the model never needs
# them to answer, and the emergency screen gets them straight from the
# database in code (see _emergency), never via the model.
CARD_FIELDS = [
    ("owner_name", "Owner"), ("backup_name", "Backup contact"), ("vet_name", "Vet"),
    ("allergies", "Allergies"), ("conditions", "Conditions"), ("medications", "Medications"),
    ("vaccines", "Vaccines"), ("diet", "Diet"), ("emergency_spending_limit", "Emergency spending limit"),
]
PRIVATE_CARD_FIELDS = ("owner_phone", "backup_phone", "vet_phone", "vet_address", "microchip_number")


def build_context(conn, pet) -> tuple[dict, dict]:
    """Returns (sources by id, card dict). Each source: kind, label, detail."""
    src: dict[str, dict] = {}

    def add(prefix: str, kind: str, label: str, detail: str):
        if detail in (None, ""):
            return
        sid = f"{prefix}{sum(1 for k in src if k.startswith(prefix)) + 1}"
        src[sid] = {"id": sid, "kind": kind, "label": label, "detail": str(detail)}

    add("P", "profile", "Name", pet["name"])
    add("P", "profile", "Species", ", ".join(x for x in (pet["species"], pet["breed"]) if x))
    add("P", "profile", "Age", f"{pet['age_years']:g} years" if pet["age_years"] is not None else "")
    add("P", "profile", "Weight", f"{pet['weight']:g} {pet['weight_unit']}" if pet["weight"] else "")
    add("P", "profile", "Quirks", pet["quirks"])
    add("P", "profile", "Caretaker", pet["caretaker_name"])
    for t in conn.execute(
        "SELECT title, type, time, repeat, repeat_on, dose, notes FROM tasks "
        "WHERE pet_id = ? AND active = 1 ORDER BY time", (pet["id"],)
    ):
        bits = [f"{t['time']} {t['repeat']}" + (f" ({t['repeat_on']})" if t["repeat_on"] else "")]
        if t["dose"]:
            bits.append(f"dose {t['dose']}")
        if t["notes"]:
            bits.append(t["notes"])
        add("P", "profile", f"Schedule: {t['title']}", "; ".join(bits))

    card_row = conn.execute("SELECT * FROM emergency_cards WHERE pet_id = ?", (pet["id"],)).fetchone()
    card = dict(card_row) if card_row else {}
    for key, label in CARD_FIELDS:
        value = card.get(key)
        if key == "emergency_spending_limit" and value is not None:
            value = f"up to ${value:,.0f}"
        add("E", "emergency_card", label, value)

    now = home_now(pet)
    since = (now.date() - timedelta(days=LOG_DAYS - 1)).isoformat()
    tz = now.tzinfo
    lines = []
    for c in conn.execute(
        "SELECT c.*, t.title FROM checkins c JOIN tasks t ON t.id = c.task_id "
        "WHERE c.pet_id = ? AND c.slot_date >= ? ORDER BY c.created_at DESC", (pet["id"], since)
    ):
        when = _local(c["created_at"], tz)
        what = "done" if c["status"] == "done" else f"couldn't do it ({c['reason']})"
        note = f" · “{c['note']}”" if c["note"] else ""
        lines.append((c["created_at"], f"Check-in {when}", f"{c['title']}: {what}{note}"))
    for h in conn.execute(
        "SELECT * FROM health_logs WHERE pet_id = ? AND log_date >= ? ORDER BY logged_at DESC",
        (pet["id"], since),
    ):
        parts = [f"{k} {h[k]}" for k in ("appetite", "energy", "water", "potty") if h[k]]
        if h["weight"] is not None:
            parts.insert(0, f"weight {h['weight']:g} {h['weight_unit']}")
        if h["symptoms"]:
            parts.append(f"notes “{h['symptoms']}”")
        lines.append((h["logged_at"], f"Health log {_local(h['logged_at'], tz)}", ", ".join(parts)))
    for _, label, detail in sorted(lines, reverse=True)[:MAX_LOG_LINES]:
        add("L", "log", label, detail)
    return src, card


def _local(iso_utc: str, tz) -> str:
    return day_clock(datetime.fromisoformat(iso_utc.replace("Z", "+00:00")).astimezone(tz))


def build_input(pet, src: dict, owner: str, question: str) -> str:
    ref_species = reference.reference_species(pet["species"]) or "none (no reference rows apply)"
    now = home_now(pet)

    def block(prefix):
        return "\n".join(f"[{s['id']}] {s['label']}: {s['detail']}" for s in src.values()
                         if s["id"].startswith(prefix)) or "(nothing)"

    return "\n\n".join([
        f"## Pet\nReference species: {ref_species}\nOwner's name: {owner}\n"
        f"Now: {now.strftime('%A %Y-%m-%d %H:%M')} (pet's home time)",
        "## Profile and schedule\n" + block("P"),
        "## Emergency card\n" + block("E"),
        f"## Recent log (last {LOG_DAYS} days, newest first, home time)\n" + block("L"),
        f"## Caretaker's question\n{question}",
    ])


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


def _owner_first(owner_name: str) -> str:
    return owner_name.split()[0] if owner_name and owner_name != "Owner" else "the owner"


def _ref_source(row: dict) -> dict:
    return {"id": row["id"], "kind": "reference", "label": row["topic"], "detail": row["info"],
            "source": row["source"]}


def _emergency(card: dict, owner: str, reason: str, ref_rows: list[dict]) -> dict:
    return {
        "reason": reason,
        "vet_name": card.get("vet_name") or "",
        "vet_phone": card.get("vet_phone") or "",
        "vet_address": card.get("vet_address") or "",
        "spending_limit": card.get("emergency_spending_limit"),
        "owner_name": owner,
        "owner_phone": card.get("owner_phone") or "",
        "backup_name": card.get("backup_name") or "",
        "backup_phone": card.get("backup_phone") or "",
        "reference": [_ref_source(r) for r in ref_rows],
    }


def _save(run_id: int, status: str, state: dict) -> None:
    with connect() as conn:
        conn.execute("UPDATE agent_runs SET status = ?, state = ?, updated_at = ? WHERE id = ?",
                     (status, json.dumps(state), utc_now_iso(), run_id))


def _out(run_id: int) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT * FROM agent_runs WHERE id = ? AND agent = ?", (run_id, AGENT)).fetchone()
    if row is None:
        raise HTTPException(404, f"Question {run_id} not found.")
    return {"id": row["id"], "pet_id": row["pet_id"], "status": row["status"],
            "created_at": row["created_at"], **json.loads(row["state"])}


class AskBody(BaseModel):
    question: str = Field(min_length=2, max_length=500)


@router.post("/pets/{pet_id}/helper", status_code=201)
def ask(pet_id: int, body: AskBody) -> dict:
    question = body.question.strip()
    now_iso = utc_now_iso()
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        owner = person_name(conn, pet, "owner")
        src, card = build_context(conn, pet)
        state = {"question": question, "answer": "", "sources": [], "emergency": None,
                 "suggest_message_owner": False, "messaged_owner": False, "owner_name": owner}
        run_id = conn.execute(
            "INSERT INTO agent_runs (pet_id, agent, status, state, created_at, updated_at) "
            "VALUES (?, ?, 'thinking', ?, ?, ?)", (pet_id, AGENT, json.dumps(state), now_iso, now_iso),
        ).lastrowid

    first = _owner_first(owner)
    ref_species = reference.reference_species(pet["species"])
    ref_rows = reference.rows_for(pet["species"])
    n = lambda p: sum(1 for k in src if k.startswith(p))  # noqa: E731
    log_event(pet_id, AGENT, "received", f"Caretaker asked: “{question}”", run_id)
    log_event(pet_id, AGENT, "context",
              f"Read {pet['name']}'s profile, schedule and emergency card ({n('P') + n('E')} facts).", run_id)
    log_event(pet_id, AGENT, "log",
              f"Checked the recent log ({n('L')} entries from the last {LOG_DAYS} days).", run_id)
    log_event(pet_id, AGENT, "reference",
              f"Checked the reference for {ref_species + 's' if ref_species else 'this species'} "
              f"({len(ref_rows)} rows)." if ref_rows else
              f"No reference rows for “{pet['species']}”, so only the profile and log can answer.", run_id)

    # --- 2. Emergency override (code, no model) -----------------------------
    words = [(label, m.group(0)) for pat, label in EMERGENCY_WORDS
             if (m := re.search(pat, question, re.IGNORECASE))]
    toxins = reference.toxin_matches(pet["species"], question)
    if words or toxins:
        if toxins:
            reason = f"{toxins[0]['topic']}: {toxins[0]['info']}"
        else:
            reason = f"The question mentions {words[0][0]}. That needs a vet now."
        state.update(status="emergency", answer="", suggest_message_owner=True,
                     emergency=_emergency(card, owner, reason, toxins),
                     sources=[_ref_source(r) for r in toxins])
        trigger = ", ".join([f"“{w}”" for _, w in words] + [f"{r['topic']} ({r['source']})" for r in toxins])
        log_event(pet_id, AGENT, "escalated",
                  f"Red flag spotted: {trigger}. Skipped the normal answer and showed the vet's number "
                  f"and the approved spending limit.", run_id)
        _save(run_id, "emergency", state)
        return _out(run_id)

    # --- 3. Model ------------------------------------------------------------
    try:
        result, stats = ask_structured(AGENT, SYSTEM_PROMPT, build_input(pet, src, owner, question), HelperAnswer,
                                       run_id=run_id)
    except Exception as exc:
        message = str(exc) or exc.__class__.__name__
        log_event(pet_id, AGENT, "error", f"The model call failed: {message}", run_id)
        state.update(status="not_sure", answer=f"I'm not sure, ask {first}.", suggest_message_owner=True,
                     error=message)
        _save(run_id, "not_sure", state)
        return _out(run_id)
    log_event(pet_id, AGENT, "model_call",
              f"Asked {stats.model}: {stats.input_tokens:,} tokens in ({stats.cached_tokens:,} cached), "
              f"{stats.output_tokens:,} out, {stats.duration_ms / 1000:.1f}s.", run_id,
              {"model": stats.model, "input_tokens": stats.input_tokens, "cached_tokens": stats.cached_tokens,
               "output_tokens": stats.output_tokens, "duration_ms": stats.duration_ms})

    # --- 4. Check the answer ---------------------------------------------------
    cited = []
    for cid in dict.fromkeys(c.strip().strip("[]") for c in result.citations):
        if cid in src:
            cited.append(src[cid])
        elif cid in reference.BY_ID and reference.BY_ID[cid]["species"] == ref_species:
            cited.append(_ref_source(reference.BY_ID[cid]))
    status = result.status

    if status == "emergency":
        refs = [reference.BY_ID[s["id"]] for s in cited if s["kind"] == "reference"]
        reason = result.emergency_reason or "This could be an emergency."
        state.update(status="emergency", answer="", suggest_message_owner=True,
                     emergency=_emergency(card, owner, reason, refs), sources=cited)
        log_event(pet_id, AGENT, "escalated",
                  f"Escalated: {reason} Showed the vet's number and the approved spending limit.", run_id)
        _save(run_id, "emergency", state)
        return _out(run_id)

    if status == "answered" and (not cited or not result.answer.strip()):
        log_event(pet_id, AGENT, "guardrail",
                  "The answer had no sources from the profile, log or reference, so it became “not sure”.", run_id)
        status = "not_sure"

    if status == "not_sure":
        state.update(status="not_sure", answer=f"I'm not sure, ask {first}.", sources=[],
                     suggest_message_owner=True)
        log_event(pet_id, AGENT, "not_sure",
                  f"Not in the profile, log or reference. Suggested asking {first}.", run_id)
        _save(run_id, "not_sure", state)
        return _out(run_id)

    answer = result.answer.strip()
    suggest = result.suggest_message_owner
    if REASSURING.search(answer):
        vet = card.get("vet_name") or "the vet"
        answer += f" If anything changes or you're worried, call {vet} or message {first}."
        suggest = True
        log_event(pet_id, AGENT, "guardrail",
                  "The answer sounded reassuring, so a “call the vet if you're worried” line was added.", run_id)
    state.update(status="answered", answer=answer, sources=cited, suggest_message_owner=suggest)
    used = ", ".join(_source_label(s) for s in cited)
    log_event(pet_id, AGENT, "answered", f"Answered using: {used}.", run_id)
    _save(run_id, "answered", state)
    return _out(run_id)


def _source_label(s: dict) -> str:
    if s["kind"] == "reference":
        return f"reference “{s['label']}” ({s['source']})"
    return {"profile": "profile", "emergency_card": "emergency card", "log": "log"}[s["kind"]] + f" ({s['label']})"


@router.get("/helper/{run_id}")
def get_answer(run_id: int) -> dict:
    return _out(run_id)


@router.post("/helper/{run_id}/message-owner")
def message_owner(run_id: int) -> dict:
    """One tap: send the caretaker's question (and what Tended said) to the owner."""
    run = _out(run_id)
    if run["messaged_owner"]:
        raise HTTPException(409, "Already sent to the owner.")
    with connect() as conn:
        pet = get_pet_row(conn, run["pet_id"])
        sender = person_name(conn, pet, "caretaker")
        q = run["question"]
        if run["status"] == "emergency":
            e = run["emergency"]
            vet = f" I'm calling {e['vet_name']} at {e['vet_phone']}." if e["vet_phone"] else ""
            text = f"🚨 URGENT about {pet['name']}: “{q}”. Ask Tended flagged this as a possible emergency.{vet}"
        elif run["status"] == "answered":
            text = f"Quick question about {pet['name']}: “{q}”. Ask Tended said: {run['answer']}"
        else:
            text = f"Question about {pet['name']}: “{q}”. Ask Tended wasn't sure, can you help?"
        msg_id = conn.execute(
            "INSERT INTO messages (pet_id, sender_role, sender_name, text, created_at) VALUES (?, 'caretaker', ?, ?, ?)",
            (pet["id"], sender, text, utc_now_iso()),
        ).lastrowid
        row = conn.execute("SELECT * FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
        state = json.loads(row["state"])
        state["messaged_owner"] = True
        conn.execute("UPDATE agent_runs SET state = ?, updated_at = ? WHERE id = ?",
                     (json.dumps(state), utc_now_iso(), run_id))
    log_event(pet["id"], AGENT, "messaged",
              f"Sent the question to {_owner_first(run['owner_name'])} as a message.", run_id, {"message_id": msg_id})
    return _out(run_id)
