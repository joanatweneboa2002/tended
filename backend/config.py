"""Paths and settings for the Tended backend.

.env lookup order: this repo folder first, then one folder up. Both are loaded
with override=False, so a key in the repo's .env wins over the one above it,
and the folder above only fills in keys the repo's .env doesn't set.
"""

import os
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


def openai_api_key() -> str:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add it to .env in this folder or one folder up."
        )
    return key


def openai_model() -> str:
    """Read on every call, so changing OPENAI_MODEL takes effect on restart."""
    model = os.getenv("OPENAI_MODEL", "").strip()
    if not model:
        raise RuntimeError(
            "OPENAI_MODEL is not set. Add e.g. OPENAI_MODEL=<model name> to your .env."
        )
    return model


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
# Set PRICES_CONFIRMED = True once you've checked them against OpenAI's page.
PRICE_INPUT_PER_M = 0.20
PRICE_CACHED_INPUT_PER_M = 0.02
PRICE_OUTPUT_PER_M = 1.20
PRICES_CONFIRMED = False
