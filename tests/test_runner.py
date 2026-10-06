import json
import tempfile
import unittest
from pathlib import Path

from election_watch.runner import Watcher


class RunnerTests(unittest.TestCase):
    def test_precinct_rows_are_saved_separately_and_in_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "sources.json"
            config_path.write_text(json.dumps({
                "election": {"year": 2026},
                "open_america": {"enabled": False},
                "state_pages": [{
                    "state": "ME",
                    "name": "Maine",
                    "results_page": "https://example.gov/2026-results",
                }],
            }), encoding="utf-8")
            output_dir = root / "data"
            watcher = Watcher(config_path, output_dir)
            self.addCleanup(watcher.session.close)
            html = b"""
            <table><tr><th>Contest</th><th>County</th><th>Precinct</th><th>Candidate</th><th>Votes</th></tr>
            <tr><td>U.S. Senate</td><td>Penobscot</td><td>Portland 1</td><td>Ada Example</td><td>1234</td></tr></table>
            """
            watcher._get = lambda url: (html, {"Content-Type": "text/html"}, 200)

            snapshot = watcher.run_once()
            persisted = json.loads((output_dir / "history.jsonl").read_text(encoding="utf-8"))

        self.assertEqual(snapshot["schemaVersion"], 2)
        self.assertEqual(snapshot["results"], [])
        self.assertEqual(len(snapshot["precinctResults"]), 1)
        self.assertEqual(snapshot["precinctResults"][0]["precinct"], "Portland 1")
        self.assertEqual(snapshot["precinctResults"][0]["reportingUnitType"], "precinct")
        self.assertEqual(snapshot["sources"][0]["precinctResultCount"], 1)
        self.assertEqual(persisted["precinctResults"], snapshot["precinctResults"])


if __name__ == "__main__":
    unittest.main()
