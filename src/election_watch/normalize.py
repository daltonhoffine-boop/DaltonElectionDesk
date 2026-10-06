"""Normalize documented Open America data and recognizable table-shaped results."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_open_america(payload: dict[str, Any], office: str, fetched_at: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if payload.get("api") != 1:
        raise ValueError(f"Unsupported Open America API version: {payload.get('api')!r}")

    results: list[dict[str, Any]] = []
    for race_key, race in payload.get("races", {}).items():
        state = race_key.split("-", 1)[0]
        for candidate in race.get("cands", []):
            results.append({
                "state": state,
                "office": office,
                "race": race_key,
                "candidate": candidate.get("n", ""),
                "party": candidate.get("p", ""),
                "votes": candidate.get("v"),
                "candidatePct": candidate.get("pct"),
                "precinctsReportingPct": race.get("pct_in"),
                "raceLeaderParty": race.get("leader", ""),
                "raceWinner": race.get("winner"),
                "winnerDeclared": bool(race.get("winner")),
                "feedFinal": bool(payload.get("final")),
                "feedTotalVotes": race.get("totalvotes"),
                "source": "Open America / official state election offices",
                "sourceUrl": "https://openamerica.io/elections/api/",
                "sourceAsOf": payload.get("as_of"),
                "capturedAt": fetched_at,
                "feedLive": bool(payload.get("live")),
                "feedStale": bool(payload.get("stale")),
                "method": "documented-json-api",
            })

    status = {
        "source": "Open America",
        "office": office,
        "year": payload.get("year"),
        "live": bool(payload.get("live")),
        "stale": bool(payload.get("stale")),
        "counting": bool(payload.get("counting")),
        "final": bool(payload.get("final")),
        "asOf": payload.get("as_of"),
        "raceCount": payload.get("counts", {}).get("races", 0),
        "resultCount": len(results),
        "capturedAt": fetched_at,
        "coverageLimited": True,
    }
    return results, status


HEADER_ALIASES = {
    "candidate": {"candidate", "candidate name", "name", "contestant"},
    "votes": {"votes", "vote total", "total votes", "votes received", "vote count"},
    "race": {"race", "contest", "office", "contest name", "race name"},
    "party": {"party", "party affiliation"},
    "reporting": {"percent reporting", "pct reporting", "precincts reporting percent", "percent precincts reporting"},
    "precinct": {"precinct", "precinct name", "voting precinct"},
    "precinct_id": {"precinct id", "precinct number", "precinct code"},
    "precinct_fips": {"precinct fips", "precinct fips code"},
    "precincts_reported": {"precincts reporting", "precincts reported", "precincts in"},
    "precincts_total": {"precincts total", "total precincts"},
    "votes_outstanding": {"votes outstanding", "votes remaining", "estimated votes remaining"},
    "ballots_outstanding": {"ballots outstanding", "ballots remaining", "estimated ballots remaining"},
    "candidate_pct": {"percent", "pct", "vote percent", "percentage"},
    "county": {"county", "county name", "countyname", "parish", "borough", "municipality", "jurisdiction"},
    "county_fips": {"county fips", "county fips code", "countyfips", "county_fips", "fips county code", "county code", "county id"},
    "district": {"district", "district number", "congressional district", "house district", "district code"},
}

STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56",
}


def _header_key(text: str) -> str:
    return " ".join(text.strip().lower().replace("_", " ").replace("%", "percent").split())


def _county_fips_or_none(value: str, state: str) -> str | None:
    digits = "".join(character for character in value if character.isdigit())
    if len(digits) == 5:
        return digits
    state_fips = STATE_FIPS.get(state)
    if state_fips and 1 <= len(digits) <= 3:
        return state_fips + digits.zfill(3)
    return None


def _integer_or_none(text: str) -> int | None:
    cleaned = text.strip().replace(",", "").replace("%", "")
    if not cleaned or cleaned in {"-", "—", "n/a"}:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def _number_or_none(text: str) -> float | None:
    cleaned = text.strip().replace(",", "").replace("%", "")
    if not cleaned or cleaned in {"-", "—", "n/a"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_html_result_tables(html: bytes | str, *, state: str, source_name: str, source_url: str, captured_at: str) -> list[dict[str, Any]]:
    """Read only HTML tables with explicit candidate and vote-total headings."""
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict[str, Any]] = []
    for table in soup.find_all("table"):
        header_row = table.find("tr")
        while header_row and not header_row.find_all(["th", "td"]):
            header_row = header_row.find_next("tr")
        if not header_row:
            continue
        headers = [_header_key(cell.get_text(" ", strip=True)) for cell in header_row.find_all(["th", "td"])]
        columns = {
            key: next((index for index, header in enumerate(headers) if header in aliases), None)
            for key, aliases in HEADER_ALIASES.items()
        }
        if columns["candidate"] is None or columns["votes"] is None:
            continue

        current_race = ""
        for row in table.find_all("tr"):
            if row is header_row:
                continue
            cells = row.find_all(["th", "td"])
            values = [cell.get_text(" ", strip=True) for cell in cells]
            if len(values) != len(headers):
                continue
            race_value = values[columns["race"]] if columns["race"] is not None else ""
            if race_value:
                current_race = race_value
            candidate = values[columns["candidate"]]
            votes = _integer_or_none(values[columns["votes"]])
            if not candidate or votes is None or _header_key(candidate) in HEADER_ALIASES["candidate"]:
                continue
            party = values[columns["party"]] if columns["party"] is not None else ""
            county = values[columns["county"]] if columns["county"] is not None else ""
            county_fips = values[columns["county_fips"]] if columns["county_fips"] is not None else ""
            district = values[columns["district"]] if columns["district"] is not None else ""
            precinct = values[columns["precinct"]] if columns["precinct"] is not None else ""
            precinct_id = values[columns["precinct_id"]] if columns["precinct_id"] is not None else ""
            precinct_fips = values[columns["precinct_fips"]] if columns["precinct_fips"] is not None else ""
            reporting = _number_or_none(values[columns["reporting"]]) if columns["reporting"] is not None else None
            candidate_pct = _number_or_none(values[columns["candidate_pct"]]) if columns["candidate_pct"] is not None else None
            result = {
                "state": state,
                "office": current_race,
                "race": current_race or "Unspecified race",
                "candidate": candidate,
                "party": party,
                "votes": votes,
                "candidatePct": candidate_pct,
                "precinctsReportingPct": reporting,
                "raceLeaderParty": "",
                "winnerDeclared": False,
                "source": source_name,
                "sourceUrl": source_url,
                "sourceAsOf": None,
                "capturedAt": captured_at,
                "feedLive": None,
                "feedStale": None,
                "method": "html-table-header-match",
                "verificationRequired": True,
            }
            if county:
                result["county"] = county
            if district:
                result["district"] = district
            if precinct:
                result["precinct"] = precinct
            if precinct_id:
                result["precinctId"] = precinct_id
            if precinct_fips:
                result["precinctFips"] = precinct_fips
            for key, normalized_field in (
                ("precincts_reported", "precinctsReported"),
                ("precincts_total", "precinctsTotal"),
                ("votes_outstanding", "votesOutstanding"),
                ("ballots_outstanding", "ballotsOutstanding"),
            ):
                index = columns[key]
                value = _integer_or_none(values[index]) if index is not None else None
                if value is not None and value >= 0:
                    result[normalized_field] = value
            if county_fips:
                normalized_fips = _county_fips_or_none(county_fips, state)
                if normalized_fips:
                    result["countyFips"] = normalized_fips
            results.append(result)
    return results


def partition_precinct_results(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Separate precinct-level rows so they are not counted as aggregate dashboard totals."""
    aggregate_rows = []
    precinct_rows = []
    for row in rows:
        if row.get("precinct") or row.get("precinctId") or row.get("precinctFips"):
            observation = dict(row)
            observation["reportingUnitType"] = "precinct"
            precinct_rows.append(observation)
        else:
            aggregate_rows.append(row)
    return aggregate_rows, precinct_rows
