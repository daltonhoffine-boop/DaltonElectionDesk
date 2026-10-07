"""Fetch a compact national polling feed for the static dashboard build."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
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
    api_url = config.get("media", {}).get("votehub_api_url", VOTEHUB_API_URL)
    url = f"{api_url}?{urlencode({'poll_type': 'generic-ballot', 'subject': str(election_year)})}"
    captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    try:
        request = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(request, timeout=30) as response:
            payload = json.load(response)
        polls = normalize_votehub_polls(payload, "generic-ballot", [], election_year)
        return {
            "schemaVersion": 1,
            "capturedAt": captured_at,
            "provider": "VoteHub Polls API",
            "sourceUrl": VOTEHUB_DOCS_URL,
            "status": "reachable",
            "polls": latest_votehub_polls(polls),
        }
    except (URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as error:
        LOGGER.error("VoteHub national polling refresh failed: %s", error)
        return {
            "schemaVersion": 1,
            "capturedAt": captured_at,
            "provider": "VoteHub Polls API",
            "sourceUrl": VOTEHUB_DOCS_URL,
            "status": "error",
            "error": str(error),
            "polls": [],
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
