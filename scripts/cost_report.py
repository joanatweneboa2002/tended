"""Cost report from data/token_log.csv → logs/cost_report.md

    .venv/bin/python scripts/cost_report.py

What counts as one "run":
- setup_agent: one setup conversation (all its rounds)
- caretaker_helper: one Ask Tended question
- watchdog / daily_summary: their part of one "Run check"
Rows logged before the run_id column existed are grouped by agent: each is
its own run, except setup_agent calls less than 5 minutes apart, which are
treated as one conversation.

Prices come from backend/config.py (USD per 1M tokens).
Assumptions for the monthly numbers: 30 days, one owner runs "Run check"
once a day (watchdog + daily summary), the caretaker asks ~3 Ask Tended
questions a day. One-off setup conversations are listed separately.
"""

import csv
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # ✓ ✗ ⚠️ on Windows consoles
sys.path.insert(0, str(REPO))

from backend.config import MODEL_PRICES, PRICES_CONFIRMED, TOKEN_LOG_PATH  # noqa: E402

DAYS = 30
CHECKS_PER_DAY = 1
QUESTIONS_PER_DAY = 3
USER_COUNTS = (1, 100, 10_000)
SETUP_GAP = timedelta(minutes=5)
AGENT_ORDER = ["setup_agent", "caretaker_helper", "watchdog", "daily_summary"]
AGENT_NAME = {"setup_agent": "Setup agent", "caretaker_helper": "Ask Tended", "watchdog": "Watchdog",
              "daily_summary": "Daily summary"}


def row_cost(r: dict, use_cache: bool = True) -> float:
    """Cost of one logged call at its own model's price (0 if the model has no price)."""
    prices = MODEL_PRICES.get(r["model"])
    if prices is None:
        return 0.0
    p_in, p_cached, p_out = prices
    inp, cached, out = r["input_tokens"], r["cached_tokens"], r["output_tokens"]
    if use_cache:
        return ((inp - cached) * p_in + cached * p_cached + out * p_out) / 1e6
    return (inp * p_in + out * p_out) / 1e6


def load_runs(path: Path) -> tuple[dict[str, list[dict]], list[dict]]:
    with path.open(newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("agent")]
    for r in rows:
        r["t"] = datetime.fromisoformat(r["timestamp"]).astimezone(timezone.utc)
        r["provider"] = r.get("provider") or "openai"
        for k in ("input_tokens", "cached_tokens", "output_tokens", "duration_ms"):
            r[k] = int(r[k] or 0)
    groups: dict[tuple, list[dict]] = defaultdict(list)
    last_setup: dict | None = None
    n = 0
    for r in sorted(rows, key=lambda x: x["t"]):
        if r.get("run_id"):
            key = (r["agent"], "id", r["run_id"])
        elif r["agent"] == "setup_agent" and last_setup and r["t"] - last_setup["t"] <= SETUP_GAP:
            key = last_setup["key"]
        else:
            n += 1
            key = (r["agent"], "row", n)
        if r["agent"] == "setup_agent":
            last_setup = {"t": r["t"], "key": key}
        groups[key].append(r)
    runs: dict[str, list[dict]] = defaultdict(list)
    for (agent, *_), calls in groups.items():
        runs[agent].append({
            "calls": len(calls),
            "input": sum(c["input_tokens"] for c in calls),
            "cached": sum(c["cached_tokens"] for c in calls),
            "output": sum(c["output_tokens"] for c in calls),
            "cost": sum(row_cost(c) for c in calls),
            "cost_nocache": sum(row_cost(c, use_cache=False) for c in calls),
        })
    return runs, rows


def avg(runs: list[dict], key: str) -> float:
    return sum(r[key] for r in runs) / len(runs) if runs else 0.0


def money(x: float) -> str:
    if x == 0:
        return "$0"
    if x < 0.01:
        return f"${x:.5f}"
    if x < 100:
        return f"${x:,.2f}"
    return f"${x:,.0f}"


def main() -> int:
    runs, rows = load_runs(TOKEN_LOG_PATH)
    if not rows:
        print(f"No calls in {TOKEN_LOG_PATH} yet.")
        return 1
    agents = [a for a in AGENT_ORDER if a in runs] + sorted(a for a in runs if a not in AGENT_ORDER)

    per_agent = {}
    for a in agents:
        rs = runs[a]
        i, c, o = avg(rs, "input"), avg(rs, "cached"), avg(rs, "output")
        per_agent[a] = {"runs": len(rs), "calls": sum(r["calls"] for r in rs), "input": i, "cached": c, "output": o,
                        "cost": avg(rs, "cost"), "cost_nocache": avg(rs, "cost_nocache")}
    all_runs = [r for a in agents for r in runs[a]]
    ti, tc, to = avg(all_runs, "input"), avg(all_runs, "cached"), avg(all_runs, "output")
    unpriced = sorted({r["model"] for r in rows if r["model"] not in MODEL_PRICES})
    usage = defaultdict(int)
    for r in rows:
        usage[(r["provider"], r["model"])] += 1

    get = lambda a, k: per_agent.get(a, {}).get(k, 0.0)  # noqa: E731
    check_cost = get("watchdog", "cost") + get("daily_summary", "cost")
    check_nocache = get("watchdog", "cost_nocache") + get("daily_summary", "cost_nocache")
    q_cost, q_nocache = get("caretaker_helper", "cost"), get("caretaker_helper", "cost_nocache")
    user_month = DAYS * (CHECKS_PER_DAY * check_cost + QUESTIONS_PER_DAY * q_cost)
    user_month_nocache = DAYS * (CHECKS_PER_DAY * check_nocache + QUESTIONS_PER_DAY * q_nocache)

    actual = sum(row_cost(r) for r in rows)
    nocache = sum(row_cost(r, use_cache=False) for r in rows)
    cached_share = sum(r["cached_tokens"] for r in rows) / max(1, sum(r["input_tokens"] for r in rows))
    first, last = min(r["t"] for r in rows), max(r["t"] for r in rows)
    models = sorted({r["model"] for r in rows})

    md = [
        "# Tended cost report\n",
        f"- **Generated:** {datetime.now().astimezone():%Y-%m-%d %H:%M %Z} from `data/token_log.csv` "
        f"({len(rows)} AI calls, {first:%b %d %H:%M}–{last:%b %d %H:%M} UTC, model: {', '.join(models)})",
        "- **Calls by provider and model:** " + ", ".join(f"{p} / {m}: {n}" for (p, m), n in sorted(usage.items())),
        "- **Prices (USD per 1M tokens, input · cached · output):** "
        + "; ".join(f"{m}: ${a:.2f} · ${b:.2f} · ${c:.2f}" for m, (a, b, c) in MODEL_PRICES.items())
        + (f" ⚠️ No price set for {', '.join(unpriced)}: those calls are counted in the token averages but "
           "not in the dollar amounts (add them to `MODEL_PRICES` in `backend/config.py`)." if unpriced else "")
        + ("" if PRICES_CONFIRMED else " ⚠️ **not yet confirmed**: check them on OpenAI's pricing page and set "
           "`PRICES_CONFIRMED = True` in `backend/config.py`"),
        f"- **Assumptions:** {DAYS} days a month; the owner runs one check a day (watchdog + daily summary); "
        f"the caretaker asks {QUESTIONS_PER_DAY} Ask Tended questions a day.\n",
        "## Average tokens and cost per run\n",
        "| Agent | Runs | Calls | Avg input | Avg cached | Avg output | Cost per run | Without caching |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for a in agents:
        p = per_agent[a]
        md.append(f"| {AGENT_NAME.get(a, a)} | {p['runs']} | {p['calls']} | {p['input']:,.0f} | {p['cached']:,.0f} | "
                  f"{p['output']:,.0f} | {money(p['cost'])} | {money(p['cost_nocache'])} |")
    md.append(f"| **All runs** | {len(all_runs)} | {len(rows)} | {ti:,.0f} | {tc:,.0f} | {to:,.0f} | "
              f"{money(avg(all_runs, 'cost'))} | {money(avg(all_runs, 'cost_nocache'))} |")
    md += [
        f"\nOne **Run check** (watchdog + daily summary) costs about **{money(check_cost)}**; one **Ask Tended** "
        f"question about **{money(q_cost)}**.",
        "\n## Monthly cost\n",
        "| Users | Per month (with caching) | Per month (no caching) |",
        "|---:|---:|---:|",
    ]
    for n in USER_COUNTS:
        md.append(f"| {n:,} | {money(n * user_month)} | {money(n * user_month_nocache)} |")
    setup = per_agent.get("setup_agent")
    md += [
        f"\nPer user per month: {DAYS} checks × {money(check_cost)} + {DAYS * QUESTIONS_PER_DAY} questions × "
        f"{money(q_cost)} = **{money(user_month)}**.",
        (f"Setup is a one-off per trip, about **{money(setup['cost'])}** per setup conversation "
         f"({setup['calls'] / max(1, setup['runs']):.1f} calls on average); not included above.") if setup else "",
        "\n## What caching saved\n",
        "| | Cost |",
        "|---|---:|",
        f"| All {len(rows)} logged calls, as billed with caching | {money(actual)} |",
        f"| Same calls without caching | {money(nocache)} |",
        f"| **Saved** | **{money(nocache - actual)} ({(nocache - actual) / nocache:.0%})** |",
        f"| Per user per month, saved | {money(user_month_nocache - user_month)} "
        f"({(user_month_nocache - user_month) / user_month_nocache:.0%}) |",
        f"\n{cached_share:.0%} of all input tokens were served from the cache. Each agent's fixed system prompt "
        "is the same on every call, so after the first call most of the input is cached.",
        "\n## Notes\n",
        "- These are averages over the calls logged so far, mostly from development and testing; they will "
        "settle as real use builds up. The first call after a restart (or a prompt edit) has no cache, which "
        "makes these numbers slightly pessimistic.",
        "- Ask Tended emergencies (e.g. “she ate a lily leaf”) skip the model entirely, so they cost $0. "
        "They aren't in the log, so the per-question average is a little high.",
        "- Safety-test calls are logged to `logs/test_token_log.csv` and are not included here.",
    ]
    out = REPO / "logs" / "cost_report.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text("\n".join(x for x in md if x is not None), encoding="utf-8")
    print("\n".join(md))
    print(f"\nSaved to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
