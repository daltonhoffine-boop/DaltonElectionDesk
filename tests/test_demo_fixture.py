import json
import re
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_PATH = PROJECT_ROOT / "dashboard"
FIXTURE_PATH = DASHBOARD_PATH / "demo-trickle.json"
BASELINES_PATH = DASHBOARD_PATH / "demo-county-baselines.json"
ROSTER_PATH = DASHBOARD_PATH / "candidates-2026.json"


class DemoFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.baselines = json.loads(BASELINES_PATH.read_text(encoding="utf-8"))
        cls.roster = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))

    def test_demo_fixture_has_ordered_election_night_stages(self):
        self.assertEqual(self.fixture["schemaVersion"], 4)
        stages = self.fixture["stages"]
        self.assertGreaterEqual(len(stages), 30)
        minutes = [stage["minutesAfterFirstClose"] for stage in stages]
        self.assertEqual(minutes[0], 0)
        self.assertGreaterEqual(minutes[-1], 420)
        self.assertEqual(minutes, sorted(set(minutes)))
        self.assertTrue(all(isinstance(stage["label"], str) and stage["label"] for stage in stages))
        self.assertTrue(all("countyCoveragePct" not in stage and "calledPercent" not in stage for stage in stages))

    def test_poll_close_schedule_covers_roster_and_house_exceptions(self):
        schedule = self.fixture["schedule"]
        self.assertEqual(schedule["timeZone"], "America/New_York")
        closes = schedule["pollCloseMinutesByState"]
        active_states = set(self.roster["senate"]) | set(self.roster["governor"])
        self.assertTrue(active_states.issubset(closes))
        self.assertTrue(all(isinstance(closes[state], int) and closes[state] >= 0 for state in active_states))
        house = self.roster["house"]
        self.assertTrue(set(schedule["houseDistrictCloseMinutes"]).issubset(house))
        self.assertTrue(all(isinstance(minute, int) and minute >= 0
                            for minute in schedule["houseDistrictCloseMinutes"].values()))
        house_states = {district[:2] for district in house}
        self.assertTrue(set(schedule["houseDistrictDefaultMinutesByState"]).issubset(house_states))

    def test_demo_call_model_is_explicit_and_separate(self):
        model = self.fixture["callModel"]
        self.assertEqual(model["minimumWinProbability"], 0.995)
        self.assertEqual(model["independentWinnerShare"], 0.03)
        self.assertGreater(model["unreportedUncertaintyPoints"], model["finalUncertaintyFloorPoints"])
        self.assertGreater(model["finalUncertaintyFloorPoints"], 0)

    def test_county_baselines_cover_the_map_and_disclose_estimates(self):
        baselines = self.baselines
        counties = baselines["counties"]
        self.assertEqual(baselines["schemaVersion"], 1)
        self.assertEqual(baselines["electionYear"], 2024)
        self.assertEqual(baselines["source"]["license"], "MIT")
        self.assertEqual(baselines["estimatedCountyCount"], 35)
        self.assertTrue(baselines["source"]["stateAverageEstimatesSource"]["url"])
        self.assertEqual(len(counties), 3142)
        self.assertEqual(sum(county.get("estimatedFromStateAverage", False) for county in counties.values()), 35)
        for fips, county in counties.items():
            self.assertRegex(fips, re.compile(r"^\d{5}$"))
            self.assertGreater(county["turnout"], 0)
            self.assertGreaterEqual(county["votesDem"], 0)
            self.assertGreaterEqual(county["votesRep"], 0)
            self.assertGreater(county["votesDem"] + county["votesRep"], 0)

    def test_demo_covers_the_full_2026_candidate_roster(self):
        expected_races = len(self.roster["house"]) + len(self.roster["senate"]) + len(self.roster["governor"])
        self.assertEqual(expected_races, 506)
        self.assertEqual(len(self.roster["house"]), 435)


if __name__ == "__main__":
    unittest.main()
