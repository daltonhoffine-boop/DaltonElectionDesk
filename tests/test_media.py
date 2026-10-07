import io
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from election_watch.media import (
    google_news_rss_url,
    latest_votehub_polls,
    normalize_votehub_polls,
    parse_google_news_rss,
)
from election_watch.runner import Watcher
from scripts.build_national_polls import build_snapshot


STATES = [
    {"state": "CA", "name": "California"},
    {"state": "OH", "name": "Ohio"},
]


class MediaTests(unittest.TestCase):
    def test_votehub_polls_are_normalized_and_limited_to_the_requested_cycle(self):
        records = [
            {
                "id": "gov-1",
                "poll_type": "governor",
                "subject": "2026 Ohio",
                "pollster": "Example Polling",
                "start_date": "2026-05-01",
                "end_date": "2026-05-03",
                "sample_size": 800,
                "url": "https://example.com/poll",
                "answers": [{"choice": "Candidate A", "pct": 51.5}, {"choice": "Candidate B", "pct": 47}],
            },
            {"id": "old", "poll_type": "governor", "subject": "2024 Ohio", "answers": []},
        ]

        polls = normalize_votehub_polls(records, "governor", STATES, 2026)

        self.assertEqual(len(polls), 1)
        self.assertEqual(polls[0]["state"], "OH")
        self.assertEqual(polls[0]["answers"][0], {"choice": "Candidate A", "pct": 51.5})
        self.assertEqual(polls[0]["sourceUrl"], "https://example.com/poll")

    def test_house_poll_district_is_matched_from_seat_name(self):
        records = [{
            "poll_type": "house",
            "subject": "2026 California",
            "seat_name": "CA-22",
            "answers": [],
        }]

        polls = normalize_votehub_polls(records, "house", STATES, 2026)

        self.assertEqual(polls[0]["district"], "CA-22")

    def test_national_generic_ballot_polls_do_not_require_a_state(self):
        records = [
            {
                "id": "generic-2026",
                "poll_type": "generic-ballot",
                "subject": "2026",
                "pollster": "Example Polling",
                "start_date": "2026-09-28",
                "end_date": "2026-09-30",
                "answers": [{"choice": "Dem", "pct": 51}, {"choice": "Rep", "pct": 46}],
            },
            {"id": "generic-old", "poll_type": "generic-ballot", "subject": "2024", "answers": []},
        ]

        polls = normalize_votehub_polls(records, "generic-ballot", STATES, 2026)

        self.assertEqual(len(polls), 1)
        self.assertEqual(polls[0]["pollType"], "generic-ballot")
        self.assertIsNone(polls[0]["state"])
        self.assertEqual(polls[0]["answers"][0], {"choice": "Dem", "pct": 51.0})

    def test_latest_votehub_polls_are_sorted_and_limited(self):
        polls = [{"endDate": f"2026-09-{day:02d}", "id": str(day)} for day in range(1, 11)]

        latest = latest_votehub_polls(polls)

        self.assertEqual(len(latest), 8)
        self.assertEqual(latest[0]["id"], "10")
        self.assertEqual(latest[-1]["id"], "3")

    def test_poll_closing_schedule_covers_states_and_district_overrides(self):
        project_root = Path(__file__).resolve().parents[1]
        config = json.loads((project_root / "config" / "sources.json").read_text(encoding="utf-8"))
        closing_times = config["media"]["poll_closing_times"]

        self.assertEqual(len(closing_times["latestCloseEt"]), 51)
        self.assertEqual(closing_times["latestCloseEt"]["AK"], "25:00")
        self.assertEqual(closing_times["districtOverrides"]["TX"]["specific"]["16"], "21:00")
        self.assertEqual(closing_times["districtOverrides"]["FL"]["default"], "19:00")

    def test_news_url_is_state_and_cycle_specific(self):
        query = parse_qs(urlparse(google_news_rss_url("Maine", 2026)).query)

        self.assertEqual(query["q"], ["2026 election Maine Senate Governor House"])
        self.assertEqual(query["ceid"], ["US:en"])

    def test_google_news_rss_keeps_linked_headlines_and_publisher(self):
        xml = b"""<?xml version="1.0"?>
        <rss version="2.0"><channel>
          <item><title>Ohio election update</title><link>https://news.google.com/story/1</link>
            <pubDate>Tue, 03 Nov 2026 12:00:00 GMT</pubDate><source>Example News</source></item>
          <item><title>Ohio election update</title><link>https://news.google.com/story/1</link>
            <source>Duplicate</source></item>
        </channel></rss>"""

        items = parse_google_news_rss(xml)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "Ohio election update")
        self.assertEqual(items[0]["publisher"], "Example News")

    def test_media_snapshot_records_provider_coverage_and_news(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "sources.json"
            config_path.write_text(json.dumps({
                "election": {"year": 2026},
                "state_pages": [{"state": "OH", "name": "Ohio"}],
                "media": {"enabled": True, "refresh_seconds": 1800, "news_refresh_seconds": 3600},
            }), encoding="utf-8")
            watcher = Watcher(config_path, root / "data")
            self.addCleanup(watcher.session.close)
            governor_poll = {
                "id": "gov-1",
                "poll_type": "governor",
                "subject": "2026 Ohio",
                "pollster": "Example Polling",
                "start_date": "2026-05-01",
                "end_date": "2026-05-03",
                "answers": [{"choice": "Candidate A", "pct": 51}],
                "url": "https://example.com/poll",
            }
            generic_poll = {
                "id": "generic-1",
                "poll_type": "generic-ballot",
                "subject": "2026",
                "pollster": "National Polling",
                "start_date": "2026-05-10",
                "end_date": "2026-05-12",
                "answers": [{"choice": "Dem", "pct": 50}, {"choice": "Rep", "pct": 45}],
                "url": "https://example.com/generic",
            }
            rss = b"""<rss><channel><item><title>Ohio race story</title>
              <link>https://news.google.com/story/1</link><source>Example News</source></item></channel></rss>"""

            def fake_get(url):
                if url.startswith("https://api.votehub.com/"):
                    poll_type = parse_qs(urlparse(url).query)["poll_type"][0]
                    records = {"governor": [governor_poll], "generic-ballot": [generic_poll]}.get(poll_type, [])
                    return json.dumps(records).encode(), {}, 200
                return rss, {}, 200

            watcher._get = fake_get
            media = watcher._media("2026-06-01T12:00:00Z")

        self.assertEqual(media["polling"]["status"], "reachable")
        self.assertEqual(media["polling"]["polls"][0]["state"], "OH")
        self.assertEqual(media["polling"]["sources"][0]["rowCount"], 0)
        national_poll = next(poll for poll in media["polling"]["polls"] if poll["pollType"] == "generic-ballot")
        self.assertIsNone(national_poll["state"])
        self.assertEqual(national_poll["answers"][0]["choice"], "Dem")
        national_status = next(source for source in media["polling"]["sources"] if source["office"] == "Generic ballot")
        self.assertEqual(national_status["rowCount"], 1)
        self.assertEqual(media["news"]["feeds"]["OH"]["items"][0]["publisher"], "Example News")
        self.assertIn("Ohio", media["news"]["feeds"]["OH"]["feedUrl"])

    def test_static_poll_feed_includes_state_races_and_national_generic_ballot(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "sources.json"
            config_path.write_text(json.dumps({
                "election": {"year": 2026},
                "state_pages": [{"state": "OH", "name": "Ohio"}],
                "media": {"votehub_api_url": "https://api.votehub.com/polls"},
            }), encoding="utf-8")
            records = {
                "generic-ballot": [{
                    "poll_type": "generic-ballot",
                    "subject": "2026",
                    "pollster": "National Polling",
                    "end_date": "2026-09-20",
                    "answers": [{"choice": "Dem", "pct": 50}],
                }],
                "governor": [{
                    "poll_type": "governor",
                    "subject": "2026 Ohio",
                    "pollster": "Ohio Polling",
                    "end_date": "2026-09-21",
                    "answers": [{"choice": "Candidate A", "pct": 51}],
                }],
                "senate": [],
                "house": [],
            }

            def fake_urlopen(request, timeout):
                poll_type = parse_qs(urlparse(request.full_url).query)["poll_type"][0]
                return io.BytesIO(json.dumps(records[poll_type]).encode())

            with patch("scripts.build_national_polls.urlopen", side_effect=fake_urlopen):
                feed = build_snapshot(config_path)

        self.assertEqual(feed["status"], "reachable")
        self.assertEqual(feed["polls"][0]["pollType"], "generic-ballot")
        self.assertEqual(feed["stateStatus"], "reachable")
        self.assertEqual(feed["statePolls"][0]["state"], "OH")
        self.assertEqual(feed["stateSources"][1]["office"], "Governor")
        self.assertEqual(feed["stateSources"][1]["rowCount"], 1)


if __name__ == "__main__":
    unittest.main()
