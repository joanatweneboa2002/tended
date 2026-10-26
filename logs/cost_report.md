# Tended cost report

- **Generated:** 2026-10-25 17:13 EDT from `data/token_log.csv` (29 AI calls, Oct 25 14:43–Oct 25 17:37 UTC, model: gpt-5.6-luna)
- **Calls by provider and model:** openai / gpt-5.6-luna: 29
- **Prices (USD per 1M tokens, input · cached · output):** gpt-5.6-luna: $0.20 · $0.02 · $1.20
- **Assumptions:** 30 days a month; the owner runs one check a day (watchdog + daily summary); the caretaker asks 3 Ask Tended questions a day.

## Average tokens and cost per run

| Agent | Runs | Calls | Avg input | Avg cached | Avg output | Cost per run | Without caching |
|---|---:|---:|---:|---:|---:|---:|---:|
| Setup agent | 1 | 2 | 6,400 | 2,582 | 1,619 | $0.00276 | $0.00322 |
| Ask Tended | 17 | 17 | 6,001 | 4,575 | 124 | $0.00053 | $0.00135 |
| Watchdog | 6 | 6 | 8,008 | 4,987 | 1,245 | $0.00220 | $0.00310 |
| Daily summary | 4 | 4 | 1,847 | 646 | 490 | $0.00084 | $0.00096 |
| **All runs** | 28 | 29 | 5,852 | 4,031 | 470 | $0.00101 | $0.00173 |

One **Run check** (watchdog + daily summary) costs about **$0.00304**; one **Ask Tended** question about **$0.00053**.

## Monthly cost

| Users | Per month (with caching) | Per month (no caching) |
|---:|---:|---:|
| 1 | $0.14 | $0.24 |
| 100 | $13.85 | $24.30 |
| 10,000 | $1,385 | $2,430 |

Per user per month: 30 checks × $0.00304 + 90 questions × $0.00053 = **$0.14**.
Setup is a one-off per trip, about **$0.00276** per setup conversation (2.0 calls on average); not included above.

## What caching saved

| | Cost |
|---|---:|
| All 29 logged calls, as billed with caching | $0.03 |
| Same calls without caching | $0.05 |
| **Saved** | **$0.02 (42%)** |
| Per user per month, saved | $0.10 (43%) |

69% of all input tokens were served from the cache. Each agent's fixed system prompt is the same on every call, so after the first call most of the input is cached.

## Notes

- These are averages over the calls logged so far, mostly from development and testing; they will settle as real use builds up. The first call after a restart (or a prompt edit) has no cache, which makes these numbers slightly pessimistic.
- Ask Tended emergencies (e.g. “she ate a lily leaf”) skip the model entirely, so they cost $0. They aren't in the log, so the per-question average is a little high.
- Safety-test calls are logged to `logs/test_token_log.csv` and are not included here.
- The API key for this project was provided by my professor for the course, so I don't pay for these calls myself; the dollar figures show what Tended would cost to run, not my own spending.