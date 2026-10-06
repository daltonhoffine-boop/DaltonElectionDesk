import json
import re
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = PROJECT_ROOT / "dashboard"


class RaceDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidates = json.loads((DASHBOARD / "candidates-2026.json").read_text(encoding="utf-8"))
        cls.history = json.loads((DASHBOARD / "historical-results.json").read_text(encoding="utf-8"))

    def test_candidate_roster_covers_named_2026_general_races(self):
        self.assertEqual(len(self.candidates["house"]), 435)
        self.assertEqual(len(self.candidates["senate"]), 35)
        self.assertEqual(len(self.candidates["governor"]), 36)
        self.assertNotIn("DC", self.candidates["governor"])
        self.assertEqual(self.candidates["asOf"], "2026-10-04")
        self.assertTrue(self.candidates["metadata"]["sourceLicense"].endswith("by-sa/4.0/"))

        for district, candidates in self.candidates["house"].items():
            self.assertRegex(district, re.compile(r"^[A-Z]{2}-(?:AL|\d{2})$"))
            self.assert_candidate_rows(candidates)
        for race in self.candidates["senate"].values():
            self.assertIn(race["class"], {1, 2, 3})
            self.assert_candidate_rows(race["candidates"])
        for candidates in self.candidates["governor"].values():
            self.assert_candidate_rows(candidates)

    def test_candidate_names_have_no_table_decoration(self):
        all_races = list(self.candidates["house"].values())
        all_races.extend(race["candidates"] for race in self.candidates["senate"].values())
        all_races.extend(self.candidates["governor"].values())
        for candidates in all_races:
            for candidate in candidates:
                self.assertNotIn("\u258c", candidate["candidate"])

    def test_historical_roster_has_no_fabricated_house_predecessor(self):
        house = self.history["house"]
        self.assertEqual(len(house), 434)
        self.assertEqual(set(self.candidates["house"]) - set(house), {"WI-08"})
        self.assertNotIn("MT-AL", house)
        self.assertIn("MT-01", house)
        self.assertIn("MT-02", house)
        self.assertEqual(self.history["metadata"]["houseNoPriorContest"], ["WI-08"])

    def test_historical_contests_and_candidate_vote_totals_are_valid(self):
        self.assertEqual(len(self.history["senate"]), 35)
        self.assertEqual(len(self.history["governor"]), 36)
        self.assertEqual(self.history["governor"]["NH"]["year"], 2024)
        self.assertEqual(self.history["governor"]["VT"]["year"], 2024)
        for office in ("house", "senate", "governor"):
            for race in self.history[office].values():
                self.assertGreaterEqual(race["year"], 2020)
                self.assertGreaterEqual(len(race["candidates"]), 1)
                for candidate in race["candidates"]:
                    self.assertTrue(candidate["candidate"])
                    self.assertIsInstance(candidate["votes"], int)
                    self.assertGreaterEqual(candidate["votes"], 0)

    def test_georgia_senate_history_uses_latest_runoff_not_prior_cycle(self):
        georgia = {row["candidate"]: row["votes"] for row in self.history["senate"]["GA"]["candidates"]}
        self.assertEqual(self.history["senate"]["GA"]["year"], 2022)
        self.assertEqual(self.history["senate"]["GA"]["stage"], "runoff")
        self.assertEqual(georgia["Herschel Junior Walker"], 1_721_244)
        self.assertEqual(georgia["Raphael Warnock"], 1_820_633)
        self.assertLess(max(row["votes"] for race in self.history["senate"].values() for row in race["candidates"]), 20_000_000)

    def test_alaska_ranked_choice_history_uses_round_one_vote_counts(self):
        alaska = {row["candidate"]: row for row in self.history["house"]["AK-AL"]["candidates"]}
        self.assertEqual(alaska["Nick Begich III"]["votes"], 159_550)
        self.assertEqual(alaska["Mary Peltola"]["votes"], 152_828)
        self.assertTrue(all(row["stage"] == "first-round" for row in alaska.values()))

    def assert_candidate_rows(self, candidates):
        self.assertTrue(candidates)
        for candidate in candidates:
            self.assertTrue(candidate["candidate"].strip())
            self.assertTrue(candidate["party"].strip())
            self.assertIn(candidate["partyCode"], {"D", "R", "O"})


if __name__ == "__main__":
    unittest.main()
