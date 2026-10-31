// Serves the static dashboard and a live /data/latest.json snapshot built from Open America.
// State-page scraping stays in the Python collector; this feed covers Open America only.

const OPEN_AMERICA_URL = "https://openamerica.io/elections/results.json";
const OFFICES = ["House", "Senate", "Governor"];
const ELECTION = { year: 2026, date: "2026-11-03" };
const CACHE_SECONDS = 30;
const USER_AGENT = "ElectionNightMagicWall/0.1 (personal results display; respectful polling)";

const lastGood = new Map();

export function normalizeOpenAmerica(payload, office, fetchedAt) {
  if (!payload || payload.api !== 1) {
    throw new Error(`Unsupported Open America API version: ${JSON.stringify(payload?.api)}`);
  }
  const results = [];
  for (const [raceKey, race] of Object.entries(payload.races || {})) {
    const state = raceKey.split("-", 1)[0];
    for (const candidate of race.cands || []) {
      results.push({
        state,
        office,
        race: raceKey,
        candidate: candidate.n ?? "",
        party: candidate.p ?? "",
        votes: candidate.v ?? null,
        candidatePct: candidate.pct ?? null,
        precinctsReportingPct: race.pct_in ?? null,
        raceLeaderParty: race.leader ?? "",
        raceWinner: race.winner ?? null,
        winnerDeclared: Boolean(race.winner),
        feedFinal: Boolean(payload.final),
        feedTotalVotes: race.totalvotes ?? null,
        source: "Open America / official state election offices",
        sourceUrl: "https://openamerica.io/elections/api/",
        sourceAsOf: payload.as_of ?? null,
        capturedAt: fetchedAt,
        feedLive: Boolean(payload.live),
        feedStale: Boolean(payload.stale),
        method: "documented-json-api",
      });
    }
  }
  const status = {
    source: "Open America",
    office,
    year: payload.year ?? null,
    live: Boolean(payload.live),
    stale: Boolean(payload.stale),
    counting: Boolean(payload.counting),
    final: Boolean(payload.final),
    asOf: payload.as_of ?? null,
    raceCount: payload.counts?.races ?? 0,
    resultCount: results.length,
    capturedAt: fetchedAt,
    coverageLimited: true,
  };
  return { results, status };
}

async function fetchOffice(office, fetchedAt) {
  try {
    const url = `${OPEN_AMERICA_URL}?year=${ELECTION.year}&office=${office}`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { results, status } = normalizeOpenAmerica(await response.json(), office, fetchedAt);
    status.httpStatus = response.status;
    lastGood.set(office, { results, status });
    return { results, status };
  } catch (error) {
    const previous = lastGood.get(office);
    const status = {
      source: "Open America",
      office,
      status: "error",
      error: String(error.message || error),
      capturedAt: fetchedAt,
    };
    return { results: previous?.results || [], status };
  }
}

export async function buildSnapshot(env) {
  const capturedAt = new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
  const offices = await Promise.all(OFFICES.map((office) => fetchOffice(office, capturedAt)));

  let racePriorities = {};
  try {
    const config = await env.ASSETS.fetch("https://assets.local/config/sources.json");
    if (config.ok) racePriorities = (await config.json()).race_priorities || {};
  } catch {
    racePriorities = {};
  }

  return {
    allFailed: offices.every((entry) => entry.status.status === "error" && !entry.results.length),
    snapshot: {
      schemaVersion: 2,
      election: ELECTION,
      capturedAt,
      results: offices.flatMap((entry) => entry.results),
      precinctResults: [],
      sources: offices.map((entry) => entry.status),
      discoveredResultLinks: [],
      racePriorities,
      media: null,
      notices: [
        "This public feed reports Open America only. Official state pages not covered by Open America are not monitored here and must be checked at the source.",
        "A reachable page with zero parsed rows means no recognized structured result data was found; it does not mean zero votes.",
        "Open America does not cover every state; absent races are not zero-vote races.",
      ],
    },
  };
}

async function handleLatest(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/data/latest.json", request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const { snapshot, allFailed } = await buildSnapshot(env);
  if (allFailed) {
    return new Response(JSON.stringify({ error: "Open America is unreachable." }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const response = new Response(JSON.stringify(snapshot), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (pathname === "/data/latest.json") return handleLatest(request, env, ctx);
    if (pathname.startsWith("/data/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
