"""Evaluate saved race-win predictions against independently recorded outcomes."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _parse_timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{field} must be an ISO-8601 timestamp: {value!r}") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone: {value!r}")
    return parsed.astimezone(timezone.utc)


def _candidate_key(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty candidate name")
    return " ".join(unicodedata.normalize("NFC", value).casefold().split())


def load_predictions(path: Path) -> list[dict[str, Any]]:
    predictions = []
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                prediction = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {error.msg}") from error
            if not isinstance(prediction, dict):
                raise ValueError(f"{path}:{line_number}: each prediction must be a JSON object")
            contest_id = prediction.get("contestId")
            if not isinstance(contest_id, str) or not contest_id.strip():
                raise ValueError(f"{path}:{line_number}: contestId must be a non-empty string")
            candidate = prediction.get("candidate")
            candidate_key = _candidate_key(candidate, f"{path}:{line_number}: candidate")
            probability = prediction.get("winProbability")
            if isinstance(probability, bool) or not isinstance(probability, (int, float)):
                raise ValueError(f"{path}:{line_number}: winProbability must be a finite number")
            try:
                probability = float(probability)
            except (OverflowError, ValueError) as error:
                raise ValueError(f"{path}:{line_number}: winProbability must be a finite number") from error
            if not math.isfinite(probability):
                raise ValueError(f"{path}:{line_number}: winProbability must be a finite number")
            if not 0 <= probability <= 1:
                raise ValueError(f"{path}:{line_number}: winProbability must be between 0 and 1")
            captured_at = _parse_timestamp(prediction.get("capturedAt"), f"{path}:{line_number}: capturedAt")
            predictions.append({
                "contestId": contest_id.strip(),
                "candidate": candidate.strip(),
                "candidateKey": candidate_key,
                "winProbability": probability,
                "capturedAt": captured_at,
            })
    return predictions


def load_outcomes(path: Path) -> dict[str, dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path}: invalid JSON: {error.msg}") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("contests"), dict):
        raise ValueError(f"{path}: expected an object with a contests mapping")

    outcomes = {}
    for contest_id, outcome in payload["contests"].items():
        if not isinstance(contest_id, str) or not contest_id.strip() or not isinstance(outcome, dict):
            raise ValueError(f"{path}: each contest outcome must map a non-empty contestId to an object")
        finalized_at = outcome.get("finalizedAt")
        if finalized_at is None:
            raise ValueError(f"{path}: finalizedAt is required for contest {contest_id!r}")
        reference_calls = outcome.get("referenceCalls", {})
        if not isinstance(reference_calls, dict):
            raise ValueError(f"{path}: referenceCalls for {contest_id!r} must be an object")
        normalized_reference_calls = {}
        for source, timestamp in reference_calls.items():
            if not isinstance(source, str) or not source.strip():
                raise ValueError(f"{path}: reference call source labels must be non-empty strings")
            normalized_reference_calls[source.strip()] = _parse_timestamp(
                timestamp,
                f"{path}: referenceCalls.{source}",
            )
        normalized_contest_id = contest_id.strip()
        if normalized_contest_id in outcomes:
            raise ValueError(f"{path}: duplicate contestId after whitespace normalization: {normalized_contest_id!r}")
        outcomes[normalized_contest_id] = {
            "winner": outcome.get("winner"),
            "winnerKey": _candidate_key(outcome.get("winner"), f"{path}: outcome winner"),
            "finalizedAt": _parse_timestamp(finalized_at, f"{path}: finalizedAt"),
            "referenceCalls": normalized_reference_calls,
        }
    return outcomes


def _binomial_cdf(errors: int, calls: int, probability: float) -> float:
    if probability <= 0:
        return 1.0
    if probability >= 1:
        return 1.0 if errors == calls else 0.0
    log_terms = [
        math.lgamma(calls + 1)
        - math.lgamma(error_count + 1)
        - math.lgamma(calls - error_count + 1)
        + error_count * math.log(probability)
        + (calls - error_count) * math.log1p(-probability)
        for error_count in range(errors + 1)
    ]
    largest = max(log_terms)
    return math.exp(largest) * sum(math.exp(term - largest) for term in log_terms)


def _false_call_upper_bound(errors: int, calls: int, confidence: float = 0.95) -> float | None:
    """One-sided Clopper-Pearson upper bound for the observed false-call rate."""
    if calls == 0:
        return None
    if not 0 <= errors <= calls:
        raise ValueError("errors must be between zero and calls")
    if errors == calls:
        return 1.0
    if errors == 0:
        return 1 - (1 - confidence) ** (1 / calls)

    alpha = 1 - confidence
    low, high = 0.0, 1.0
    for _ in range(80):
        midpoint = (low + high) / 2
        if _binomial_cdf(errors, calls, midpoint) > alpha:
            low = midpoint
        else:
            high = midpoint
    return high


def evaluate_predictions(
    predictions: list[dict[str, Any]],
    outcomes: dict[str, dict[str, Any]],
    *,
    minimum_win_probability: float = 0.995,
    maximum_false_call_rate: float = 0.005,
) -> dict[str, Any]:
    if not 0.5 < minimum_win_probability <= 1:
        raise ValueError("minimum_win_probability must be greater than 0.5 and at most 1")
    if not 0 < maximum_false_call_rate < 1:
        raise ValueError("maximum_false_call_rate must be greater than 0 and less than 1")

    if any(outcome.get("finalizedAt") is None for outcome in outcomes.values()):
        raise ValueError("Every final outcome must include finalizedAt to prevent temporal leakage")
    groups: dict[str, list[dict[str, Any]]] = {}
    seen_observations = set()
    for prediction in predictions:
        contest_id = prediction["contestId"]
        if contest_id not in outcomes:
            raise ValueError(f"No final outcome supplied for predicted contest {contest_id!r}")
        observation_key = (contest_id, prediction["capturedAt"])
        if observation_key in seen_observations:
            raise ValueError(f"Duplicate prediction timestamp for contest {contest_id!r}")
        seen_observations.add(observation_key)
        groups.setdefault(contest_id, []).append(prediction)

    calls = []
    brier_scores = []
    prediction_observations = 0
    contests_evaluated = 0
    contests_without_pre_final_predictions = 0
    reference_leads: dict[str, list[float]] = {}
    for contest_id, contest_predictions in groups.items():
        outcome = outcomes[contest_id]
        contest_predictions.sort(key=lambda prediction: prediction["capturedAt"])
        eligible = [
            prediction
            for prediction in contest_predictions
            if prediction["capturedAt"] < outcome["finalizedAt"]
        ]
        if not eligible:
            contests_without_pre_final_predictions += 1
            continue
        contests_evaluated += 1
        prediction_observations += len(eligible)
        for prediction in eligible:
            actual = 1.0 if prediction["candidateKey"] == outcome["winnerKey"] else 0.0
            brier_scores.append((prediction["winProbability"] - actual) ** 2)
        first_call = next(
            (prediction for prediction in eligible if prediction["winProbability"] >= minimum_win_probability),
            None,
        )
        if first_call:
            lead_minutes = (outcome["finalizedAt"] - first_call["capturedAt"]).total_seconds() / 60
            reference_call_leads = {
                source: (reference_at - first_call["capturedAt"]).total_seconds() / 60
                for source, reference_at in outcome["referenceCalls"].items()
            }
            for source, lead in reference_call_leads.items():
                reference_leads.setdefault(source, []).append(lead)
            calls.append({
                "contestId": contest_id,
                "calledCandidate": first_call["candidate"],
                "winProbability": first_call["winProbability"],
                "calledAt": first_call["capturedAt"].isoformat(),
                "actualWinner": outcome["winner"],
                "correct": first_call["candidateKey"] == outcome["winnerKey"],
                "leadMinutes": lead_minutes,
                "referenceCallLeadMinutes": reference_call_leads,
            })

    if not contests_evaluated:
        raise ValueError("No predictions were captured before the final outcome timestamps")
    false_calls = sum(not call["correct"] for call in calls)
    call_count = len(calls)
    false_call_rate = false_calls / call_count if call_count else None
    upper_bound = _false_call_upper_bound(false_calls, call_count)
    lead_times = [call["leadMinutes"] for call in calls if call["leadMinutes"] is not None]
    return {
        "minimumWinProbability": minimum_win_probability,
        "maximumFalseCallRate": maximum_false_call_rate,
        "confidenceLevel": 0.95,
        "contestsEvaluated": contests_evaluated,
        "contestsWithoutPreFinalPredictions": contests_without_pre_final_predictions,
        "predictionObservations": prediction_observations,
        "topCandidateBrierScore": sum(brier_scores) / len(brier_scores) if brier_scores else None,
        "calls": calls,
        "callCount": call_count,
        "falseCallCount": false_calls,
        "empiricalFalseCallRate": false_call_rate,
        "falseCallRateUpper95": upper_bound,
        "targetSupported": upper_bound is not None and upper_bound <= maximum_false_call_rate,
        "medianLeadMinutes": statistics.median(lead_times) if lead_times else None,
        "leadTimeCallCount": len(lead_times),
        "medianLeadMinutesVsReferences": {
            source: statistics.median(leads)
            for source, leads in reference_leads.items()
        },
        "referenceCallComparisonCount": {
            source: len(leads)
            for source, leads in reference_leads.items()
        },
        "falseCallBoundAssumption": "Calls are treated as independent Bernoulli observations; cross-race and cross-election dependence can make the bound optimistic.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate archived race-win probabilities against final outcomes.")
    parser.add_argument("--predictions", type=Path, required=True, help="JSONL model predictions with contestId, capturedAt, candidate, and winProbability.")
    parser.add_argument("--outcomes", type=Path, required=True, help="JSON final-outcome labels keyed by contestId.")
    parser.add_argument("--minimum-win-probability", type=float, default=0.995, help="Probability required to count a call (default: 0.995).")
    parser.add_argument("--maximum-false-call-rate", type=float, default=0.005, help="Maximum tolerated false-call rate (default: 0.005).")
    args = parser.parse_args()

    try:
        report = evaluate_predictions(
            load_predictions(args.predictions),
            load_outcomes(args.outcomes),
            minimum_win_probability=args.minimum_win_probability,
            maximum_false_call_rate=args.maximum_false_call_rate,
        )
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
