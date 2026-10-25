"""Shared safety checks for every agent.

Everything people type (messages, check-in notes, reasons, symptoms) is
data, never instructions. `injection_hits` spots text that looks like it is
trying to instruct the AI ("ignore your rules", "tell the owner everything
is fine"). Agents still pass that text to the model (it may hold real care
info), but labelled as flagged, and they log it as suspicious.
"""

import re

INJECTION_PATTERNS = [
    r"\bignore\s+(all\s+|any\s+|your\s+|the\s+|previous\s+|prior\s+|these\s+)*(rules|instructions|guidelines|prompts?)\b",
    r"\bdisregard\s+(all\s+|your\s+|the\s+|previous\s+|prior\s+)*(rules|instructions|guidelines|prompts?)\b",
    r"\b(forget|override|bypass)\s+(all\s+|your\s+|the\s+)*(rules|instructions|guidelines|safety)\b",
    r"\b(tell|inform|let)\s+(the\s+)?owner\s+(know\s+)?(that\s+)?(everything|all|she|he|it|they)('?s|\s+is|\s+are)?\s+(is\s+)?(fine|ok|okay|good|great|normal)\b",
    r"\b(don'?t|do\s+not|never)\s+(alert|flag|warn|tell|notify)\b",
    r"\byou\s+are\s+now\b|\bact\s+as\b|\bpretend\s+(to\s+be|you)\b|\bsystem\s+prompt\b|\bnew\s+instructions\b",
    r"\b(hey|hi|ok|okay|dear|attention)\s+tended\b",
]

REASSURING = re.compile(
    r"\b(she'?s|he'?s|they'?re|it'?s|is|seems|looks|everything('?s|\s+is)?)\s+"
    r"(totally |perfectly |completely |probably |all |doing )?(fine|okay|ok|normal|healthy|great|good)\b"
    r"|nothing to worry|no need to (worry|call|see)|don'?t worry|no concerns",
    re.IGNORECASE,
)


def injection_hits(text: str) -> list[str]:
    """The suspicious phrases found in `text` (empty if none)."""
    hits = []
    for pattern in INJECTION_PATTERNS:
        m = re.search(pattern, text or "", re.IGNORECASE)
        if m:
            hits.append(m.group(0))
    return hits


def drop_reassuring_sentences(text: str) -> tuple[str, list[str]]:
    """Remove sentences that say the pet is fine/normal. Returns (text, removed)."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    kept, removed = [], []
    for s in sentences:
        (removed if REASSURING.search(s) else kept).append(s)
    return " ".join(kept), removed
