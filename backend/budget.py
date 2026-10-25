"""Per-run limits for multi-agent checks: max AI calls and a token budget.

Every AI call made during one "Run check" goes through `RunBudget.call()`.
Before a call it refuses if the call limit is reached or if the call would
likely push the run over its token budget (estimated from prompt length).
After a call it adds the real token count; if that went over the budget the
run is marked `over_budget` and the coordinator stops before the next agent.
"""

from pydantic import BaseModel

from backend.activity import log_event
from backend.ai import CallStats, ask_structured
from backend.config import MAX_AI_CALLS_PER_RUN, TOKEN_BUDGET_PER_RUN

OUTPUT_ALLOWANCE = 2500  # tokens we expect a reply may need, for the pre-call estimate


class BudgetStop(Exception):
    """Raised instead of making a call that would break a limit."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind  # "call_limit" | "token_budget"
        self.message = message


class RunBudget:
    def __init__(self, pet_id: int, max_calls: int = MAX_AI_CALLS_PER_RUN,
                 max_tokens: int = TOKEN_BUDGET_PER_RUN):
        self.pet_id = pet_id
        self.max_calls = max_calls
        self.max_tokens = max_tokens
        self.calls = 0
        self.tokens = 0
        self.cached = 0

    @property
    def over_budget(self) -> bool:
        return self.tokens > self.max_tokens

    def snapshot(self) -> dict:
        return {"max_calls": self.max_calls, "calls": self.calls, "max_tokens": self.max_tokens,
                "tokens": self.tokens, "cached_tokens": self.cached}

    def call(self, agent: str, system_prompt: str, user_input: str, schema: type[BaseModel],
             run_id: int | None = None) -> tuple[BaseModel, CallStats]:
        if self.calls >= self.max_calls:
            raise BudgetStop("call_limit",
                             f"Stopped: this check reached its limit of {self.max_calls} AI calls.")
        estimate = (len(system_prompt) + len(user_input)) // 4 + OUTPUT_ALLOWANCE
        left = self.max_tokens - self.tokens
        if estimate > left:
            raise BudgetStop("token_budget",
                             f"Stopped: the next AI call needs about {estimate:,} tokens but only "
                             f"{max(left, 0):,} of this check's {self.max_tokens:,}-token budget is left.")
        self.calls += 1
        result, stats = ask_structured(agent, system_prompt, user_input, schema, run_id=run_id)
        self.tokens += stats.input_tokens + stats.output_tokens
        self.cached += stats.cached_tokens
        log_event(
            self.pet_id, agent, "model_call",
            f"Asked {stats.model}: {stats.input_tokens:,} tokens in ({stats.cached_tokens:,} cached), "
            f"{stats.output_tokens:,} out, {stats.duration_ms / 1000:.1f}s. "
            f"Check so far: {self.calls}/{self.max_calls} calls, {self.tokens:,}/{self.max_tokens:,} tokens.",
            run_id,
            {"model": stats.model, "input_tokens": stats.input_tokens, "cached_tokens": stats.cached_tokens,
             "output_tokens": stats.output_tokens, "duration_ms": stats.duration_ms},
        )
        return result, stats
