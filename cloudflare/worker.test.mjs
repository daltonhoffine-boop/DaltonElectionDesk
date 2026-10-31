import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenAmerica } from "./worker.js";

const payload = {
  api: 1,
  year: 2026,
  live: true,
  stale: false,
  counting: true,
  final: false,
  as_of: "2026-11-04T01:00:00Z",
  counts: { races: 1 },
  races: {
    "ME-S": {
      pct_in: 12.5,
      leader: "D",
      totalvotes: 300,
      cands: [
        { n: "Ada Example", p: "D", v: 200, pct: 66.7 },
        { n: "Bo Sample", p: "R", v: 100, pct: 33.3 },
      ],
    },
  },
};

test("normalizes Open America rows like the Python collector", () => {
  const { results, status } = normalizeOpenAmerica(payload, "Senate", "t");
  assert.equal(results.length, 2);
  assert.equal(results[0].state, "ME");
  assert.equal(results[0].votes, 200);
  assert.equal(results[0].precinctsReportingPct, 12.5);
  assert.equal(results[0].winnerDeclared, false);
  assert.equal(results[0].feedLive, true);
  assert.equal(status.resultCount, 2);
  assert.equal(status.raceCount, 1);
});

test("keeps missing votes null rather than zero", () => {
  const body = structuredClone(payload);
  delete body.races["ME-S"].cands[0].v;
  assert.equal(normalizeOpenAmerica(body, "Senate", "t").results[0].votes, null);
});

test("rejects unsupported API versions", () => {
  assert.throws(() => normalizeOpenAmerica({ api: 2 }, "Senate", "t"));
});
