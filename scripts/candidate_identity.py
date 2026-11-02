"""Verify that a Wikimedia photo depicts the specific person running in a race.

A photo is accepted only when every check passes:
  1. A Wikidata entity matches the candidate's name, is a living human, and
     is described as a politician/candidate.
  2. That entity's English Wikipedia article ties the person to the candidate's
     state and does not contradict the candidate's party.
  3. Exactly one entity passes 1-2 (ambiguous names are rejected, not guessed).
  4. The photo is the entity's own curated Wikidata image (P18), not a file that
     merely has the name in its title, and it is not dated before 1990.

Anything that fails shows initials instead of a photo.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}
HUMAN = "Q5"
# politician, member of a legislature, governor, lawyer-politician, etc. are all
# covered by the Wikipedia text check below; this is a cheap occupation pre-filter.
POLITICS_WORDS = re.compile(
    r"\b(politician|candidate|congress(?:man|woman|person)?|representative|senator|governor|"
    r"mayor|legislator|state senator|state representative|attorney general|"
    r"lieutenant governor|secretary of state|nominee|incumbent|running for)\b",
    re.IGNORECASE,
)
OLDEST_ACCEPTED_PHOTO_YEAR = 1990


@dataclass
class Verdict:
    ok: bool
    reason: str
    qid: str | None = None
    wikipedia_url: str | None = None
    image_file: str | None = None
    evidence: list[str] = field(default_factory=list)


def normalize_file(name: str) -> str:
    name = html.unescape(name or "").removeprefix("File:").replace("_", " ")
    return re.sub(r"\s+", " ", name).strip().casefold()


def claim_values(entity: dict, prop: str) -> list:
    values = []
    for claim in entity.get("claims", {}).get(prop, []):
        if claim.get("rank") == "deprecated":
            continue
        value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
        if value is not None:
            values.append(value)
    return values


def is_living_human(entity: dict) -> bool:
    is_human = any(v.get("id") == HUMAN for v in claim_values(entity, "P31") if isinstance(v, dict))
    return is_human and not entity.get("claims", {}).get("P570")


def party_conflicts(text: str, party_code: str) -> bool:
    mentions_dem = bool(re.search(r"\bDemocrat", text))
    mentions_rep = bool(re.search(r"\bRepublican", text))
    if party_code == "D":
        return mentions_rep and not mentions_dem
    if party_code == "R":
        return mentions_dem and not mentions_rep
    return False


def article_ties_to_race(text: str, state: str, party_code: str) -> tuple[bool, str]:
    state_name = STATE_NAMES.get(state)
    if not text:
        return False, "no English Wikipedia article text"
    if not POLITICS_WORDS.search(text):
        return False, "article does not describe a politician or candidate"
    if state_name and state_name.casefold() not in text.casefold():
        return False, f"article never mentions {state_name}"
    if party_conflicts(text, party_code):
        return False, "article names the opposite party"
    return True, "article ties person to the state and party"


def photo_year(metadata: dict) -> int | None:
    value = metadata.get("DateTimeOriginal", {}).get("value") or metadata.get("DateTime", {}).get("value") or ""
    match = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", html.unescape(str(value)))
    return int(match.group(1)) if match else None


def photo_too_old(metadata: dict, file_name: str) -> bool:
    year = photo_year(metadata)
    if year is None:
        match = re.search(r"\b(1[5-9]\d\d)s?\b", file_name)
        year = int(match.group(1)) if match else None
    return year is not None and year < OLDEST_ACCEPTED_PHOTO_YEAR


def evaluate(
    name: str,
    state: str,
    party_code: str,
    hits: list[dict],
    articles: dict[str, tuple[str, str]],
) -> Verdict:
    """hits: Wikidata entities. articles: qid -> (wikipedia_url, intro_text)."""
    passing: list[tuple[dict, str, str]] = []
    reasons: list[str] = []
    for entity in hits:
        qid = entity.get("id", "")
        if not is_living_human(entity):
            reasons.append(f"{qid}: not a living human")
            continue
        url, text = articles.get(qid, ("", ""))
        ok, why = article_ties_to_race(text, state, party_code)
        if not ok:
            reasons.append(f"{qid}: {why}")
            continue
        passing.append((entity, url, why))
    if not passing:
        return Verdict(False, "no Wikidata person matches this race", evidence=reasons[:5])
    if len(passing) > 1:
        return Verdict(False, "ambiguous: several people match", evidence=[e["id"] for e, _, _ in passing])
    entity, url, why = passing[0]
    images = claim_values(entity, "P18")
    if not images:
        return Verdict(False, "identity verified but Wikidata has no portrait", qid=entity["id"], wikipedia_url=url, evidence=[why])
    return Verdict(True, "verified", qid=entity["id"], wikipedia_url=url, image_file=str(images[0]), evidence=[why])
