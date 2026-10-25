"""Setup Agent: turns the owner's casual care instructions into a reviewable
proposal of schedule tasks, appointments and profile quirks.

How a run works
1. The owner sends instructions. We store a run and log each step.
2. One model call with the fixed system prompt (prompts/setup_agent.md) plus
   a user message holding everything that changes: today, the pet, the
   current schedule, the instructions and any Q&A so far.
3. Code checks the answer (guardrails below). Vague or invalid items become
   short follow-up questions; anything that sounds like an emergency is
   flagged, never turned into a task.
4. If there are questions, we wait for the owner's answers and go to 2.
   After MAX_ROUNDS model calls we stop asking and propose what we can.
5. The owner approves, edits or removes each item. Only an approval writes
   to the real schedule, appointments or profile. The agent never does.
"""

import json
import re
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from backend.activity import log_event
from backend.ai import ask_structured
from backend.appointments import AppointmentIn
from backend.common import TIME_PATTERN, get_pet_row, home_now, utc_now_iso
from backend.config import REPO_DIR
from backend.db import WEEKDAYS, connect
from backend.schemas import TaskIn, insert_task

router = APIRouter(prefix="/api")

AGENT = "setup_agent"
MAX_ROUNDS = 3  # model calls per run; the last one may not ask questions
MAX_INSTRUCTIONS = 4000

# Fixed for the life of the process, so the prompt prefix is identical on
# every call and OpenAI can cache it.
SYSTEM_PROMPT = (REPO_DIR / "backend" / "prompts" / "setup_agent.md").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# What the model must return (strict JSON schema)
# ---------------------------------------------------------------------------


class Question(BaseModel):
    id: str
    about: str = Field(description="The vague phrase from the instructions.")
    question: str


class TaskProposal(BaseModel):
    title: str
    type: Literal["feed", "walk", "meds", "potty", "other"]
    time: str = Field(description="HH:MM, 24-hour, pet's home time")
    repeat: Literal["daily", "weekdays", "weekends", "weekly", "once"]
    repeat_on: str | None
    dose: str | None
    notes: str
    replaces_task_id: int | None
    source_text: str


class AppointmentProposal(BaseModel):
    kind: Literal["vet", "groomer", "other"]
    title: str
    date: str = Field(description="YYYY-MM-DD")
    time: str = Field(description="HH:MM, 24-hour")
    place_name: str
    address: str
    bring: str
    taken_by: Literal["owner", "caretaker"] | None
    source_text: str


class QuirkProposal(BaseModel):
    text: str
    source_text: str


class Flag(BaseModel):
    severity: Literal["emergency", "concern"]
    message: str
    advice: str
    source_text: str


class SetupResult(BaseModel):
    status: Literal["needs_answers", "ready"]
    questions: list[Question]
    tasks: list[TaskProposal]
    appointments: list[AppointmentProposal]
    quirks: list[QuirkProposal]
    flags: list[Flag]
    summary: str


# ---------------------------------------------------------------------------
# Safety net: emergency words the model must not miss
# ---------------------------------------------------------------------------

EMERGENCY_TERMS = [
    (r"(?<!took )(?<!drew )(?<!draw )(?<!taking )(?<!drawing )(?<!took some )(?<!took her )(?<!took his )\bblood\b(?!\s*(test|tests|work|panel|draw|drawn|sample|pressure|sugar))|\bbloody\b|\bbleed", "blood or bleeding"),
    (r"\bseizure|\bfitting\b|\bconvuls", "a seizure"),
    (r"\bcollaps", "collapsing"),
    (r"(can'?t|cannot|trouble|struggling to|hard to) breath|not breathing|\bgasping\b|\bchoking\b", "trouble breathing"),
    (r"\bpoison|\btoxic\b|\bxylitol\b|\bate (some |a |the )?(chocolate|grapes?|raisins?|lil(y|ies)|onions?)", "possible poisoning"),
    (r"(not|hasn'?t|has not|won'?t|stopped) (been )?eat(ing|en)?\b", "not eating"),
    (r"\bstraining\b|can'?t (pee|urinate)|\bno (pee|poop|urine)\b", "straining or not peeing"),
    (r"\bbloat|\bswollen (belly|stomach|abdomen)", "a bloated belly"),
    (r"\bparaly|can'?t (walk|stand)\b|\bunconscious\b", "weakness or collapse"),
]


def safety_scan(text: str) -> list[tuple[str, str]]:
    """(label, matched words) for every emergency term found in `text`."""
    hits = []
    for pattern, label in EMERGENCY_TERMS:
        m = re.search(pattern, text, flags=re.IGNORECASE)
        if m:
            hits.append((label, m.group(0)))
    return hits


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


def load_run(conn, run_id: int):
    row = conn.execute(
        "SELECT * FROM agent_runs WHERE id = ? AND agent = ?", (run_id, AGENT)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Setup run {run_id} not found.")
    return row


def save_run(run_id: int, status: str, state: dict) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE agent_runs SET status = ?, state = ?, updated_at = ? WHERE id = ?",
            (status, json.dumps(state), utc_now_iso(), run_id),
        )


def run_out(row) -> dict:
    return {
        "id": row["id"],
        "pet_id": row["pet_id"],
        "agent": row["agent"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        **json.loads(row["state"]),
    }


def get_run_out(run_id: int) -> dict:
    with connect() as conn:
        return run_out(load_run(conn, run_id))


# ---------------------------------------------------------------------------
# The model call
# ---------------------------------------------------------------------------


def build_input(conn, pet, state: dict, final_round: bool) -> str:
    """Everything that changes between calls. Goes after the fixed system prompt."""
    now = home_now(pet)
    tasks = conn.execute(
        "SELECT id, title, type, time, repeat, repeat_on, dose, notes FROM tasks "
        "WHERE pet_id = ? AND active = 1 ORDER BY time, id",
        (pet["id"],),
    ).fetchall()
    appts = conn.execute(
        "SELECT kind, title, date, time, place_name FROM appointments "
        "WHERE pet_id = ? AND date >= ? ORDER BY date, time",
        (pet["id"], now.date().isoformat()),
    ).fetchall()
    profile = {
        "name": pet["name"],
        "species": pet["species"],
        "breed": pet["breed"],
        "age_years": pet["age_years"],
        "weight": f"{pet['weight']} {pet['weight_unit']}" if pet["weight"] else None,
        "existing_quirks": pet["quirks"],
        "caretaker_name": pet["caretaker_name"],
        "home_timezone": pet["home_timezone"],
    }
    answered = [q for q in state["qa"] if q.get("answer")]
    parts = [
        f"## Today\n{now.strftime('%A')} {now.date().isoformat()}, {now.strftime('%H:%M')} "
        f"in the pet's home time zone ({pet['home_timezone']}).",
        "## Pet profile\n" + json.dumps(profile, ensure_ascii=False),
        "## Current schedule\n" + (
            "\n".join(json.dumps(dict(t), ensure_ascii=False) for t in tasks) or "(no tasks yet)"
        ),
        "## Upcoming appointments\n" + (
            "\n".join(json.dumps(dict(a), ensure_ascii=False) for a in appts) or "(none)"
        ),
        "## Owner's instructions\n" + state["instructions"],
        "## Follow-up so far\n" + (
            "\n".join(f"Q ({q['about']}): {q['question']}\nA: {q['answer']}" for q in answered)
            or "(none yet)"
        ),
        f"## Round\n{state['round']} of {MAX_ROUNDS}."
        + (" This is the final round: do not ask any questions." if final_round else ""),
    ]
    return "\n\n".join(parts)


def run_round(run_id: int) -> dict:
    """One model call plus guardrails. Updates the run and returns it."""
    with connect() as conn:
        row = load_run(conn, run_id)
        pet = get_pet_row(conn, row["pet_id"])
        state = json.loads(row["state"])
        state["round"] += 1
        final_round = state["round"] >= MAX_ROUNDS
        user_input = build_input(conn, pet, state, final_round)
        task_count = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE pet_id = ? AND active = 1", (pet["id"],)
        ).fetchone()[0]
        active_tasks = {
            r["id"]: dict(r) for r in conn.execute(
                "SELECT * FROM tasks WHERE pet_id = ? AND active = 1", (pet["id"],)
            )
        }
    pet_id = pet["id"]

    facts = [pet["species"], pet["breed"], f"{pet['age_years']:g} yrs" if pet["age_years"] else ""]
    log_event(pet_id, AGENT, "context",
              f"Read {pet['name']}'s profile ({', '.join(f for f in facts if f)}) "
              f"and current schedule ({task_count} tasks).", run_id)
    save_run(run_id, "thinking", state)

    try:
        result, stats = ask_structured(AGENT, SYSTEM_PROMPT, user_input, SetupResult, run_id=run_id)
    except Exception as exc:  # network, auth, missing model name, refusal...
        message = str(exc) or exc.__class__.__name__
        state["error"] = message
        log_event(pet_id, AGENT, "error", f"The model call failed: {message}", run_id)
        save_run(run_id, "error", state)
        return get_run_out(run_id)

    log_event(
        pet_id, AGENT, "model_call",
        f"Asked {stats.model}: {stats.input_tokens:,} tokens in "
        f"({stats.cached_tokens:,} cached), {stats.output_tokens:,} out, "
        f"{stats.duration_ms / 1000:.1f}s.",
        run_id,
        {"model": stats.model, "input_tokens": stats.input_tokens,
         "cached_tokens": stats.cached_tokens, "output_tokens": stats.output_tokens,
         "duration_ms": stats.duration_ms, "round": state["round"]},
    )

    apply_result(run_id, pet, state, result, active_tasks, final_round)
    return get_run_out(run_id)


# ---------------------------------------------------------------------------
# Guardrails: code decides what the owner sees
# ---------------------------------------------------------------------------


def _check_task(t: TaskProposal) -> str | None:
    """A follow-up question if this task can't be used as is, else None."""
    if not re.fullmatch(TIME_PATTERN, t.time or ""):
        return f"What time should “{t.title}” happen?"
    if t.type == "meds" and not (t.dose or "").strip():
        return f"What dose of “{t.title}” should be given?"
    if t.repeat == "weekly" and t.repeat_on not in WEEKDAYS:
        return f"Which day of the week is “{t.title}”?"
    if t.repeat == "once":
        try:
            date.fromisoformat(t.repeat_on or "")
        except ValueError:
            return f"Which date is “{t.title}”?"
    return None


def _check_appointment(a: AppointmentProposal, today: date) -> str | None:
    try:
        d = date.fromisoformat(a.date)
    except ValueError:
        return f"What date is the “{a.title}”?"
    if d < today:
        return f"The “{a.title}” looks like it's in the past. What date is it?"
    if d > today + timedelta(days=366):
        return f"Can you confirm the date of the “{a.title}”?"
    if not re.fullmatch(TIME_PATTERN, a.time or ""):
        return f"What time is the “{a.title}”?"
    return None


def apply_result(run_id: int, pet, state: dict, result: SetupResult,
                 active_tasks: dict[int, dict], final_round: bool) -> None:
    pet_id = pet["id"]
    today = home_now(pet).date()
    questions = [q.model_dump() for q in result.questions]
    left_out: list[str] = []

    # --- flags: always shown, never turned into items ---------------------
    # Flags are recomputed every round; only log the ones not logged before.
    logged = set(state.setdefault("logged_flags", []))

    def log_once(key: str, kind: str, message: str, detail: dict | None = None) -> None:
        if key not in logged:
            logged.add(key)
            state["logged_flags"].append(key)
            log_event(pet_id, AGENT, kind, message, run_id, detail)

    flags = []
    for f in result.flags:
        flags.append({**f.model_dump(), "id": f"f{len(flags) + 1}", "from": "agent"})
        log_once(f"agent:{f.source_text.lower()}", "flag",
                 f"Flagged {'a possible emergency' if f.severity == 'emergency' else 'a health concern'}: "
                 f"{f.message}", {"source_text": f.source_text})
    all_text = state["instructions"] + "\n" + "\n".join(q.get("answer") or "" for q in state["qa"])
    flagged_text = " ".join(f["source_text"] + " " + f["message"] for f in flags).lower()
    for label, words in safety_scan(all_text):
        if words.lower() in flagged_text:
            continue
        flags.append({
            "id": f"f{len(flags) + 1}", "from": "safety_check", "severity": "concern",
            "message": f"Your instructions mention “{words}” ({label}). That can be serious, "
                       f"so it wasn't turned into a task.",
            "advice": "If this is happening now or happened recently, call your vet before you leave.",
            "source_text": words,
        })
        log_once(f"safety:{words.lower()}", "safety_check",
                 f"Safety check spotted “{words}” and flagged it for you.")

    # --- items --------------------------------------------------------------
    items: list[dict] = []
    if result.status == "ready" or not questions:
        meds_now = [t for t in active_tasks.values() if t["type"] == "meds"]
        for t in result.tasks:
            problem = _check_task(t)
            if problem:
                if final_round:
                    left_out.append(t.title)
                    log_event(pet_id, AGENT, "guardrail",
                              f"Left out “{t.title}” because it's still unclear ({problem})", run_id)
                else:
                    questions.append({"id": f"g{len(questions) + 1}", "about": t.source_text, "question": problem})
                    log_event(pet_id, AGENT, "guardrail",
                              f"Held back “{t.title}” and asked instead: {problem}", run_id)
                continue
            data = t.model_dump()
            warnings = []
            if data["type"] != "meds":
                data["dose"] = None
            if data["repeat"] not in ("weekly", "once"):
                data["repeat_on"] = None
            if data["replaces_task_id"] is not None and data["replaces_task_id"] not in active_tasks:
                warnings.append("The agent pointed at a task to replace that isn't on the schedule, so nothing will be replaced.")
                data["replaces_task_id"] = None
            if data["replaces_task_id"] is not None:
                old = active_tasks[data["replaces_task_id"]]
                data["replaces"] = {"id": old["id"], "title": old["title"], "time": old["time"], "dose": old["dose"]}
            elif same := [
                x for x in active_tasks.values()
                if x["title"].strip().lower() == data["title"].strip().lower()
                or (x["type"] == data["type"] and x["time"] == data["time"])
            ]:
                x = same[0]
                warnings.append(f"{pet['name']} already has “{x['title']}” at {x['time']}. Approving adds a "
                                f"second one. Edit it and pick that task under “Replaces” if this is a change.")
            elif data["type"] == "meds" and meds_now:
                names = ", ".join(f"“{m['title']}” ({m['dose']} at {m['time']})" for m in meds_now)
                warnings.append(f"{pet['name']} already has {names}. Approving this adds another daily "
                                f"dose. Edit it to replace that task if it's a change.")
            items.append(_item("task", len(items), data, t.source_text, warnings))
        for a in result.appointments:
            problem = _check_appointment(a, today)
            if problem:
                if final_round:
                    left_out.append(a.title)
                    log_event(pet_id, AGENT, "guardrail",
                              f"Left out “{a.title}” because it's still unclear ({problem})", run_id)
                else:
                    questions.append({"id": f"g{len(questions) + 1}", "about": a.source_text, "question": problem})
                    log_event(pet_id, AGENT, "guardrail", f"Held back “{a.title}” and asked instead: {problem}", run_id)
                continue
            items.append(_item("appointment", len(items), a.model_dump(), a.source_text, []))
        for q in result.quirks:
            if q.text.strip():
                items.append(_item("quirk", len(items), q.model_dump(), q.source_text, []))

    # --- decide status -------------------------------------------------------
    if questions and not final_round:
        for i, q in enumerate(questions):
            q["id"] = f"r{state['round']}q{i + 1}"
            q["answer"] = None
            q["round"] = state["round"]
        state["qa"].extend(questions)
        state["items"] = []
        state["flags"] = flags
        state["summary"] = result.summary
        log_event(pet_id, AGENT, "question",
                  f"Asked {len(questions)} follow-up question{'s' if len(questions) != 1 else ''}: "
                  + " / ".join(q["question"] for q in questions), run_id)
        save_run(run_id, "needs_answers", state)
        return

    summary = result.summary
    if left_out:
        summary += f" Left out because they were still unclear: {', '.join(left_out)}."
    state["items"] = items
    state["flags"] = flags
    state["summary"] = summary
    counts = _counts(items)
    log_event(pet_id, AGENT, "proposal",
              f"Proposed {counts} for you to review. Nothing is saved until you approve it.", run_id)
    save_run(run_id, "proposal" if items else "done", state)


def _item(kind: str, n: int, data: dict, source_text: str, warnings: list[str]) -> dict:
    return {
        "id": f"{kind[0]}{n + 1}",
        "kind": kind,
        "state": "pending",
        "data": data,
        "proposed": dict(data),
        "source_text": source_text,
        "warnings": warnings,
        "saved_id": None,
    }


def _counts(items: list[dict]) -> str:
    def n(kind, word):
        c = sum(i["kind"] == kind for i in items)
        return f"{c} {word}{'s' if c != 1 else ''}" if c else ""
    parts = [p for p in (n("task", "task"), n("appointment", "appointment"), n("quirk", "quirk")) if p]
    return ", ".join(parts) if parts else "nothing new"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class StartBody(BaseModel):
    instructions: str = Field(min_length=3, max_length=MAX_INSTRUCTIONS)


class AnswersBody(BaseModel):
    answers: dict[str, str]


class ApproveBody(BaseModel):
    data: dict | None = None  # the owner's edited version; omit to approve as proposed


@router.post("/pets/{pet_id}/setup-agent", status_code=201)
def start_run(pet_id: int, body: StartBody) -> dict:
    instructions = body.instructions.strip()
    now = utc_now_iso()
    with connect() as conn:
        get_pet_row(conn, pet_id)
        state = {"instructions": instructions, "round": 0, "qa": [], "items": [],
                 "flags": [], "summary": "", "error": None}
        run_id = conn.execute(
            "INSERT INTO agent_runs (pet_id, agent, status, state, created_at, updated_at) "
            "VALUES (?, ?, 'thinking', ?, ?, ?)",
            (pet_id, AGENT, json.dumps(state), now, now),
        ).lastrowid
    log_event(pet_id, AGENT, "received",
              f"Got your instructions ({len(instructions):,} characters).", run_id,
              {"instructions": instructions})
    return run_round(run_id)


@router.get("/pets/{pet_id}/setup-agent/latest")
def latest_run(pet_id: int) -> dict | None:
    """The newest run that still needs the owner (to resume after a reload)."""
    with connect() as conn:
        get_pet_row(conn, pet_id)
        row = conn.execute(
            "SELECT * FROM agent_runs WHERE pet_id = ? AND agent = ? "
            "AND status IN ('needs_answers', 'proposal', 'thinking') ORDER BY id DESC LIMIT 1",
            (pet_id, AGENT),
        ).fetchone()
    return run_out(row) if row else None


@router.get("/setup-agent/{run_id}")
def get_run(run_id: int) -> dict:
    return get_run_out(run_id)


@router.post("/setup-agent/{run_id}/answers")
def answer_questions(run_id: int, body: AnswersBody) -> dict:
    with connect() as conn:
        row = load_run(conn, run_id)
    if row["status"] != "needs_answers":
        raise HTTPException(409, "This run isn't waiting for answers.")
    state = json.loads(row["state"])
    open_qs = [q for q in state["qa"] if not q.get("answer")]
    missing = [q["question"] for q in open_qs if not body.answers.get(q["id"], "").strip()]
    if missing:
        raise HTTPException(422, "Please answer every question: " + " / ".join(missing))
    for q in open_qs:
        q["answer"] = body.answers[q["id"]].strip()[:500]
    save_run(run_id, "thinking", state)
    log_event(row["pet_id"], AGENT, "answer",
              f"You answered {len(open_qs)} question{'s' if len(open_qs) != 1 else ''}.", run_id,
              {"answers": {q["question"]: q["answer"] for q in open_qs}})
    return run_round(run_id)


def _find_item(state: dict, item_id: str) -> dict:
    item = next((i for i in state["items"] if i["id"] == item_id), None)
    if item is None:
        raise HTTPException(404, f"Item {item_id} not found.")
    if item["state"] != "pending":
        raise HTTPException(409, f"This item was already {item['state']}.")
    return item


def _finish_if_reviewed(run_id: int, pet_id: int, state: dict) -> str:
    if all(i["state"] != "pending" for i in state["items"]):
        approved = sum(i["state"] == "approved" for i in state["items"])
        log_event(pet_id, AGENT, "done",
                  f"All items reviewed: {approved} approved, "
                  f"{len(state['items']) - approved} removed.", run_id)
        return "done"
    return "proposal"


@router.post("/setup-agent/{run_id}/items/{item_id}/approve")
def approve_item(run_id: int, item_id: str, body: ApproveBody) -> dict:
    """The only place a setup-agent item reaches the real data, and only on
    the owner's say-so. Saves go through the same validation as the editor."""
    with connect() as conn:
        row = load_run(conn, run_id)
        if row["status"] != "proposal":
            raise HTTPException(409, "This run has nothing waiting for approval.")
        state = json.loads(row["state"])
        item = _find_item(state, item_id)
        pet = get_pet_row(conn, row["pet_id"])
        data = {**item["data"], **(body.data or {})}
        edited = data != item["proposed"]

        try:
            if item["kind"] == "task":
                task = TaskIn(**{k: data.get(k) for k in TaskIn.model_fields})
                replaces = data.get("replaces_task_id")
                if replaces is not None:
                    old = conn.execute(
                        "SELECT * FROM tasks WHERE id = ? AND pet_id = ? AND active = 1",
                        (replaces, pet["id"]),
                    ).fetchone()
                    if old is None:
                        raise HTTPException(409, "The task this was meant to replace is no longer on the schedule. Remove the link or this item.")
                saved = insert_task(conn, pet["id"], task)
                data.pop("replaces", None)
                if replaces is not None:
                    data["replaces"] = {"id": old["id"], "title": old["title"], "time": old["time"], "dose": old["dose"]}
                    conn.execute("UPDATE tasks SET active = 0 WHERE id = ?", (replaces,))
                    conn.execute("UPDATE tasks SET replaces_task_id = ? WHERE id = ?", (replaces, saved["id"]))
                item["saved_id"] = saved["id"]
                what = f"task “{task.title}”" + (" (replacing the old one)" if replaces is not None else "")
            elif item["kind"] == "appointment":
                if not data.get("taken_by"):
                    raise HTTPException(422, "Choose who's taking the pet to this appointment first.")
                appt = AppointmentIn(**{k: data.get(k) or "" for k in AppointmentIn.model_fields})
                appt_id = conn.execute(
                    "INSERT INTO appointments (pet_id, kind, title, date, time, place_name, address, "
                    "taken_by, bring, visit_notes, created_at) VALUES (:pet_id, :kind, :title, :date, "
                    ":time, :place_name, :address, :taken_by, :bring, :visit_notes, :created_at)",
                    {**appt.model_dump(), "pet_id": pet["id"], "created_at": utc_now_iso()},
                ).lastrowid
                item["saved_id"] = appt_id
                what = f"appointment “{appt.title}”"
            else:
                text = str(data.get("text", "")).strip()
                if not text:
                    raise HTTPException(422, "The quirk is empty.")
                quirks = (pet["quirks"].rstrip() + "\n" + text).strip() if pet["quirks"] else text
                conn.execute("UPDATE pets SET quirks = ? WHERE id = ?", (quirks, pet["id"]))
                what = "a quirk to the profile"
        except ValidationError as exc:
            msg = "; ".join(e["msg"].removeprefix("Value error, ") for e in exc.errors())
            raise HTTPException(422, msg) from None

        item["data"] = data
        item["state"] = "approved"
        item["edited"] = edited
    # Log after the save is committed, then update the run.
    log_event(pet["id"], AGENT, "approved",
              f"You approved {what}{' with edits' if edited else ''}. Saved.", run_id)
    status = _finish_if_reviewed(run_id, pet["id"], state)
    save_run(run_id, status, state)
    return get_run_out(run_id)


@router.post("/setup-agent/{run_id}/items/{item_id}/remove")
def remove_item(run_id: int, item_id: str) -> dict:
    with connect() as conn:
        row = load_run(conn, run_id)
    if row["status"] != "proposal":
        raise HTTPException(409, "This run has nothing waiting for review.")
    state = json.loads(row["state"])
    item = _find_item(state, item_id)
    item["state"] = "removed"
    label = item["data"].get("title") or item["data"].get("text", "")[:40]
    log_event(row["pet_id"], AGENT, "removed", f"You removed “{label}”. Nothing saved.", run_id)
    status = _finish_if_reviewed(run_id, row["pet_id"], state)
    save_run(run_id, status, state)
    return get_run_out(run_id)
