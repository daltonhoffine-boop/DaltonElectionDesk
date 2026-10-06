import unittest
from datetime import datetime, timezone

from election_watch.backtest import _false_call_upper_bound, evaluate_predictions


class BacktestTests(unittest.TestCase):
    def setUp(self):
        self.outcomes = {
            "ME|Senate|2026": {
                "winner": "Ada Example",
                "winnerKey": "ada example",
                "finalizedAt": datetime(2026, 11, 3, 23, tzinfo=timezone.utc),
                "referenceCalls": {
                    "AP": datetime(2026, 11, 3, 22, 30, tzinfo=timezone.utc),
                    "CNN": datetime(2026, 11, 3, 22, 45, tzinfo=timezone.utc),
                },
            }
        }

    def prediction(self, candidate, probability, hour):
        return {
            "contestId": "ME|Senate|2026",
            "candidate": candidate,
            "candidateKey": candidate.casefold(),
            "winProbability": probability,
            "capturedAt": datetime(2026, 11, 3, hour, tzinfo=timezone.utc),
        }

    def test_calls_at_probability_threshold_are_compared_with_final_outcome(self):
        report = evaluate_predictions(
            [
                self.prediction("Ada Example", 0.98, 20),
                self.prediction("Ada Example", 0.997, 22),
            ],
            self.outcomes,
        )
        self.assertEqual(report["callCount"], 1)
        self.assertEqual(report["falseCallCount"], 0)
        self.assertEqual(report["calls"][0]["calledAt"], "2026-11-03T22:00:00+00:00")
        self.assertEqual(report["calls"][0]["leadMinutes"], 60)
        self.assertEqual(report["calls"][0]["referenceCallLeadMinutes"], {"AP": 30, "CNN": 45})
        self.assertEqual(report["medianLeadMinutesVsReferences"], {"AP": 30, "CNN": 45})
        self.assertIsNotNone(report["topCandidateBrierScore"])

    def test_first_threshold_crossing_is_counted_as_false_when_candidate_loses(self):
        report = evaluate_predictions(
            [
                self.prediction("Blair Sample", 0.996, 20),
                self.prediction("Ada Example", 0.999, 22),
            ],
            self.outcomes,
        )
        self.assertEqual(report["callCount"], 1)
        self.assertEqual(report["falseCallCount"], 1)
        self.assertEqual(report["empiricalFalseCallRate"], 1.0)
        self.assertEqual(report["calls"][0]["calledCandidate"], "Blair Sample")
        self.assertFalse(report["targetSupported"])

    def test_no_false_calls_need_a_large_sample_to_support_half_percent_target(self):
        bound = _false_call_upper_bound(0, 600)
        self.assertLessEqual(bound, 0.005)
        self.assertGreater(_false_call_upper_bound(0, 100), 0.005)

    def test_threshold_must_be_above_a_coin_flip(self):
        with self.assertRaises(ValueError):
            evaluate_predictions([], self.outcomes, minimum_win_probability=0.5)

    def test_predictions_at_or_after_finalization_are_not_scored(self):
        with self.assertRaisesRegex(ValueError, "before the final outcome"):
            evaluate_predictions([self.prediction("Ada Example", 0.999, 23)], self.outcomes)


if __name__ == "__main__":
    unittest.main()
