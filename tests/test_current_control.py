import json
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONTROL_PATH = PROJECT_ROOT / "dashboard" / "current-control.json"
VALID_PARTIES = {"D", "R", "O"}


class CurrentControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.control = json.loads(CONTROL_PATH.read_text(encoding="utf-8"))

    def test_roster_covers_all_voting_house_districts_including_vacancies(self):
        house = self.control["house"]
        self.assertEqual(len(house), 435)
        for district, officeholder in house.items():
            self.assertRegex(district, r"^[A-Z]{2}-(?:AL|\d{2})$")
            if officeholder.get("vacant"):
                self.assertIsNone(officeholder["party"])
            else:
                self.assertIn(officeholder["party"], VALID_PARTIES)
                self.assertTrue(officeholder["name"])

    def test_senate_roster_has_two_classed_senators_per_state(self):
        senate = self.control["senate"]
        self.assertEqual(len(senate), 50)
        self.assertEqual(sum(len(senators) for senators in senate.values()), 100)
        for senators in senate.values():
            self.assertEqual(len(senators), 2)
            self.assertEqual(len({senator["class"] for senator in senators}), 2)
            self.assertTrue(all(senator["class"] in {1, 2, 3} for senator in senators))
            self.assertTrue(all(senator["party"] in VALID_PARTIES and senator["name"] for senator in senators))

    def test_governor_roster_covers_all_states(self):
        governors = self.control["governor"]
        self.assertEqual(len(governors), 50)
        self.assertTrue(all(governor["party"] in VALID_PARTIES and governor["name"] for governor in governors.values()))

    def test_static_roster_is_dated_and_sources_are_linked(self):
        metadata = self.control["metadata"]
        self.assertEqual(metadata["asOf"], "2026-10-04")
        self.assertTrue(metadata["houseSource"].startswith("https://"))
        self.assertTrue(metadata["governorSource"].startswith("https://"))


if __name__ == "__main__":
    unittest.main()
