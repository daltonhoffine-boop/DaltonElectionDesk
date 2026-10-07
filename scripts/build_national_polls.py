"""Fetch compact national and state polling feeds for the static dashboard build."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from election_watch.media import (  # noqa: E402
    VOTEHUB_API_URL,
    VOTEHUB_DOCS_URL,
    latest_votehub_polls,
    normalize_votehub_polls,
)

LOGGER = logging.getLogger("build_national_polls")
USER_AGENT = "DaltonElectionMagicWall/0.1 (national poll display)"


def build_snapshot(config_path: Path) -> dict:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    election_year = int(config["election"]["year"])
    settings = config.get("media", {})
    api_url = settings.get("votehub_api_url", VOTEHUB_API_URL)
    states = [
        {"state": state["state"], "name": state["name"]}
        for state in config.get("state_pages", [])
    ]
    captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def fetch_poll_type(
        poll_type: str,
        known_states: list[dict[str, str]],
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        url = f"{api_url}?{urlencode({'poll_type': poll_type, 'subject': str(election_year)})}"
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=30) as response:
                payload = json.load(response)
            polls = normalize_votehub_polls(payload, poll_type, known_states, election_year)
            return polls, {"status": "reachable", "fetchedAt": captured_at, "rowCount": len(polls)}
        except (URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as error:
            LOGGER.error("VoteHub %s polling refresh failed: %s", poll_type, error)
            return [], {"status": "error", "fetchedAt": captured_at, "rowCount": 0, "error": str(error)}

    national_polls, national_status = fetch_poll_type("generic-ballot", [])
    state_polls: list[dict[str, Any]] = []
    state_sources: list[dict[str, Any]] = []
    for poll_type in ("senate", "governor", "house"):
        polls, status = fetch_poll_type(poll_type, states)
        state_polls.extend(polls)
        status.update({
            "office": poll_type.title(),
            "source": "VoteHub Polls API",
            "sourceUrl": VOTEHUB_DOCS_URL,
        })
        state_sources.append(status)

    state_errors = [source for source in state_sources if source["status"] == "error"]
    state_status = "error" if len(state_errors) == len(state_sources) else "partial" if state_errors else "reachable"
    return {
        "schemaVersion": 1,
        "capturedAt": captured_at,
        "provider": "VoteHub Polls API",
        "sourceUrl": VOTEHUB_DOCS_URL,
        "status": national_status["status"],
        "error": national_status.get("error"),
        "polls": latest_votehub_polls(national_polls),
        "stateStatus": state_status,
        "stateSources": state_sources,
        "statePolls": state_polls,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=PROJECT_ROOT / "config" / "sources.json",
        help="collector source configuration",
    )
    parser.add_argument("--output", type=Path, required=True, help="output national poll JSON path")
    args = parser.parse_args()

    snapshot = build_snapshot(args.config)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Wrote %d national polls to %s", len(snapshot["polls"]), args.output)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(main())
