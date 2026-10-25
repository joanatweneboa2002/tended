"""The one place Tended talks to OpenAI.

Every AI call goes through `ask()` or `ask_structured()`, which time the call
and write a row to data/token_log.csv (see token_log.py). Future agents should
use these (or, if they use another library, call `log_tokens()` themselves
after each call) so nothing is left out of the log.

Prompt caching: OpenAI caches the start of a prompt once it is 1024+ tokens
and identical between calls. Each agent therefore sends its fixed system
prompt as `instructions` (never edited per call) and puts everything that
changes (pet, schedule, owner's text) in `input`, after it. A stable
`prompt_cache_key` per agent helps route repeat calls to the same cache.
"""

import time
from dataclasses import dataclass
from typing import TypeVar

from openai import OpenAI
from pydantic import BaseModel

from backend.config import openai_api_key, openai_model
from backend.token_log import log_tokens, usage_counts

T = TypeVar("T", bound=BaseModel)


@dataclass
class CallStats:
    model: str
    input_tokens: int
    cached_tokens: int
    output_tokens: int
    duration_ms: int


def client() -> OpenAI:
    return OpenAI(api_key=openai_api_key())


def _log(agent: str, model: str, response, started: float, run_id=None) -> CallStats:
    duration_ms = round((time.perf_counter() - started) * 1000)
    input_tokens, cached_tokens, output_tokens = usage_counts(response.usage)
    stats = CallStats(response.model or model, input_tokens, cached_tokens, output_tokens, duration_ms)
    log_tokens(
        agent=agent,
        model=stats.model,
        input_tokens=input_tokens,
        cached_tokens=cached_tokens,
        output_tokens=output_tokens,
        duration_ms=duration_ms,
        run_id=run_id,
    )
    return stats


def ask(agent: str, instructions: str, user_input: str, model: str | None = None) -> str:
    """Send one request, log its tokens, and return the text reply."""
    model = model or openai_model()
    started = time.perf_counter()
    response = client().responses.create(
        model=model,
        instructions=instructions,
        input=user_input,
    )
    _log(agent, model, response, started)
    return response.output_text


def ask_structured(
    agent: str,
    instructions: str,
    user_input: str,
    schema: type[T],
    model: str | None = None,
    run_id: int | str | None = None,
) -> tuple[T, CallStats]:
    """Send one request that must answer with JSON matching `schema`.

    Returns the parsed object and the call's token/time stats (already logged).
    Raises ValueError if the model refused or returned nothing usable.
    """
    model = model or openai_model()
    started = time.perf_counter()
    response = client().responses.parse(
        model=model,
        instructions=instructions,
        input=user_input,
        text_format=schema,
        prompt_cache_key=f"tended-{agent}",
        store=False,
    )
    stats = _log(agent, model, response, started, run_id)
    parsed = response.output_parsed
    if parsed is None:
        raise ValueError("The model didn't return a usable answer.")
    return parsed, stats
