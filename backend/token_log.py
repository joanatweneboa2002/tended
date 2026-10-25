"""Append one row per AI call to data/token_log.csv.

Columns: timestamp (UTC, ISO 8601), agent, model, input_tokens, cached_tokens,
output_tokens, duration_ms, run_id. `cached_tokens` is the part of input_tokens
the provider served from its prompt cache. `run_id` groups the calls of one
agent run (one setup conversation, one Ask Tended question, one Run check);
older rows written before it existed have it blank.
"""

import csv
import threading
from datetime import datetime, timezone
from typing import Any

from backend.config import TOKEN_LOG_PATH

COLUMNS = [
    "timestamp",
    "agent",
    "model",
    "input_tokens",
    "cached_tokens",
    "output_tokens",
    "duration_ms",
    "run_id",
]

_lock = threading.Lock()


def ensure_token_log() -> None:
    TOKEN_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not TOKEN_LOG_PATH.exists() or TOKEN_LOG_PATH.stat().st_size == 0:
        with TOKEN_LOG_PATH.open("w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(COLUMNS)
        return
    # Older logs lack newer columns: rewrite once with the new header, keeping every row.
    with TOKEN_LOG_PATH.open(newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    if rows and rows[0] != COLUMNS:
        old = rows[0]
        with TOKEN_LOG_PATH.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(COLUMNS)
            for r in rows[1:]:
                rec = dict(zip(old, r))
                w.writerow([rec.get(c, "") for c in COLUMNS])


def log_tokens(
    agent: str,
    model: str,
    input_tokens: int,
    cached_tokens: int,
    output_tokens: int,
    duration_ms: int,
    run_id: int | str | None = None,
) -> None:
    with _lock:
        ensure_token_log()
        with TOKEN_LOG_PATH.open("a", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(
                [
                    datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    agent,
                    model,
                    int(input_tokens),
                    int(cached_tokens),
                    int(output_tokens),
                    int(duration_ms),
                    "" if run_id is None else run_id,
                ]
            )


def _get(obj: Any, name: str, default: Any = 0) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def usage_counts(usage: Any) -> tuple[int, int, int]:
    """(input, cached, output) from an OpenAI usage object.

    Handles both the Responses API shape (input_tokens / output_tokens /
    input_tokens_details.cached_tokens) and the Chat Completions shape
    (prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens).
    """
    input_tokens = _get(usage, "input_tokens", None)
    if input_tokens is not None:
        cached = _get(_get(usage, "input_tokens_details", None), "cached_tokens", 0)
        return int(input_tokens), int(cached or 0), int(_get(usage, "output_tokens", 0) or 0)

    cached = _get(_get(usage, "prompt_tokens_details", None), "cached_tokens", 0)
    return (
        int(_get(usage, "prompt_tokens", 0) or 0),
        int(cached or 0),
        int(_get(usage, "completion_tokens", 0) or 0),
    )
