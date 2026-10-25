"""data/pet_reference.csv: short, sourced reference facts per species.

Columns: id, species, category (normal_range | care_basics | toxic_food |
toxic_plant | toxic_other | red_flag), topic, info, action (emergency |
call_vet_soon | avoid | info), keywords (;-separated, for emergency matching),
source (Merck Veterinary Manual or ASPCA Animal Poison Control).

Loaded once at startup; restart the backend after editing the file.
"""

import csv
import re

from backend.config import DATA_DIR

REFERENCE_PATH = DATA_DIR / "pet_reference.csv"

with REFERENCE_PATH.open(newline="", encoding="utf-8") as _f:
    ROWS: list[dict] = list(csv.DictReader(_f))
BY_ID = {r["id"]: r for r in ROWS}

# Pet species text -> reference species. First match wins.
SPECIES_WORDS = [
    ("guinea pig", ("guinea", "cavy")),
    ("rabbit", ("rabbit", "bunny")),
    ("cat", ("cat", "kitten", "feline")),
    ("dog", ("dog", "puppy", "canine")),
    ("bird", ("bird", "parrot", "budgie", "budgerigar", "parakeet", "cockatiel", "cockatoo",
              "macaw", "lovebird", "canary", "finch", "conure", "african grey")),
    ("reptile", ("reptile", "lizard", "gecko", "bearded dragon", "iguana", "snake", "python",
                 "boa", "turtle", "tortoise", "chameleon", "skink", "monitor")),
]


def reference_species(species: str) -> str | None:
    s = species.lower()
    for ref, words in SPECIES_WORDS:
        if any(re.search(rf"\b{re.escape(w)}", s) for w in words):
            return ref
    return None


def rows_for(species: str) -> list[dict]:
    ref = reference_species(species)
    return [r for r in ROWS if r["species"] == ref] if ref else []


def as_prompt_table() -> str:
    """The whole file as compact lines for the (fixed) system prompt."""
    lines = []
    for r in ROWS:
        lines.append(f"[{r['id']}] {r['species']} | {r['category']} | {r['topic']} | {r['info']} "
                     f"| action: {r['action']} | source: {r['source']}")
    return "\n".join(lines)


# Words that mean the pet has already eaten/touched something (as opposed to
# "can she eat ...?", which is a normal question).
INGESTED = re.compile(
    r"\b(ate|eaten|chewed|chewing|swallowed|licked|licking|nibbled|nibbling|munched|"
    r"drank|ingested|got into|bit into|eating|has had|had some|had a)\b",
    re.IGNORECASE,
)


def toxin_matches(species: str, text: str) -> list[dict]:
    """Emergency-level toxin rows for this species whose keywords appear in
    `text` together with a word saying the pet already ate/licked it."""
    if not INGESTED.search(text):
        return []
    hits = []
    for r in rows_for(species):
        if r["action"] != "emergency" or not r["keywords"]:
            continue
        for kw in r["keywords"].split(";"):
            if kw and re.search(rf"\b{re.escape(kw)}", text, re.IGNORECASE):
                hits.append(r)
                break
    return hits
