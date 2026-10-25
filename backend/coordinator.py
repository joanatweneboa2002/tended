"""Coordinator: the "Run check" button. Plain code, no AI.

Runs the Watchdog, then the Daily Summary with the Watchdog's alerts, under
one RunBudget (max AI calls + token budget from config). Stops with a clear
message if a limit is hit, keeping whatever finished before the stop.
"""

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from backend import daily_summary, watchdog
from backend.activity import log_event
from backend.budget import BudgetStop, RunBudget
from backend.common import get_pet_row, utc_now_iso
from backend.db import connect

router = APIRouter(prefix="/api")

AGENT = "coordinator"
STALE_RUN = timedelta(minutes=3)


def _save(run_id: int, status: str, state: dict) -> None:
    with connect() as conn:
        conn.execute("UPDATE agent_runs SET status = ?, state = ?, updated_at = ? WHERE id = ?",
                     (status, json.dumps(state), utc_now_iso(), run_id))


def _out(row) -> dict | None:
    if row is None:
        return None
    return {"id": row["id"], "pet_id": row["pet_id"], "status": row["status"], "created_at": row["created_at"],
            "updated_at": row["updated_at"], **json.loads(row["state"])}


@router.post("/pets/{pet_id}/check")
def run_check(pet_id: int) -> dict:
    now = utc_now_iso()
    with connect() as conn:
        pet = get_pet_row(conn, pet_id)
        busy = conn.execute(
            "SELECT updated_at FROM agent_runs WHERE pet_id = ? AND agent = ? AND status = 'running' "
            "ORDER BY id DESC LIMIT 1", (pet_id, AGENT)).fetchone()
        if busy and datetime.now(timezone.utc) - datetime.fromisoformat(busy["updated_at"].replace("Z", "+00:00")) < STALE_RUN:
            raise HTTPException(409, "A check is already running for this pet.")
        budget = RunBudget(pet_id)
        state = {"steps": [], "alerts": [], "summary": None, "suspicious": [], "suggestions_created": 0,
                 "message": "", "budget": budget.snapshot()}
        run_id = conn.execute(
            "INSERT INTO agent_runs (pet_id, agent, status, state, created_at, updated_at) VALUES (?, ?, 'running', ?, ?, ?)",
            (pet_id, AGENT, json.dumps(state), now, now)).lastrowid

    log_event(pet_id, AGENT, "started",
              f"Run check started for {pet['name']}. Limits: {budget.max_calls} AI calls and "
              f"{budget.max_tokens:,} tokens.", run_id)

    def finish(status: str, message: str) -> dict:
        state["budget"] = budget.snapshot()
        state["message"] = message
        state["finished_at"] = utc_now_iso()
        kind = {"done": "done", "stopped": "stopped", "error": "error"}[status]
        log_event(pet_id, AGENT, kind, message, run_id, state["budget"])
        _save(run_id, status, state)
        with connect() as conn:
            return _out(conn.execute("SELECT * FROM agent_runs WHERE id = ?", (run_id,)).fetchone())

    # 1. Watchdog
    log_event(pet_id, AGENT, "step", "Step 1 of 2: running the Watchdog on the last 7 days.", run_id)
    try:
        wd = watchdog.run(pet, budget, run_id)
    except BudgetStop as stop:
        state["steps"].append({"agent": "watchdog", "status": "stopped"})
        return finish("stopped", stop.message)
    except Exception as exc:  # model/network errors
        state["steps"].append({"agent": "watchdog", "status": "error"})
        log_event(pet_id, watchdog.AGENT, "error", f"The Watchdog failed: {exc}", run_id)
        return finish("error", f"Stopped: the Watchdog couldn't finish ({exc}).")
    state.update(alerts=wd["alerts"], suspicious=wd["suspicious"], suggestions_created=wd["suggestions_created"])
    state["steps"].append({"agent": "watchdog", "status": "done"})
    _save(run_id, "running", {**state, "budget": budget.snapshot()})

    if budget.over_budget:
        return finish("stopped", f"Stopped after the Watchdog: this check used {budget.tokens:,} tokens, over its "
                                 f"{budget.max_tokens:,}-token budget, so the daily summary was skipped.")

    # 2. Daily summary, using the Watchdog's alerts
    log_event(pet_id, AGENT, "step",
              f"Step 2 of 2: running the Daily Summary with the Watchdog's {len(wd['alerts'])} alerts.", run_id)
    try:
        ds = daily_summary.run(pet, wd["alerts"], budget, run_id)
    except BudgetStop as stop:
        state["steps"].append({"agent": "daily_summary", "status": "stopped"})
        return finish("stopped", stop.message)
    except Exception as exc:
        state["steps"].append({"agent": "daily_summary", "status": "error"})
        log_event(pet_id, daily_summary.AGENT, "error", f"The Daily Summary failed: {exc}", run_id)
        return finish("error", f"The Watchdog finished, but the daily summary couldn't be written ({exc}).")
    state["summary"] = ds
    state["steps"].append({"agent": "daily_summary", "status": "done"})

    if budget.over_budget:
        return finish("stopped", f"Finished, but over budget: {budget.tokens:,} of {budget.max_tokens:,} tokens used.")
    return finish("done", f"Check finished: {budget.calls} of {budget.max_calls} AI calls, "
                          f"{budget.tokens:,} of {budget.max_tokens:,} tokens ({budget.cached:,} cached).")


@router.get("/pets/{pet_id}/check/latest")
def latest_check(pet_id: int) -> dict | None:
    with connect() as conn:
        get_pet_row(conn, pet_id)
        return _out(conn.execute(
            "SELECT * FROM agent_runs WHERE pet_id = ? AND agent = ? ORDER BY id DESC LIMIT 1",
            (pet_id, AGENT)).fetchone())
