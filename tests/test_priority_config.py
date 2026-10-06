import json
import unittest
from pathlib import Path

from election_watch.runner import Watcher


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class PriorityConfigTests(unittest.TestCase):
    def setUp(self):
        self.watcher = Watcher(PROJECT_ROOT / "config" / "sources.json", PROJECT_ROOT / "data")
        self.addCleanup(self.watcher.session.close)

    def test_house_priority_list_contains_all_toss_up_and_lean_races(self):
        config = json.loads((PROJECT_ROOT / "config" / "sources.json").read_text(encoding="utf-8"))
        priorities = config["race_priorities"]
        house_races = priorities["house_races"]
        districts = [district for races in house_races.values() for district in races]
        self.assertEqual(len(districts), 43)
        self.assertEqual(len(set(districts)), 43)
        self.assertEqual(len(house_races["Toss Up"]), 22)
        self.assertEqual(len(house_races["Lean Democrat"]), 11)
        self.assertEqual(len(house_races["Lean Republican"]), 10)
        self.assertEqual(len(priorities["statewide_offices"]["Senate"]), 33)
        self.assertEqual(len(priorities["statewide_offices"]["Governor"]), 36)

    def test_state_priority_reasons_include_statewide_and_house_races(self):
        self.assertEqual(self.watcher._priority_reasons("OH"), ["Governor", "House (Toss Up)", "House (Lean Democrat)"])
        self.assertEqual(self.watcher._priority_reasons("UT"), [])

    def test_collector_has_official_source_pages_for_every_state_and_dc(self):
        config = json.loads((PROJECT_ROOT / "config" / "sources.json").read_text(encoding="utf-8"))
        pages = config["state_pages"]
        states = [page["state"] for page in pages]
        expected = {
            "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
            "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
            "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
            "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
            "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
        }
        self.assertEqual(set(states), expected)
        self.assertEqual(len(states), len(set(states)))
        self.assertTrue(all(page["results_page"].startswith("https://") for page in pages))


if __name__ == "__main__":
    unittest.main()
