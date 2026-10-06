# Election Night Watch

A local results collector for the November 3, 2026 election. It polls Open America's documented JSON API for House, Senate, and Governor races, and watches official state election pages outside Open America's current 22-state coverage. Those currently include the four priority Senate states Alaska, Maine, New Hampshire, and Ohio, plus the other 24 uncovered states.

The collector writes `data/latest.json` for a dashboard to consume and appends every polling cycle to `data/history.jsonl`. It never interprets a missing race as zero votes. Open America records retain its `live`, `stale`, and `as_of` values. State-page rows are tagged `verificationRequired`; candidate/vote data is extracted only when a table or file has recognizable headers. Unrecognized pages still produce source health and discovered result links. Several official state sites currently return HTTP 403 to the collector; it records those denials rather than disguising the client or using a proxy. Wisconsin uses its official MyVote results guidance page, which says election-night totals are published by county clerks rather than at a statewide site; the linked official county directory is preserved in discovered sources.

## Election night dashboard

The workspace includes a browser dashboard in `dashboard/`. It reads `data/latest.json`, refreshes every 30 seconds, and has Governor, Senate, and House race views. The View selector switches between reported 2026 results, Holds & pickups, an Overperformance vs. past election overlay, Past results, and a static Current control map of sitting officeholders: click a state to see its governor or both senators by name, or a House district to see its representative. Holds & pickups compares the reported leading party against the incumbent for that contest or district: lighter blue/red shades are Democratic/Republican hold leads, while darker shades are pickup leads. Unreported or tied areas remain neutral; leads are not Dalton calls or certified results. Senate state shapes are split into the two seats in Current control view, listed by Senate class from lowest to highest. The static baseline is dated in the dashboard and bundled in `dashboard/current-control.json`; House and Senate officeholders are from the [current legislators roster](https://github.com/unitedstates/congress-legislators/blob/main/legislators-current.yaml), released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/), and the governor roster is linked from the data and cites the National Governors Association. Vacant House districts have no party fill. In results view, a dashed gold outline marks a Democratic/Republican lead that differs from the sitting officeholder's party; it indicates a reported lead, not a projection, call, or officially confirmed flip.

Use a race's **WATCH** button in its reported-results heading, selected-area detail, or Dalton projection card to save it to the browser-local watchlist. The **Watched only** checkbox filters reported results to those races. The watchlist persists in that browser between visits.

The reported-results table groups candidates beneath their race heading and displays race-wide totals when available. County candidate totals are summed only when a race-wide total is unavailable; county-only reporting percentages appear only when precinct counts support a weighted calculation.

The 2026 map hover/focus tooltip and selected-area panel list each named general-election candidate, party, and vote total. Click a state (or a House district) on the map to open its selected-area candidate cards; the cards show standardized portrait thumbnails beside names, and map tooltips and reported-result rows also include compact portraits. The dashboard loads photos only from its same-origin `dashboard/candidate-photos/` library, so the browser does not make blocked Wikimedia API requests. Refresh the library with `py scripts/refresh_candidate_photos.py`; by default this includes Senate and Governor candidates in tracked statewide races and candidates in Cook-rated priority House districts. Add `--all` to include the remaining House candidates, or `--limit N` to process only the first N names. The script uses a descriptive User-Agent, searches Commons for exact candidate-name matches, downloads thumbnails locally, and accepts only public-domain, CC0, CC BY, or CC BY-SA images after checking each file's license metadata. Each displayed photo links to its Commons file page and shows the creator/license credit. Missing, unlicensed, and failed lookups remain **No Image**. Public-official status alone does not make every photo free to reuse; no image is displayed without an accepted license. The photo manifest is `dashboard/candidate-photos/index.json`; the cache script reports lookup/download failures as it runs. Party-colored dots distinguish Democrats (blue), Republicans (red), Greens (green), Libertarians (yellow), Independents (beige), and other parties (purple). Candidate vote share is shown beside totals when the source provides it, or calculated from the totals currently available for that contest; it is unavailable until votes are reported. The bundled candidate roster in `dashboard/candidates-2026.json` was retrieved from the linked 2026 House, Senate, and gubernatorial overview pages on October 4, 2026. It is a cited, community-maintained list, not an official certification, and is attributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Candidates without a matching reported result are displayed as **0 · awaiting results** placeholders; this zero is not a reported tally. Matching live collector rows replace their placeholders, and newly observed live candidates are retained rather than dropped. No candidate names are invented. County placeholders use the statewide candidate list, but county totals and map shading remain grey until the collector supplies county-level results.

Dalton only projects a live race on the first refreshed snapshot where the non-stale Open America results feed is explicitly marked final, every candidate row in that contest has a valid vote total, and one candidate has strictly more votes than every other candidate. If the feed names a winner, that name must match the leading candidate. Ties, partial/non-final feeds, stale feeds, county subtotals, and heuristic state-page rows are never projected. The live rule has no statistical probability threshold and is deliberately conservative; it does not establish official certification. Dalton projections appear in a scrollable announcement panel grouped by Governor, Senate, and House, with up to 20 recent calls displayed at once. Each call card uses the winner's bundled portrait (or the standard **No Image** placeholder), states their current vote share, and tags the race as **HOLD** when the winner's party matches the current officeholder or **PICKUP** when it differs; no tag is shown when the incumbent party is unavailable. Each card also has a **WATCH** control. The vote-share percentage is recalculated as new snapshots arrive. New race calls animate the corresponding anchor in the Dalton Election Desk hero: Mika (blue) for Democrats, Rory (red) for Republicans, and Sora (beige) for Independents/other parties. Called races do not receive a map highlight. A theme-colored outline pulses around a state, county, or House district when its selected-office results change between snapshots; it remains until that area is clicked, and a later update marks it again. The first loaded snapshot establishes the baseline and is not marked as new. On statewide Senate and Governor results maps, markers identify states with an active race and reachable source (highlight-colored dot), no race for the selected office (hollow square), or an active race with an unavailable source (orange diamond). The status reflects collector source health, not whether results have been posted. Animations respect reduced-motion settings.

Use **Enable alerts** to request browser notification permission and unlock local sound playback. Alerts are off by default; existing calls in the first loaded snapshot are treated as history and do not trigger a burst of notifications. New calls receive a party-keyed ascending chime and a notification naming the race and projected winner. Keep the dashboard open for its 30-second refresh to detect new calls. In demo mode, alert titles are prefixed **DEMO**.

The original vector news-desk illustration is bundled inline with the dashboard; Mika, Rory, and Sora sit before a sleek, theme-adaptive American flag-inspired studio backdrop. Their shirts retain their blue, red, and beige party mappings, and the relevant anchor animates only when a new projection is made.

Before the poll-close cutoff, State Details also show individual 2026 polls for the selected office (and exact House district) plus linked state-race headlines. FiveThirtyEight's old polling downloads are not a current 2026 feed, so polling uses the documented VoteHub Polls API as a fallback. Polls are attributed to VoteHub under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), linked to their original poll source, sorted by field end date, and never combined into a dashboard-created average. Coverage varies: the provider currently has Governor records, while Senate and House queries may be empty; the dashboard says when no matching poll is listed instead of substituting an unrelated race or old cycle. Google News RSS headlines link out to the publisher/Google News story and are refreshed hourly; VoteHub polls refresh every 30 minutes. Both intervals are configurable in `config/sources.json`.

Polling and headlines are hidden starting three hours before the latest scheduled poll close in the selected state. The cutoff schedule is for November 3, 2026, expressed in Eastern Time and sourced from [270toWin's 2026 poll-closing schedule](https://www.270towin.com/poll-closing-times/index.php); district-specific closing times are applied for Florida, Idaho, Indiana, Kansas, Kentucky, Michigan, and Texas House districts. The dashboard's cutoff only controls when these supplementary panels appear; it is not a voter-information tool. Google News RSS is intended here for this private, personal-use dashboard; review Google's current terms before using or redistributing it elsewhere.

Past results use `dashboard/historical-results.json` and are labeled by the year of each contest's most recent completed election, including runoffs (Georgia Senate uses the 2022 runoff). Senate history is from the [MIT Election Data and Science Lab U.S. Senate dataset](https://doi.org/10.7910/DVN/PEJ5QU); House and governor totals are linked to their source pages in the data. Wikipedia-derived House and governor content is attributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). House results are matched by district number to 2024; maps and district boundaries may have changed since then, so that match is not a claim that the geography is identical. Wisconsin's new WI-08 has no same-district 2024 result and is explicitly left unavailable. Alaska's ranked-choice House history shows first-round candidate totals. Historical county subtotals are not included or inferred.

The Overperformance view subtracts the prior comparable contest's two-party margin from the current reported two-party margin, in percentage points: positive values are Democratic overperformance (blue), negative values are Republican overperformance (red), and zero is neutral. National and selected-state values pool the D/R votes from only comparable contests with current and historical totals, so contests are weighted by their two-party vote totals; metric notes show the matched contest count and prior election year(s). House comparisons match district identifiers, so changed district boundaries remain a limitation. County shading and the county metric require historical returns for that same office and county; no presidential result or other-office proxy is used. No such county history is currently bundled, so county comparisons are shown as unavailable/grey. If added later, county data belongs under `counties` in `historical-results.json`, keyed by lower-case office name, state code, and five-digit county FIPS, with each entry containing `year` and a `candidates` array using the same fields as the corresponding statewide historical candidates.

Choose Classic, Sakura, Orchid Mode, America Mode, or Mizu Mode (水, “water”) from the theme selector; the choice is saved in this browser. Each theme coordinates the dashboard surfaces, map-update highlight, race-call panel, news-desk studio colors, and the tinted American-flag wallpaper while retaining party colors. The locally drawn flag is darkened behind the interface for legibility. Mika, Rory, and Sora share one live insight bubble beside their avatars: Mika highlights positive Democratic movement, Rory Republican movement, and Sora general reporting facts. Each insight stays visible for at least one minute, then rotates to another relevant anchor or clears if there is nothing significant to report. State and county maps are used for statewide races; House uses clickable congressional districts. Use the on-map +/−/Reset controls, mouse wheel, or drag to zoom and pan. Democrat-leading areas use a blue gradient and Republican-leading areas use a red gradient, with stronger color for a larger reported margin. Tied races are white; independent/third-party leaders are beige; missing results or unknown-party leaders remain grey. County results appear only when an upstream source provides a county name or five-digit county FIPS. Open America currently supplies state-level results; no missing county is treated as zero votes.

The map's **Competitive races** filter includes states with a 2026 U.S. Senate or gubernatorial contest and the House races identified in the competitive-race list. The House list includes all 43 districts Cook Political Report rated Toss Up or Lean (Democrat or Republican) in its September 25, 2026 ratings. This covers the requested top 40 without arbitrarily cutting three races from a shared rating tier. The current list and attribution URL are in `config/sources.json`; review Cook's terms of use before redistributing those ratings.

The state and county boundary file in `dashboard/counties-albers-10m.json` is from the `us-atlas` package, derived from U.S. Census Bureau 2017 cartographic boundary files. The dashboard bundles D3 Geo, D3 Array, and TopoJSON Client under `dashboard/vendor/` so the map works without loading mapping code from a CDN. Their licenses are included alongside the assets.

House district shapes are the 435 voting districts for the 119th Congress from the U.S. Census Bureau's 2024 Cartographic Boundary File and are bundled as `dashboard/congressional-districts-119.geojson`. House candidate rows must contain an identifiable district (for example `ME-02` or a district number plus state) to appear on that map.

Run the collector in one terminal:

```powershell
python -m election_watch.cli --watch --interval 60 --verbose
```

From the workspace root, serve the dashboard in a second terminal:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000/dashboard/>. The dashboard reports when no snapshot exists yet; run the collector once to create `data/latest.json`. Keep the local server private to your machine or trusted network; the dashboard has no authentication and is not intended to be exposed publicly.

To test the dashboard's election-night trickle behavior without changing collector data, open <http://localhost:8000/dashboard/?demo=trickle>. It simulates the full 2026 candidate roster across 35 stages from the first poll close through 3:30 a.m. ET. The staggered state and selected House-district poll-close schedule is based on published poll-closing tables and is included in `dashboard/demo-trickle.json`. Statewide races begin reporting only after their own poll close; district exceptions account for split time zones. State and county vote totals are deterministic and monotonic: each county's 2024 Democratic/Republican share and turnout shape is adjusted to a fixed synthetic contest outcome, smaller counties tend to report sooner, and high-turnout counties (often urban) arrive later. These are not 2026 forecasts. The 3,142 county baselines are bundled in `dashboard/demo-county-baselines.json` and derived from the MIT-licensed [2024 county presidential results dataset](https://github.com/tonmcg/US_County_Level_Election_Results_08-24); 35 geography features without direct source matches use disclosed state-average estimates. The dataset omits Connecticut, so the eight Connecticut county-map entries evenly allocate the statewide 2024 presidential totals cited by [Ballotpedia](https://ballotpedia.org/Connecticut_election_results,_2024). Use the Race selector for Governor/Senate state and county maps or the House map of all 435 districts; districts start reporting after their own poll close. Unopposed House contests are included in district results but do not receive model-based calls. The vote-weighted progress bar and click-through maps show reporting in progress; county batches can shift a statewide lead without reversing or subtracting previously reported candidate votes.

## Publish the static demo with GitHub Pages

The repository includes a GitHub Actions workflow that publishes a curated static site: the root landing page, `dashboard/` and `config/sources.json`. It excludes the collector, `data/`, and other workspace files. The landing page links directly to the synthetic demo, and the dashboard header also has a persistent **Launch trickle demo** link. The demo URL is `https://<owner>.github.io/<repository>/dashboard/?demo=trickle` for a project site (or `https://<owner>.github.io/dashboard/?demo=trickle` for a user or organization site); links are relative and work with either base path.

To publish, push this workspace to a GitHub repository using its `main` or `master` branch, then in the repository open **Settings → Pages** and set the build and deployment source to **GitHub Actions**. The workflow requests Pages enablement automatically if needed; if GitHub does not permit that change, enable Pages in Settings and choose **GitHub Actions** as the source. The `Publish static election demo` workflow deploys on pushes to either branch; it can also be started manually from **Actions**. After the first successful run, GitHub displays the published site URL in the Pages settings and workflow deployment.

The published dashboard is a synthetic preview; it does not include `data/latest.json` or run the collector. The dashboard’s live-results view therefore requires a separately secured collector/API deployment. Do not publish collector data or expose the unauthenticated local server as a substitute.

Demo calls use a separate, illustrative model and are latched so they never disappear. Starting at the first update after that contest's polls close, it forecasts final candidate totals from counted votes plus the synthetic county-baseline estimate for unreported votes. It calculates the leader's win probability with a normal approximation: the uncertainty (in percentage points) is `sqrt(0.35² + (7 × unreported vote share)²)`. A call occurs on the first update where a unique forecast leader reaches at least 99.5% estimated win probability; each card shows the poll-close time, call time, probability, and reported-vote share at the call. The approximately 3% independent/other winner share applies to the eligible synthetic call set. This intentionally transparent demonstration is not calibrated for real-world calls and is never used on live results; live calls continue to require the explicitly final, non-stale feed described above. Calls appear in the projection announcement and seat tally, not as map highlights. Theme-colored outlines mark areas with changed results since the previous demo stage until clicked. Use **Results map** to show leads and calls, and **Already controlled** to compare the current officeholder map. Use **Next update** to step through the stages, **Auto-play** to advance every six seconds, **Restart** to return to the empty board, or **Exit demo** to return to live results. The demo is clearly labeled and never writes to `data/latest.json`; all demo candidates, votes, calls, and timings are synthetic.

## Run

Requires Python 3.10 or newer.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
python -m election_watch.cli --once --verbose
```

Continuously poll every 60 seconds (the Open America API's documented election-night interval):

```powershell
python -m election_watch.cli --watch --interval 60 --verbose
```

Press Ctrl+C to stop. Increase `--interval` if a state portal asks for a slower rate. The minimum accepted interval is 30 seconds; do not use that as a target without checking each source's terms and behavior.

## What it can and cannot automate

- Open America is read directly from `/elections/results.json?year=2026&office=...`; no key is required. The live feed is currently empty until state counts arrive. Its current state coverage and attribution requirements are documented at <https://openamerica.io/elections/api/>.
- The state monitor requests official election pages for all 50 states and the District of Columbia, then discovers explicitly labeled results pages and same-host CSV, JSON, or XLSX files. It follows at most two same-host result pages and fetches at most two same-host data files per state per cycle. Candidate/vote headers must be recognizable; candidate, party, vote count, reported vote share, precinct reporting, county, county FIPS, and district columns are retained when supplied. External election-vendor links are listed for review but are not fetched automatically.
- HTML tables are parsed only when headers clearly identify candidate and vote totals. State pages often use third-party vendors, JavaScript, PDFs, or changing markup. Those cases are reported as discovered links with zero parsed rows; they are not silently treated as zero votes. External vendor links are listed but not followed automatically.
- State counts can be unofficial. The collector preserves source URLs and capture timestamps, but state-page extraction must be checked against the linked official source before it is shown as confirmed.
- This does not call races, estimate missing vote, or certify results. It is a personal-use collector, not an official results service. Review each source's terms and robots.txt before enabling polling; the collector sends conditional requests when available but does not enforce robots.txt automatically.

## Add or tune a state source

Edit `config/sources.json`. Use the state's actual live results page when it is published, rather than relying only on a generic office homepage. Keep the source link visible in any dashboard. The priority list is based on the October 2026 competitive Senate-race ratings and may change before Election Day.

## Output states

Each source health record includes `reachable`/`error`, HTTP status, response validators, row count, and capture time. Open America additionally supplies its own live/stale/counting/final fields. Each state result has `verificationRequired: true`. An empty result set means no recognized result payload was parsed, not that a candidate has zero votes.

## Precinct history and race-call backtesting

The collector writes schema version 2 snapshots. Candidate rows with a named precinct are placed in the separate `precinctResults` array rather than mixed into `results`, so precinct subtotals cannot be mistaken for statewide or county totals by the dashboard. When official HTML/CSV/XLSX/JSON tables expose them, these rows preserve precinct name/ID/FIPS, precincts reported/total, and votes or ballots outstanding. Every polling cycle is appended to `data/history.jsonl`, retaining the observed sequence for later replay. Sources that publish only aggregate totals cannot provide precinct-level observations; those values are not estimated or fabricated.

To evaluate an experimental model, save one JSON object per contest and capture time in a predictions JSONL file:

```json
{"contestId":"2026|ME|Senate","capturedAt":"2026-11-03T22:00:00Z","candidate":"Candidate Name","winProbability":0.997}
```

`contestId` must be stable and uniquely identify one race for the election. `winProbability` is the model's estimated chance that the named candidate wins. Keep the independently established final winner in a separate outcomes file:

```json
{
  "contests": {
    "2026|ME|Senate": {
      "winner": "Candidate Name",
      "finalizedAt": "2026-11-03T23:00:00Z",
      "referenceCalls": {
        "AP": "2026-11-03T22:30:00Z",
        "CNN": "2026-11-03T22:45:00Z"
      }
    }
  }
}
```

`finalizedAt` is required and records when the independently determined final result was available, preventing post-outcome predictions from leaking into the evaluation. `referenceCalls` is optional and records when named outlets called the race. Run `python -m election_watch.backtest --predictions model-predictions.jsonl --outcomes final-outcomes.json` (or install the project entry point and run `election-backtest`). The default call threshold is 99.5% estimated win probability. The report includes first-threshold-crossing accuracy, a one-sided 95% Clopper-Pearson upper bound on the observed false-call rate, a top-candidate Brier score, lead time to finalization, and lead time versus any named reference calls (positive means the model was earlier). The 0.5% target is considered supported only when that upper bound is at or below 0.5%; the bound assumes independent, comparable calls, so dependence among races can make it optimistic. A probability estimate or small zero-error sample is not proof of safety. This evaluator does not generate predictions or enable dashboard calls. Validate a model on representative, out-of-sample elections before changing the existing feed-final call rule.

## Test

```powershell
python -m unittest discover -s tests -v
```
