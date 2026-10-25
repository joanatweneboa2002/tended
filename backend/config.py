"""Paths and settings for the Tended backend.

.env lookup order: this repo folder first, then one folder up. Both are loaded
with override=False, so a key in the repo's .env wins over the one above it,
and the folder above only fills in keys the repo's .env doesn't set.
"""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_DIR / "data"
PHOTOS_DIR = DATA_DIR / "photos"
DB_PATH = DATA_DIR / "tended.db"
TOKEN_LOG_PATH = DATA_DIR / "token_log.csv"

ENV_FILES = [REPO_DIR / ".env", REPO_DIR.parent / ".env"]
LOADED_ENV_FILES: list[Path] = []
for _env in ENV_FILES:
    if _env.is_file():
        load_dotenv(_env, override=False)
        LOADED_ENV_FILES.append(_env)


# ---- which AI provider to use -------------------------------------------
# OpenAI is the main option; Portkey (the course key) is the fallback.
#   OPENAI_API_KEY set           -> OpenAI, model = OPENAI_MODEL or DEFAULT_OPENAI_MODEL
#   only PORTKEY_API_KEY set     -> Portkey gateway, model = PORTKEY_MODEL
#   both set                     -> OpenAI
#   neither                      -> the app runs; AI features explain which key to add
DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"
PORTKEY_BASE_URL = "https://api.portkey.ai/v1"
PORTKEY_MODEL = "gpt-6-luna"

NO_KEY_MESSAGE = (
    "AI is off because no API key was found. Add OPENAI_API_KEY (your own OpenAI key) or "
    "PORTKEY_API_KEY (the course Portkey key) to a .env file in the tended folder or one "
    "folder up, then restart the backend."
)


class AIUnavailable(RuntimeError):
    """No usable API key: shown to the user as a friendly message."""


@dataclass(frozen=True)
class AIProvider:
    name: str  # "openai" | "portkey"
    api_key: str
    model: str
    base_url: str | None = None
    model_is_default: bool = False

    @property
    def headers(self) -> dict[str, str]:
        return {"x-portkey-api-key": self.api_key} if self.name == "portkey" else {}


def ai_provider() -> AIProvider:
    """Read on every call, so editing .env takes effect after a backend restart."""
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    portkey_key = os.getenv("PORTKEY_API_KEY", "").strip()
    if openai_key:
        model = os.getenv("OPENAI_MODEL", "").strip()
        return AIProvider("openai", openai_key, model or DEFAULT_OPENAI_MODEL, model_is_default=not model)
    if portkey_key:
        return AIProvider("portkey", portkey_key, PORTKEY_MODEL, base_url=PORTKEY_BASE_URL)
    raise AIUnavailable(NO_KEY_MESSAGE)


def ai_status_line() -> str:
    """One line for the backend terminal at startup."""
    where = ", ".join(str(p) for p in LOADED_ENV_FILES) or "no .env file found"
    try:
        p = ai_provider()
    except AIUnavailable:
        return f"Tended AI: OFF (no OPENAI_API_KEY or PORTKEY_API_KEY). .env files read: {where}"
    if p.name == "openai":
        model = f"{p.model} (default; set OPENAI_MODEL to change)" if p.model_is_default else f"{p.model} (from OPENAI_MODEL)"
        return f"Tended AI: using OpenAI, model {model}. .env files read: {where}"
    return f"Tended AI: using Portkey ({p.base_url}), model {p.model}. .env files read: {where}"


# ---- limits for one "Run check" (coordinator) ----------------------------
# Override in .env if needed. The coordinator stops cleanly at either limit.
def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


MAX_AI_CALLS_PER_RUN = _int_env("TENDED_MAX_AI_CALLS_PER_RUN", 5)
TOKEN_BUDGET_PER_RUN = _int_env("TENDED_TOKEN_BUDGET_PER_RUN", 40000)  # input + output tokens


# ---- model prices (USD per 1 million tokens), used by scripts/cost_report.py
# Model: gpt-5.6-luna (OpenAI). Check and confirm these at
#   https://openai.com/api/pricing  (official; needs a browser)
#   https://artificialanalysis.ai/models/gpt-5-6-luna/providers
# As of 2026-10-25 Artificial Analysis lists $0.20 input and $1.20 output per 1M.
# The cached-input price isn't shown there; $0.02 (10% of input, OpenAI's usual
# cache discount) matches its blended price of $0.17 at a 7:2:1 ratio.
# Confirmed Oct 2026 (input $0.20, cached input $0.02, output $1.20 per 1M) on:
#   https://pricepertoken.com
#   https://developer.puter.com
PRICE_INPUT_PER_M = 0.20
PRICE_CACHED_INPUT_PER_M = 0.02
PRICE_OUTPUT_PER_M = 1.20
PRICES_CONFIRMED = True

# Prices per model (input, cached input, output), USD per 1M tokens. Calls to
# a model that isn't listed here (e.g. gpt-6-luna via Portkey) are counted in
# the token averages but left out of the dollar totals, with a note.
MODEL_PRICES = {
    "gpt-5.6-luna": (PRICE_INPUT_PER_M, PRICE_CACHED_INPUT_PER_M, PRICE_OUTPUT_PER_M),
}
