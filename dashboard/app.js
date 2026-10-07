(() => {
  "use strict";

  const REFRESH_MS = 30_000;
  const NATIONAL_POLL_REFRESH_MS = 30 * 60_000;
  const DEMO_MODE = new URLSearchParams(window.location.search).get("demo") === "trickle";
  const DEMO_STEP_MS = 6_000;
  const DEMO_MIDTERM_TURNOUT_SHARE = 0.62;
  const ANCHOR_INSIGHT_MINIMUM_MS = 60_000;
  const ANCHOR_SPEAKERS = ["mika", "rory", "sora"];
  const ANCHOR_SPEAKER_NAMES = { mika: "Mika", rory: "Rory", sora: "Sora" };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const STATES = [
    ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
    ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
    ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
    ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
    ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
    ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
    ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
    ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
    ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
    ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
    ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ].map(([code, name]) => ({ code, name }));
  const STATE_FIPS = {
    AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
    FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
    LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
    NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
    OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
    VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
  };
  const STATE_BY_FIPS = Object.fromEntries(Object.entries(STATE_FIPS).map(([state, fips]) => [fips, state]));
  const elements = Object.fromEntries([
    "connection-status", "connection-label", "captured-at", "refresh-note", "states-count",
    "results-count", "sources-count", "sources-caption", "verify-count", "election-map",
    "anchor-insight-bubble", "anchor-insight-speaker", "anchor-insight-message",
    "zoom-in", "zoom-out", "zoom-reset", "zoom-level",
    "map-mode", "race-view", "state-filter", "results-state-filter", "office-filter", "watched-only-toggle", "watchlist-count", "map-title", "map-hint", "map-back", "map-legend", "priority-attribution",
    "swing-summary", "swing-national", "swing-state", "swing-county",
    "theme-select", "call-alert-toggle", "call-alert-status",
    "detail-eyebrow", "detail-title", "state-detail", "clear-state", "results-body",
    "table-note", "results-title", "source-total", "source-list", "notices", "map-tooltip",
    "national-polling-panel", "national-polling", "national-polling-status",
    "projection-announcements", "projection-list",
    "projection-summary",
    "seat-tally-note",
    "majority-alert-overlay", "majority-alert-title", "majority-alert-details", "majority-alert-dismiss",
    "demo-controls", "demo-stage-label", "demo-call-rule", "demo-county-progress", "demo-county-progress-fill",
    "demo-county-progress-label", "demo-county-progress-note",
    "demo-next", "demo-auto", "demo-reset", "demo-results-view", "demo-control-view",
    ...["house", "senate", "governor"].flatMap((office) =>
      ["dem", "rep", "ind", "open", "bar-dem", "bar-rep", "bar-ind", "bar-open"]
        .map((party) => `seat-${office}-${party}`)),
  ].map((id) => [id, document.getElementById(id)]));

  let snapshot = null;
  let nationalPollingSnapshot = null;
  let nationalPollingError = null;
  let nationalPollingLastAttemptAt = 0;
  let priorityConfig = {};
  let currentControl = null;
  let currentControlError = null;
  let candidateRoster = null;
  let candidatePhotoIndex = {};
  let candidatePhotoError = null;
  let historicalResults = null;
  let raceDataError = null;
  let historicalResultsError = null;
  let geography = null;
  let geographyPromise = null;
  let selectedState = null;
  let selectedCounty = null;
  let selectedDistrict = null;
  let statePollingExpanded = true;
  let mapLayer = null;
  let mapScale = 1;
  let mapTranslateX = 0;
  let mapTranslateY = 0;
  let mapViewKey = "";
  let pointerStart = null;
  let suppressMapClick = false;
  let knownProjectionIds = new Set();
  let knownCallKeys = new Set();
  let projectionBaselineEstablished = false;
  let resultBaselineEstablished = false;
  let previousResultFingerprints = new Map();
  const unseenResultAreas = {
    states: new Set(),
    counties: new Set(),
    districts: new Set(),
  };
  let callAlertsEnabled = false;
  let callAudioContext = null;
  let callAudioReady = false;
  let nextCallChimeAt = 0;
  let projectionRenderSignature = "";
  let projectionCacheSnapshot = null;
  let projectionCache = new Map();
  let watchedRaceKeys = new Set();
  const announcedMajorityOffices = new Set();
  const pendingMajorityAlerts = [];
  let majorityAlertReturnFocus = null;
  let activeMajorityAlert = null;
  let demoData = null;
  let demoCountyBaselines = null;
  let demoStageIndex = 0;
  let demoTimer = null;
  const demoCallDecisions = new Map();
  let previousAnchorSummaries = null;
  let previousAnchorCountyAreas = new Map();
  let activeAnchorInsight = null;
  let activeAnchorInsightSince = 0;
  let anchorInsightTimer = null;
  let lastAnchorSpeaker = "sora";
  const pendingAnchorInsights = new Map();

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgElement(tag, className) {
    const node = document.createElementNS(SVG_NS, tag);
    if (className) node.setAttribute("class", className);
    return node;
  }

  function mapViewBox() {
    const box = elements["election-map"].viewBox.baseVal;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  function clampMapTranslation() {
    const box = mapViewBox();
    const minX = (box.x + box.width) * (1 - mapScale);
    const maxX = box.x * (1 - mapScale);
    const minY = (box.y + box.height) * (1 - mapScale);
    const maxY = box.y * (1 - mapScale);
    mapTranslateX = Math.min(maxX, Math.max(minX, mapTranslateX));
    mapTranslateY = Math.min(maxY, Math.max(minY, mapTranslateY));
  }

  function updateZoom() {
    if (mapLayer) mapLayer.setAttribute("transform", `translate(${mapTranslateX} ${mapTranslateY}) scale(${mapScale})`);
    elements["zoom-level"].textContent = `${Math.round(mapScale * 100)}%`;
    elements["zoom-out"].disabled = mapScale <= 1;
  }

  function setMapScale(nextScale, anchorX, anchorY) {
    const next = Math.max(1, Math.min(8, nextScale));
    if (next === mapScale) return;
    const ratio = next / mapScale;
    mapTranslateX = anchorX - (anchorX - mapTranslateX) * ratio;
    mapTranslateY = anchorY - (anchorY - mapTranslateY) * ratio;
    mapScale = next;
    clampMapTranslation();
    updateZoom();
  }

  function zoomAtCenter(factor) {
    const box = mapViewBox();
    setMapScale(mapScale * factor, box.x + box.width / 2, box.y + box.height / 2);
  }

  function createMapLayer() {
    mapLayer = svgElement("g", "map-layer");
    elements["election-map"].append(mapLayer);
    updateZoom();
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat("en-US").format(number) : "—";
  }

  function displayDate(value) {
    if (!value) return "Timestamp unavailable";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function updateCallAlertControl(message = "") {
    const button = elements["call-alert-toggle"];
    button.textContent = callAlertsEnabled ? "Alerts on" : "Enable alerts";
    button.setAttribute("aria-pressed", String(callAlertsEnabled));
    if (message) {
      elements["call-alert-status"].textContent = message;
    } else if (!callAlertsEnabled) {
      elements["call-alert-status"].textContent = "Alerts are off";
    } else if (!("Notification" in window)) {
      elements["call-alert-status"].textContent = callAudioReady ? "Sound on · notifications unsupported" : "Notifications unsupported · sound locked";
    } else if (window.Notification.permission === "denied") {
      elements["call-alert-status"].textContent = callAudioReady ? "Sound on · notifications blocked" : "Notifications blocked · sound locked";
    } else if (window.Notification.permission !== "granted") {
      elements["call-alert-status"].textContent = callAudioReady ? "Sound on · notifications not enabled" : "Notifications not enabled · sound locked";
    } else {
      elements["call-alert-status"].textContent = callAudioReady ? "Sound and notifications on" : "Notifications on · tap to unlock sound";
    }
  }

  async function unlockCallAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!callAudioContext) callAudioContext = new AudioContextClass();
    await callAudioContext.resume();
    return callAudioContext.state === "running";
  }

  async function toggleCallAlerts() {
    if (callAlertsEnabled) {
      callAlertsEnabled = false;
      callAudioReady = false;
      nextCallChimeAt = 0;
      if (callAudioContext?.state === "running") {
        callAudioContext.suspend().catch((error) => console.error("Election call audio could not be paused.", error));
      }
      updateCallAlertControl();
      return;
    }

    const audioUnlock = unlockCallAudio().catch((error) => {
      console.error("Election call audio could not be enabled.", error);
      return false;
    });
    let permissionFailure = null;
    const notificationsSupported = "Notification" in window;
    let permissionRequest = Promise.resolve(notificationsSupported ? window.Notification.permission : "unsupported");
    if (notificationsSupported && window.Notification.permission === "default") {
      try {
        permissionRequest = window.Notification.requestPermission().catch((error) => {
          permissionFailure = error;
          return window.Notification.permission;
        });
      } catch (error) {
        permissionFailure = error;
      }
    }

    callAlertsEnabled = true;
    updateCallAlertControl("Enabling call alerts…");
    const [audioReady, permission] = await Promise.all([audioUnlock, permissionRequest]);
    callAudioReady = audioReady;
    if (permissionFailure) {
      console.error("Browser notification permission could not be requested.", permissionFailure);
      updateCallAlertControl(`Sound ${audioReady ? "enabled" : "unavailable"} · notification permission failed`);
    } else if (permission === "denied") {
      updateCallAlertControl(`Sound ${audioReady ? "enabled" : "unavailable"} · allow notifications in browser settings`);
    } else if (permission === "unsupported") {
      updateCallAlertControl(audioReady ? "Sound enabled · browser notifications unsupported" : "Browser notifications unsupported · audio unavailable");
    } else if (!audioReady) {
      updateCallAlertControl("Notifications enabled · audio unavailable");
    } else {
      updateCallAlertControl();
    }
  }

  function playPartyChime(party) {
    if (!callAudioContext || callAudioContext.state !== "running") {
      callAudioReady = false;
      updateCallAlertControl("Sound is locked · tap call alerts to unlock");
      return false;
    }
    const notes = party === "D"
      ? [523.25, 659.25, 783.99]
      : party === "R"
        ? [392, 493.88, 587.33]
        : [440, 554.37, 659.25];
    const start = Math.max(callAudioContext.currentTime + 0.025, nextCallChimeAt);
    try {
      for (const [index, frequency] of notes.entries()) {
        const oscillator = callAudioContext.createOscillator();
        const gain = callAudioContext.createGain();
        const noteStart = start + index * 0.11;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, noteStart);
        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.12, noteStart + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.22);
        oscillator.connect(gain);
        gain.connect(callAudioContext.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + 0.23);
      }
      nextCallChimeAt = start + 0.55;
    } catch (error) {
      callAudioReady = false;
      console.error("Election call chime could not be played.", error);
      updateCallAlertControl("Sound unavailable · browser notification still enabled");
      return false;
    }
    return true;
  }

  function projectionAlertKey(projection) {
    return JSON.stringify([
      projection.id,
      candidateKeyForProjection(projection.winner.candidate),
      projection.winner.partyCode || "",
    ]);
  }

  function notifyRaceCall(projection) {
    if (!callAlertsEnabled) return;
    const soundPlayed = playPartyChime(projection.winner.partyCode);
    const party = projection.winner.partyCode === "D"
      ? "Democratic"
      : projection.winner.partyCode === "R" ? "Republican" : "Independent/other";
    const stateName = STATES.find((state) => state.code === projection.state)?.name || projection.state;
    const raceName = projection.district
      ? `${projection.district} House`
      : `${stateName} ${projection.office || projection.race}`;
    const title = `${DEMO_MODE ? "DEMO · " : ""}${party} race call`;
    const body = `Dalton projects ${projection.winner.candidate} (${party}) as the winner in ${raceName}.`;

    const notificationsSupported = "Notification" in window;
    if (!notificationsSupported || window.Notification.permission !== "granted") {
      updateCallAlertControl(!notificationsSupported
        ? `Sound ${soundPlayed ? "played" : "locked"} · browser notifications unsupported`
        : window.Notification.permission === "denied"
          ? `Sound ${soundPlayed ? "played" : "locked"} · browser notifications blocked`
          : `Sound ${soundPlayed ? "played" : "locked"} · enable browser notifications`);
      return;
    }
    try {
      const notification = new window.Notification(title, {
        body,
        tag: `race-call-${encodeURIComponent(projectionAlertKey(projection))}`,
        renotify: false,
        silent: soundPlayed,
      });
      notification.addEventListener("click", () => {
        window.focus();
        notification.close();
      }, { once: true });
    } catch (error) {
      console.error("Election call notification could not be displayed.", error);
      updateCallAlertControl(`Sound ${soundPlayed ? "played" : "locked"} · browser notification failed`);
    }
  }

  function priorities() {
    return snapshot?.racePriorities || priorityConfig;
  }

  function results() {
    return snapshot?.results || [];
  }

  function stateResults(code) {
    return results().filter((result) => result.state === code);
  }

  function resultAreaKey(office, state, area) {
    return JSON.stringify([office, state, area]);
  }

  function normalizedResultValue(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }

  function trackNewResultAreas(nextSnapshot) {
    const nextFingerprints = new Map();
    for (const row of nextSnapshot.results || []) {
      if (!row || typeof row !== "object") continue;
      const office = raceType(row);
      const state = String(row.state || "").toUpperCase();
      if (!office || !state) continue;
      const rawCountyFips = row.countyFips == null ? "" : String(row.countyFips).trim();
      const countyFips = /^\d{1,5}$/.test(rawCountyFips) ? rawCountyFips.padStart(5, "0") : "";
      const countyName = normalizeCountyName(row.county || "");
      const county = countyFips ? `fips:${countyFips}` : countyName ? `name:${countyName}` : "";
      const district = houseDistrict(row);
      const area = county ? `county:${county}` : district ? `district:${district}` : "state";
      const candidate = candidateKey(row.candidate || row.candidateId || "");
      const resultValues = [
        row.votes,
        row.voteSharePct,
        row.votePct,
        row.precinctsReported,
        row.precinctsTotal,
        row.precinctsReportingPct,
        row.votesOutstanding,
        row.ballotsOutstanding,
        row.reportingPct,
      ].map(normalizedResultValue);
      if (resultValues.every((value) => value == null)) continue;
      const identity = JSON.stringify([
        office,
        state,
        String(row.race || ""),
        String(row.seatClass || row.class || ""),
        area,
        candidate,
        String(row.source || ""),
      ]);
      const fingerprint = JSON.stringify(resultValues);
      nextFingerprints.set(identity, { fingerprint, office, state, county, district });
    }

    if (resultBaselineEstablished) {
      for (const [identity, next] of nextFingerprints) {
        if (previousResultFingerprints.get(identity)?.fingerprint === next.fingerprint) continue;
        if (next.county) {
          unseenResultAreas.states.add(resultAreaKey(next.office, next.state, "state"));
          unseenResultAreas.counties.add(resultAreaKey(next.office, next.state, next.county));
          if (next.district) unseenResultAreas.districts.add(resultAreaKey(next.office, next.state, next.district));
        } else if (next.district) {
          unseenResultAreas.districts.add(resultAreaKey(next.office, next.state, next.district));
        } else {
          unseenResultAreas.states.add(resultAreaKey(next.office, next.state, "state"));
        }
      }
    }
    previousResultFingerprints = nextFingerprints;
    resultBaselineEstablished = true;
  }

  function acknowledgeResultArea(type, office, state, area) {
    unseenResultAreas[type].delete(resultAreaKey(office, state, area));
  }

  function selectedRace() {
    return elements["race-view"].value;
  }

  function raceWatchKey(row) {
    if (!row?.state) return null;
    const type = raceType(row);
    if (type === "House") {
      const district = houseDistrict(row);
      return district ? JSON.stringify(["House", district]) : null;
    }
    if (type === "Senate" || type === "Governor") return JSON.stringify([type, row.state]);
    const office = String(row.office || "").trim().toLowerCase();
    const race = String(row.race || "").trim().toLowerCase();
    return office || race ? JSON.stringify(["Other", row.state, office, race]) : null;
  }

  function raceWatchLabel(row) {
    const type = raceType(row);
    if (type === "House") return houseDistrict(row) || `${row.state} House`;
    if (type) return `${row.state} ${type}`;
    return [row.state, row.race || row.office || "race"].filter(Boolean).join(" ");
  }

  function updateWatchlistCount() {
    elements["watchlist-count"].textContent =
      `${formatNumber(watchedRaceKeys.size)} watched`;
  }

  function loadWatchedRaces() {
    try {
      const stored = window.localStorage.getItem("dalton-election-watched-races");
      if (stored == null) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed) || !parsed.every((key) => typeof key === "string" && key.length > 0)) {
        throw new Error("Saved race watchlist must be an array of non-empty race keys.");
      }
      watchedRaceKeys = new Set(parsed);
    } catch (error) {
      console.error("Watched races could not be loaded.", error);
    }
    updateWatchlistCount();
  }

  function persistWatchedRaces() {
    try {
      window.localStorage.setItem("dalton-election-watched-races", JSON.stringify([...watchedRaceKeys]));
    } catch (error) {
      console.error("Watched races could not be saved.", error);
    }
  }

  function createWatchButton(row, modifier = "") {
    const key = raceWatchKey(row);
    if (!key) return null;
    const watched = watchedRaceKeys.has(key);
    const label = raceWatchLabel(row);
    const button = make("button",
      ["watch-button", modifier, watched ? "is-watched" : ""].filter(Boolean).join(" "),
      watched ? "WATCHING" : "WATCH");
    button.type = "button";
    button.dataset.raceWatchKey = key;
    button.setAttribute("aria-pressed", String(watched));
    button.setAttribute("aria-label", `${watched ? "Stop watching" : "Watch"} ${label}`);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleWatchedRace(key);
    });
    return button;
  }

  function toggleWatchedRace(key) {
    const restoreFocus = document.activeElement?.classList.contains("watch-button");
    if (watchedRaceKeys.has(key)) watchedRaceKeys.delete(key);
    else watchedRaceKeys.add(key);
    persistWatchedRaces();
    updateWatchlistCount();
    renderResults();
    renderStateDetail();
    renderProjectionAnnouncements();
    if (restoreFocus) {
      const matchingButton = [...document.querySelectorAll(".watch-button")]
        .find((button) => button.dataset.raceWatchKey === key);
      (matchingButton || elements["watched-only-toggle"]).focus();
    }
  }

  function selectedRaceWatchRow() {
    if (!selectedState || historicalMode() || currentControlMode()) return null;
    if (selectedRace() === "House") {
      if (!selectedDistrict || !candidateRoster?.house?.[selectedDistrict]) return null;
      return { state: selectedState, office: "House", district: selectedDistrict, race: selectedDistrict };
    }
    if (selectedRace() === "Senate" && candidateRoster?.senate?.[selectedState]) {
      return { state: selectedState, office: "Senate", race: "Senate" };
    }
    if (selectedRace() === "Governor" && candidateRoster?.governor?.[selectedState]) {
      return { state: selectedState, office: "Governor", race: "Governor" };
    }
    return null;
  }

  function populateResultsStateFilter() {
    const filter = elements["results-state-filter"];
    for (const { code, name } of STATES) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = name;
      filter.append(option);
    }
  }

  function syncResultsStateFilter() {
    elements["results-state-filter"].value = selectedState || "all";
  }

  function currentControlMode() {
    return elements["map-mode"].value === "control";
  }

  function historicalMode() {
    return elements["map-mode"].value === "history";
  }

  function swingMode() {
    return elements["map-mode"].value === "swing";
  }

  function pickupsMode() {
    return elements["map-mode"].value === "pickups";
  }

  function historicalOfficeData() {
    if (!historicalResults) return {};
    return selectedRace() === "House" ? historicalResults.house
      : selectedRace() === "Senate" ? historicalResults.senate
        : historicalResults.governor;
  }

  function historicalRowsForRace(state, district = null) {
    const data = historicalOfficeData();
    const key = selectedRace() === "House" ? district : state;
    const entry = key ? data?.[key] : null;
    if (!entry) return [];
    return entry.candidates.map((candidate) => ({
      state,
      district: selectedRace() === "House" ? district : undefined,
      office: selectedRace(),
      race: `${entry.year} general · ${selectedRace()}${selectedRace() === "House" ? ` · ${district}` : ""}`,
      candidate: candidate.candidate,
      party: candidate.party,
      partyCode: candidate.partyCode,
      votes: candidate.votes,
      sourceUrl: entry.sourceUrl || historicalResults.metadata?.[`${selectedRace().toLowerCase()}Source`],
      historicalYear: entry.year,
      resultStage: entry.stage || candidate.stage || "general",
      historical: true,
    }));
  }

  function allHistoricalRows() {
    return Object.entries(historicalOfficeData()).flatMap(([key, entry]) =>
      (entry.candidates || []).map((candidate) => ({
        state: selectedRace() === "House" ? key.slice(0, 2) : key,
        district: selectedRace() === "House" ? key : undefined,
        office: selectedRace(),
        race: `${entry.year} general · ${selectedRace()}${selectedRace() === "House" ? ` · ${key}` : ""}`,
        candidate: candidate.candidate,
        party: candidate.party,
        partyCode: candidate.partyCode,
        votes: candidate.votes,
        sourceUrl: entry.sourceUrl || historicalResults.metadata?.[`${selectedRace().toLowerCase()}Source`],
        historicalYear: entry.year,
        resultStage: entry.stage || candidate.stage || "general",
        historical: true,
      })),
    );
  }

  function staticCandidatesForRace(state, district = null) {
    if (!candidateRoster) return [];
    if (selectedRace() === "House") return candidateRoster.house?.[district] || [];
    if (selectedRace() === "Senate") return candidateRoster.senate?.[state]?.candidates || [];
    return candidateRoster.governor?.[state] || [];
  }

  function candidateKey(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  async function loadCandidatePhotoIndex() {
    try {
      const response = await fetch("./candidate-photos/index.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`Candidate photo index request failed (HTTP ${response.status}).`);
      const index = await response.json();
      if (!index || index.schemaVersion !== 1 || !index.photos || typeof index.photos !== "object") {
        throw new Error("Candidate photo index is invalid.");
      }
      candidatePhotoIndex = index.photos;
      candidatePhotoError = null;
    } catch (error) {
      candidatePhotoIndex = {};
      candidatePhotoError = error.message || "Candidate photo index could not be loaded.";
      console.error(candidatePhotoError);
    }
    renderStateDetail();
    renderResults();
    projectionRenderSignature = "";
    renderProjectionAnnouncements();
  }

  function appendCandidatePhoto(parent, candidateName, size = "standard") {
    const photo = make("div", `candidate-photo${size === "compact" ? " candidate-photo-compact" : ""}`);
    const key = candidateKey(candidateName);
    const candidatePhoto = candidatePhotoIndex[key];
    const placeholder = make("span", "candidate-photo-placeholder", "No Image");
    placeholder.setAttribute("role", "img");
    placeholder.setAttribute("aria-label", `${candidateName}: No verified free-use photo is bundled.`);
    placeholder.title = candidatePhotoError || "No verified free-use photo is available in the local photo library.";
    if (!candidatePhoto) placeholder.classList.add("candidate-photo-unavailable");
    const image = document.createElement("img");
    image.className = "candidate-photo-image";
    image.alt = `${candidateName} portrait`;
    image.loading = "eager";
    image.hidden = true;
    if (candidatePhoto) {
      const photoUrl = /^\.\/candidate-photos\/[a-f0-9]{16}\.(jpg|png|webp)$/.test(candidatePhoto.path || "")
        ? candidatePhoto.path
        : null;
      const sourceUrl = safeUrl(candidatePhoto.sourceUrl);
      if (photoUrl && sourceUrl) {
        image.addEventListener("load", () => {
          placeholder.hidden = true;
          image.hidden = false;
        }, { once: true });
        image.addEventListener("error", () => {
          image.hidden = true;
          placeholder.hidden = false;
          placeholder.textContent = "No Image";
          placeholder.title = "The bundled candidate photo could not be loaded.";
          photo.classList.add("candidate-photo-unavailable");
        }, { once: true });
        image.src = photoUrl;
        image.title = `${candidatePhoto.artist} · ${candidatePhoto.license}`;
        const credit = make("a", "candidate-photo-credit", `${candidatePhoto.artist} · ${candidatePhoto.license}`);
        credit.href = sourceUrl;
        credit.target = "_blank";
        credit.rel = "noopener noreferrer";
        credit.title = `View ${candidatePhoto.fileName} on Wikimedia Commons`;
        photo.append(image, placeholder, credit);
        photo.classList.add("candidate-photo-available");
        parent.append(photo);
        return photo;
      }
    }
    photo.append(image, placeholder);
    parent.append(photo);
    return photo;
  }

  function candidatePartyClass(party, code = null) {
    const label = String(party || "").toLowerCase();
    if (code === "D" || label.includes("democrat") || label === "dfl") return "party-dem";
    if (code === "R" || label.includes("republican")) return "party-rep";
    if (label.includes("green")) return "party-green";
    if (label.includes("libertarian")) return "party-libertarian";
    if (label.includes("independent") || label.includes("no party") || label.includes("unaffiliated")) return "party-independent";
    return "party-other";
  }

  function appendCandidateName(parent, name, party, partyCode = null, className = "candidate-name") {
    const label = make("span", className);
    const dot = make("span", `party-dot ${candidatePartyClass(party, partyCode)}`);
    dot.setAttribute("aria-hidden", "true");
    dot.title = party || "Party not listed";
    label.append(dot, document.createTextNode(name || "Candidate not specified"));
    parent.append(label);
    return label;
  }

  function percentValue(row, peers) {
    const reported = Number(row?.candidatePct);
    if (row?.candidatePct != null && Number.isFinite(reported) && reported >= 0 && reported <= 100) return reported;
    if (row?.placeholder) return null;
    const total = peers.reduce((sum, candidate) => {
      const votes = Number(candidate.votes);
      return Number.isFinite(votes) && votes > 0 ? sum + votes : sum;
    }, 0);
    const votes = Number(row?.votes);
    return total > 0 && Number.isFinite(votes) && votes >= 0 ? votes / total * 100 : null;
  }

  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(1)}%` : "—";
  }

  function formatResultsPercent(value) {
    const number = Number(value);
    return value != null && value !== "" && Number.isFinite(number) ? `${number.toFixed(2)}%` : "—";
  }

  function percentCaption(row) {
    return row.historical || row.candidatePct != null ? "of vote" : "of reported votes";
  }

  function candidateRowsForArea(state, { district = null, countyFips = null, countyName = null } = {}) {
    const isCounty = countyFips != null;
    if (historicalMode()) return isCounty ? [] : historicalRowsForRace(state, district);
    const liveRows = isCounty
      ? countyResults(state, { id: countyFips, properties: { name: countyName } })
      : district
        ? houseDistrictResults(state, district)
        : stateContestRows(state);
    const used = new Set();
    const candidates = staticCandidatesForRace(state, district).map((candidate) => {
      const key = candidateKey(candidate.candidate);
      const matchIndex = liveRows.findIndex((row, index) =>
        !used.has(index) && candidateKey(row.candidate) === key);
      if (matchIndex >= 0) {
        used.add(matchIndex);
        return { ...liveRows[matchIndex], placeholder: false };
      }
      return {
        state,
        district: district || undefined,
        office: selectedRace(),
        race: `2026 general · ${selectedRace()}`,
        candidate: candidate.candidate,
        party: candidate.party,
        partyCode: candidate.partyCode,
        votes: 0,
        placeholder: true,
        sourceUrl: candidateRoster?.metadata?.[`${selectedRace().toLowerCase()}Source`],
      };
    });
    liveRows.forEach((row, index) => {
      if (!used.has(index)) candidates.push({ ...row, placeholder: false });
    });
    return candidates;
  }

  function controlPartyLabel(party) {
    if (party === "D") return "Democratic";
    if (party === "R") return "Republican";
    if (party === "O") return "Independent / other";
    return "Unknown or vacant";
  }

  function districtControl(district) {
    return currentControl?.house?.[district] || null;
  }

  function senatorsForState(state) {
    return currentControl?.senate?.[state] || [];
  }

  function governorForState(state) {
    return currentControl?.governor?.[state] || null;
  }

  function partyFill(party) {
    if (party === "D") return "#174b91";
    if (party === "R") return "#a52e40";
    if (party === "O") return "#a38c65";
    return "#222a38";
  }

  function raceType(row) {
    const office = String(row.office || "").toLowerCase();
    const race = String(row.race || "").toLowerCase();
    if (office.includes("governor") || office.includes("governorship") || race.includes("governor")) return "Governor";
    if (office.includes("senate") || race.includes("senate")) return "Senate";
    if (office.includes("house") || office.includes("congress") || office.includes("representative") || houseDistrict(row)) return "House";
    return null;
  }

  function raceResults(rows, race = selectedRace()) {
    return rows.filter((row) => raceType(row) === race);
  }

  function houseDistrict(row) {
    const candidates = [row.district, row.race, row.office].filter(Boolean).join(" ");
    const match = candidates.toUpperCase().match(/\b([A-Z]{2})\s*[- ]\s*(\d{1,2}|AL)\b/);
    if (match) return `${match[1]}-${match[2] === "AL" ? "AL" : match[2].padStart(2, "0")}`;
    const districtOnly = String(row.district || "").trim().toUpperCase().match(/^(AL|\d{1,2})$/);
    if (!districtOnly || !row.state) return null;
    return `${row.state}-${districtOnly[1] === "AL" ? "AL" : districtOnly[1].padStart(2, "0")}`;
  }

  function partyCode(value) {
    const party = String(value || "").trim().toLowerCase();
    if (["d", "dem", "dfl"].includes(party) || party.includes("democrat")) return "D";
    if (["r", "gop", "rep"].includes(party) || party.includes("republican")) return "R";
    if (party) return "O";
    return null;
  }

  function addSeatToTally(tally, party) {
    if (party === "D") tally.dem += 1;
    else if (party === "R") tally.rep += 1;
    else if (party === "O") tally.ind += 1;
    else tally.open += 1;
  }

  function projectedParty(projection) {
    return projection ? projection.winner.partyCode : null;
  }

  function majorityParty(tally, threshold) {
    if (tally.dem >= threshold) return "D";
    if (tally.rep >= threshold) return "R";
    return null;
  }

  function showNextMajorityAlert() {
    if (activeMajorityAlert || !pendingMajorityAlerts.length) return;
    activeMajorityAlert = pendingMajorityAlerts.shift();
    if (!majorityAlertReturnFocus) majorityAlertReturnFocus = document.activeElement;
    const overlay = elements["majority-alert-overlay"];
    overlay.classList.remove("majority-alert-dem", "majority-alert-rep");
    overlay.classList.add(`majority-alert-${activeMajorityAlert.party === "D" ? "dem" : "rep"}`);
    elements["majority-alert-title"].textContent = activeMajorityAlert.title;
    elements["majority-alert-details"].textContent = activeMajorityAlert.details;
    overlay.hidden = false;
    document.body.classList.add("majority-alert-open");
    elements["majority-alert-dismiss"].focus();
  }

  function dismissMajorityAlert() {
    if (!activeMajorityAlert) return;
    activeMajorityAlert = null;
    elements["majority-alert-overlay"].hidden = true;
    if (pendingMajorityAlerts.length) {
      showNextMajorityAlert();
      return;
    }
    elements["majority-alert-overlay"].classList.remove("majority-alert-dem", "majority-alert-rep");
    document.body.classList.remove("majority-alert-open");
    const returnFocus = majorityAlertReturnFocus;
    majorityAlertReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function resetMajorityAlerts() {
    announcedMajorityOffices.clear();
    pendingMajorityAlerts.length = 0;
    activeMajorityAlert = null;
    elements["majority-alert-overlay"].hidden = true;
    elements["majority-alert-overlay"].classList.remove("majority-alert-dem", "majority-alert-rep");
    document.body.classList.remove("majority-alert-open");
    const returnFocus = majorityAlertReturnFocus;
    majorityAlertReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  function queueMajorityAlerts(tallies, fixedTallies, incumbentTallies, totals) {
    const offices = ["house", "senate", "governor"];
    const names = { house: "House", senate: "Senate", governor: "governorships" };
    for (const office of offices) {
      const threshold = Math.floor(totals[office] / 2) + 1;
      const party = majorityParty(tallies[office], threshold);
      if (!party || announcedMajorityOffices.has(office)) continue;
      const partyKey = party === "D" ? "dem" : "rep";
      if (fixedTallies[office][partyKey] >= threshold || tallies[office][partyKey] <= fixedTallies[office][partyKey]) continue;
      announcedMajorityOffices.add(office);
      const holdsMajority = majorityParty(incumbentTallies[office], threshold) === party;
      const partyLabel = party === "D" ? "Democrats" : "Republicans";
      const partyName = partyLabel.toUpperCase();
      const outcome = office === "governor"
        ? holdsMajority ? "HOLD A MAJORITY OF GOVERNORSHIPS" : "WIN A MAJORITY OF GOVERNORSHIPS"
        : holdsMajority
          ? `HOLD THE ${names[office].toUpperCase()}`
          : `WIN THE ${names[office].toUpperCase()} MAJORITY`;
      const seatName = office === "governor" ? "governorships" : `${names[office]} seats`;
      pendingMajorityAlerts.push({
        office,
        party,
        title: `DALTON PROJECTS: ${partyName} ${outcome}`,
        details: `Race calls give ${partyLabel} ${tallies[office][partyKey]} of ${totals[office]} ${seatName}, securing a majority.`,
      });
    }
    showNextMajorityAlert();
  }

  function renderSeatTallies() {
    const totals = { house: 435, senate: 100, governor: 50 };
    if (!currentControl || !candidateRoster) {
      elements["seat-tally-note"].textContent = currentControlError || raceDataError
        ? `Seat tally unavailable: ${currentControlError || raceDataError}`
        : "Loading current officeholders and 2026 race roster…";
      for (const office of Object.keys(totals)) {
        for (const party of ["dem", "rep", "ind", "open"]) {
          elements[`seat-${office}-${party}`].textContent = "—";
        }
        for (const party of ["dem", "rep", "ind", "open"]) {
          elements[`seat-${office}-bar-${party}`].style.width = "0%";
        }
      }
      return;
    }

    const tallies = {
      house: { dem: 0, rep: 0, ind: 0, open: 0 },
      senate: { dem: 0, rep: 0, ind: 0, open: 0 },
      governor: { dem: 0, rep: 0, ind: 0, open: 0 },
    };
    const fixedTallies = {
      house: { dem: 0, rep: 0, ind: 0, open: 0 },
      senate: { dem: 0, rep: 0, ind: 0, open: 0 },
      governor: { dem: 0, rep: 0, ind: 0, open: 0 },
    };
    const incumbentTallies = {
      house: { dem: 0, rep: 0, ind: 0, open: 0 },
      senate: { dem: 0, rep: 0, ind: 0, open: 0 },
      governor: { dem: 0, rep: 0, ind: 0, open: 0 },
    };
    const houseProjections = daltonProjections("House");
    const senateProjections = daltonProjections("Senate");
    const governorProjections = daltonProjections("Governor");
    const findProjection = (projections, state, district = null, seatClass = null) =>
      projections.find((projection) => projection.state === state
        && (district == null || projection.district === district)
        && (seatClass == null || projection.seatClass == null || String(projection.seatClass) === String(seatClass)));

    for (const [district, member] of Object.entries(currentControl.house)) {
      addSeatToTally(incumbentTallies.house, member.party);
      if (candidateRoster.house[district]) {
        addSeatToTally(tallies.house, projectedParty(findProjection(houseProjections, district.slice(0, 2), district)));
        addSeatToTally(fixedTallies.house, null);
      } else {
        addSeatToTally(tallies.house, member.party);
        addSeatToTally(fixedTallies.house, member.party);
      }
    }
    for (const [state, senators] of Object.entries(currentControl.senate)) {
      const race = candidateRoster.senate[state];
      for (const senator of senators) {
        addSeatToTally(incumbentTallies.senate, senator.party);
        if (race && race.class === senator.class) {
          addSeatToTally(tallies.senate, projectedParty(findProjection(senateProjections, state, null, race.class)));
          addSeatToTally(fixedTallies.senate, null);
        } else {
          addSeatToTally(tallies.senate, senator.party);
          addSeatToTally(fixedTallies.senate, senator.party);
        }
      }
    }
    for (const [state, governor] of Object.entries(currentControl.governor)) {
      addSeatToTally(incumbentTallies.governor, governor.party);
      if (candidateRoster.governor[state]) {
        addSeatToTally(tallies.governor, projectedParty(findProjection(governorProjections, state)));
        addSeatToTally(fixedTallies.governor, null);
      } else {
        addSeatToTally(tallies.governor, governor.party);
        addSeatToTally(fixedTallies.governor, governor.party);
      }
    }

    const expectedTotals = { house: 435, senate: 100, governor: 50 };
    for (const [office, tally] of Object.entries(tallies)) {
      const total = Object.values(tally).reduce((sum, count) => sum + count, 0);
      if (total !== expectedTotals[office]) {
        elements["seat-tally-note"].textContent = `Seat tally unavailable: ${office} totals ${total}, expected ${expectedTotals[office]}.`;
        return;
      }
      for (const party of ["dem", "rep", "ind", "open"]) {
        elements[`seat-${office}-${party}`].textContent = formatNumber(tally[party]);
        elements[`seat-${office}-bar-${party}`].style.width = `${(tally[party] / total) * 100}%`;
      }
    }
    elements["seat-tally-note"].textContent = "Seats in 2026 races stay Up for Grabs until Dalton projects a winner. Independent and third-party wins are grouped as Ind.";
    queueMajorityAlerts(tallies, fixedTallies, incumbentTallies, totals);
  }

  function summarizeRace(rows) {
    const candidates = new Map();
    for (const row of rows) {
      if (row.votes == null || row.votes === "") continue;
      const votes = Number(row.votes);
      if (!Number.isFinite(votes) || votes < 0) continue;
      const party = partyCode(row.party);
      const key = `${String(row.candidate || "").trim().toLowerCase()}\u0000${party || "other"}`;
      const candidate = candidates.get(key);
      if (!candidate || votes > candidate.votes) candidates.set(key, { party, votes });
    }
    const ordered = [...candidates.values()].sort((a, b) => b.votes - a.votes);
    if (!ordered.length || ordered.every((candidate) => candidate.votes === 0)) return { status: "no-results", margin: 0 };
    if (ordered[0].votes === ordered[1]?.votes) return { status: "tie", margin: 0 };
    if (!ordered[0].party) return { status: "no-results", margin: 0 };
    const secondVotes = ordered[1]?.votes || 0;
    const denominator = ordered[0].votes + secondVotes;
    return {
      status: "leading",
      leader: ordered[0].party,
      margin: denominator ? (ordered[0].votes - secondVotes) / denominator : 0,
      marginPct: denominator ? Math.round(((ordered[0].votes - secondVotes) / denominator) * 100) : 0,
    };
  }

  function projectionIdentity(row, race = selectedRace()) {
    return JSON.stringify([
      row.state || "",
      row.office || "",
      race === "House" ? houseDistrict(row) || "" : "",
      String(row.race || row.office || "").trim().toLowerCase(),
      String(row.seatClass || row.class || "").trim(),
    ]);
  }

  function daltonProjections(race = selectedRace()) {
    if (!snapshot) return [];
    if (projectionCacheSnapshot !== snapshot) {
      projectionCacheSnapshot = snapshot;
      projectionCache = new Map();
    }
    if (projectionCache.has(race)) return projectionCache.get(race);
    const eligibleRows = raceResults(results(), race).filter((row) =>
      row.method === "documented-json-api"
      && row.feedFinal === true
      && row.feedStale === false
      && !row.county
      && !row.countyFips
      && (race !== "House" || houseDistrict(row)));
    const contests = new Map();
    for (const row of eligibleRows) {
      const key = projectionIdentity(row, race);
      if (!contests.has(key)) contests.set(key, []);
      contests.get(key).push(row);
    }
    const projections = [];
    for (const [id, rows] of contests) {
      if (rows.some((row) => !row.candidate || row.votes == null || row.votes === ""
        || !Number.isSafeInteger(Number(row.votes)) || Number(row.votes) < 0)) continue;
      const candidates = new Map();
      for (const row of rows) {
        const votes = Number(row.votes);
        if (!row.candidate || !Number.isSafeInteger(votes) || votes < 0) continue;
        const candidateKey = `${candidateKeyForProjection(row.candidate)}\u0000${partyCode(row.party) || "other"}`;
        const existing = candidates.get(candidateKey);
        if (!existing || votes > existing.votes) {
          candidates.set(candidateKey, {
            candidate: row.candidate,
            party: row.party || "",
            partyCode: partyCode(row.party),
            votes,
            candidatePct: row.candidatePct,
          });
        }
      }
      const ordered = [...candidates.values()].sort((a, b) => b.votes - a.votes);
      if (ordered.length < 2 || ordered[0].votes <= 0) continue;
      const demoCallRow = rows.find((row) => DEMO_MODE && row.demo === true
        && Number(row.demoCallProbability) >= (demoData?.callModel?.minimumWinProbability || 1)
        && typeof row.raceWinner === "string" && row.raceWinner.trim());
      let winner = ordered[0];
      if (demoCallRow) {
        const calledCandidateId = candidateKeyForProjection(demoCallRow.raceWinner);
        winner = ordered.find((candidate) => candidateKeyForProjection(candidate.candidate) === calledCandidateId);
        if (!winner) continue;
      } else if (ordered[0].votes <= ordered[1].votes) {
        continue;
      }
      const declaredWinners = rows.map((row) => row.raceWinner).filter((winner) => typeof winner === "string" && winner.trim());
      if (!demoCallRow && declaredWinners.length && declaredWinners.some((winner) => {
        const winnerParty = partyCode(winner);
        return candidateKeyForProjection(winner) !== candidateKeyForProjection(ordered[0].candidate)
          && (!["D", "R"].includes(winnerParty) || winnerParty !== ordered[0].partyCode);
      })) continue;
      const first = rows[0];
      projections.push({
        id,
        state: first.state,
        office: first.office,
        district: race === "House" ? houseDistrict(first) : null,
        seatClass: first.seatClass ?? first.class ?? null,
        race: first.race || first.office,
        winner,
        candidates: ordered,
        capturedAt: rows.reduce((latest, row) => row.capturedAt > latest ? row.capturedAt : latest, ""),
        sourceAsOf: rows.reduce((latest, row) => row.sourceAsOf > latest ? row.sourceAsOf : latest, ""),
        totalVotes: ordered.reduce((sum, candidate) => sum + candidate.votes, 0),
        demoCall: demoCallRow ? {
          probability: Number(demoCallRow.demoCallProbability),
          reportingPct: Number(demoCallRow.demoCallReportingPct),
          marginPct: Number(demoCallRow.demoCallMarginPct),
          calledAt: demoCallRow.demoCallAt,
          pollCloseAt: demoCallRow.demoPollCloseAt,
        } : null,
      });
    }
    projectionCache.set(race, projections);
    return projections;
  }

  function candidateKeyForProjection(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function projectionsForArea(state, district = null) {
    if (historicalMode() || currentControlMode()) return [];
    return daltonProjections().filter((projection) => projection.state === state && projection.district === district);
  }

  function locationLeader(rows) {
    const contests = new Map();
    for (const row of rows) {
      const key = String(row.race || row.office || selectedRace());
      if (!contests.has(key)) contests.set(key, []);
      contests.get(key).push(row);
    }
    const summaries = [...contests.values()].map(summarizeRace);
    if (!summaries.length) return { status: "no-results", margin: 0 };
    if (summaries.length === 1) return summaries[0];
    if (summaries.some((summary) => summary.status !== "leading")) return { status: "no-results", margin: 0 };
    const leaders = new Set(summaries.map((summary) => summary.leader));
    if (leaders.size !== 1) return { status: "no-results", margin: 0 };
    const margin = Math.min(...summaries.map((summary) => summary.margin));
    return { status: "leading", leader: summaries[0].leader, margin, marginPct: Math.round(margin * 100) };
  }

  function leadDescription(summary) {
    if (summary?.status === "tie") return "Tied";
    if (summary?.status === "no-results" || !summary) return "No results";
    if (summary.leader === "O") return "Independent or third-party candidate leading";
    const party = summary.leader === "D" ? "Democrat" : "Republican";
    return `${party} leading by ${summary.marginPct} points among the top two`;
  }

  function partyColor(leader, margin) {
    if (!leader) return "#222a38";
    const start = leader === "D" ? "#416db2" : leader === "R" ? "#b94a5c" : "#d5c4a0";
    const end = leader === "D" ? "#071e49" : leader === "R" ? "#701020" : "#a98d5f";
    const strength = Math.max(0, Math.min(1, margin * 4));
    const from = [1, 3, 5].map((index) => parseInt(start.slice(index, index + 2), 16));
    const to = [1, 3, 5].map((index) => parseInt(end.slice(index, index + 2), 16));
    return `#${from.map((channel, index) => Math.round(channel + (to[index] - channel) * strength).toString(16).padStart(2, "0")).join("")}`;
  }

  function applyLeaderColor(node, summary) {
    if (!summary || summary.status === "no-results") {
      node.classList.add("no-major-party-lead");
      return;
    }
    if (summary.status === "tie") {
      node.classList.add("tied-race");
      return;
    }
    if (summary.leader === "O") {
      node.classList.add("other-party-leading");
      node.style.fill = partyColor("O", summary.margin);
      return;
    }
    node.classList.add(summary.leader === "D" ? "dem-leading" : "rep-leading");
    node.style.fill = partyColor(summary.leader, summary.margin);
  }

  function incumbentPartyForRace(state, district, rows, race = selectedRace()) {
    if (race === "House") return districtControl(district)?.party || null;
    if (race === "Governor") return governorForState(state)?.party || null;
    if (race !== "Senate") return null;
    const classMatch = rows
      .map((row) => String(row.seatClass || row.class || row.race || "").match(/\bclass\s*([123])\b/i)?.[1])
      .find(Boolean);
    const senateClass = classMatch ? Number(classMatch) : candidateRoster?.senate?.[state]?.class || 2;
    return senatorsForState(state).find((senator) => senator.class === senateClass)?.party || null;
  }

  function projectionOutcomeTag(projection) {
    const incumbentCode = partyCode(incumbentPartyForRace(
      projection.state,
      projection.district,
      [projection],
      projection.office,
    ));
    const winnerCode = projection.winner.partyCode;
    if (![incumbentCode, winnerCode].every((code) => ["D", "R", "O"].includes(code))) return null;
    return incumbentCode === winnerCode ? "HOLD" : "PICKUP";
  }

  function holdPickupSummary(rows, state, district = null) {
    const contests = new Map();
    for (const row of rows) {
      const key = String(row.race || row.office || selectedRace());
      if (!contests.has(key)) contests.set(key, []);
      contests.get(key).push(row);
    }
    const outcomes = [...contests.values()].map((contestRows) => {
      const summary = summarizeRace(contestRows);
      if (summary.status !== "leading") return { status: summary.status, summary };
      if (summary.leader === "O") return { status: "other", summary };
      const incumbent = incumbentPartyForRace(state, district, contestRows);
      if (!["D", "R"].includes(incumbent)) return { status: "unavailable", summary };
      return { status: "leading", summary, pickup: incumbent !== summary.leader };
    });
    if (!outcomes.length || outcomes.some((outcome) => outcome.status !== "leading" && outcome.status !== "other")) {
      return { status: "no-results" };
    }
    if (outcomes.length > 1 && outcomes.some((outcome) =>
      outcome.status !== outcomes[0].status
      || outcome.summary.leader !== outcomes[0].summary.leader
      || outcome.pickup !== outcomes[0].pickup)) {
      return { status: "mixed" };
    }
    return outcomes[0];
  }

  function applyHoldPickupColor(node, outcome) {
    if (!outcome || outcome.status !== "leading") {
      node.classList.add(outcome?.status === "other" ? "other-party-leading" : "no-major-party-lead");
      if (outcome?.status === "other") node.style.fill = "#a38c65";
      return;
    }
    const party = outcome.summary.leader;
    node.classList.add(party === "D" ? (outcome.pickup ? "pickup-dem" : "hold-dem") : (outcome.pickup ? "pickup-rep" : "hold-rep"));
    node.style.fill = party === "D"
      ? outcome.pickup ? "#123d78" : "#5689c8"
      : outcome.pickup ? "#7f2432" : "#c96873";
  }

  function holdPickupDescription(outcome) {
    if (outcome?.status === "other") return "Independent or third-party candidate leading";
    if (outcome?.status !== "leading") return outcome?.status === "mixed"
      ? "Mixed seat outcomes; no single state shade"
      : "No comparable current lead or incumbent";
    const party = outcome.summary.leader === "D" ? "Democratic" : "Republican";
    return `${party} ${outcome.pickup ? "pickup lead" : "hold lead"} · not a race call`;
  }

  function isPartyFlip(summary, state, district, rows) {
    if (summary?.status !== "leading" || !["D", "R"].includes(summary.leader)) return false;
    const incumbentParty = incumbentPartyForRace(state, district, rows);
    return ["D", "R"].includes(incumbentParty) && incumbentParty !== summary.leader;
  }

  function applyControlColor(node, party) {
    node.classList.add(party === "D" ? "control-dem" : party === "R" ? "control-rep" : party === "O" ? "control-other" : "control-unknown");
    node.style.fill = partyFill(party);
  }

  function addSenateSplitFill(code, senators) {
    const defs = svgElement("defs");
    const gradient = svgElement("linearGradient");
    const id = `senate-control-${code}`;
    gradient.setAttribute("id", id);
    gradient.setAttribute("x1", "0%");
    gradient.setAttribute("x2", "100%");
    gradient.setAttribute("y1", "0%");
    gradient.setAttribute("y2", "0%");
    const firstParty = senators[0]?.party;
    const secondParty = senators[1]?.party;
    for (const [offset, party] of [["0%", firstParty], ["49.9%", firstParty], ["50.1%", secondParty], ["100%", secondParty]]) {
      const stop = svgElement("stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", partyFill(party));
      gradient.append(stop);
    }
    defs.append(gradient);
    mapLayer.append(defs);
    return `url(#${id})`;
  }

  function appendLegendItem(parent, className, label) {
    const item = make("span");
    item.append(make("i", `legend-swatch ${className}`), document.createTextNode(label));
    parent.append(item);
  }

  function renderMapLegend() {
    const legend = elements["map-legend"];
    legend.replaceChildren();
    if (pickupsMode()) {
      appendLegendItem(legend, "hold-dem", "Democratic hold lead");
      appendLegendItem(legend, "pickup-dem", "Democratic pickup lead");
      appendLegendItem(legend, "hold-rep", "Republican hold lead");
      appendLegendItem(legend, "pickup-rep", "Republican pickup lead");
      appendLegendItem(legend, "no-results", "No reported lead / unavailable");
      appendLegendItem(legend, "new-result", "New results · click to acknowledge");
      return;
    }
    if (swingMode()) {
      appendLegendItem(legend, "swing-gradient", "R overperformance ← neutral → D overperformance");
      appendLegendItem(legend, "no-results", "Unavailable · no comparable results");
      appendLegendItem(legend, "new-result", "New results · click to acknowledge");
      return;
    }
    if (currentControlMode()) {
      appendLegendItem(legend, "control-dem", "Democratic officeholder");
      appendLegendItem(legend, "control-rep", "Republican officeholder");
      appendLegendItem(legend, "control-other", "Independent / other");
      appendLegendItem(legend, "no-results", selectedRace() === "Senate" ? "Vacant / unavailable senator" : "Vacant / unavailable");
      if (selectedRace() === "Senate") appendLegendItem(legend, "senate-split", "Left: first listed · Right: second listed");
      return;
    }
    appendLegendItem(legend, "dem-leading", "Democrat leading");
    appendLegendItem(legend, "rep-leading", "Republican leading");
    appendLegendItem(legend, "other-party-leading", "Independent / third party leading");
    appendLegendItem(legend, "tied-race", "Tied");
    appendLegendItem(legend, "no-results", "No results / unknown party");
    if (!historicalMode()) {
      if (!DEMO_MODE && selectedRace() !== "House") {
        appendLegendItem(legend, "state-race-active", "Active race · source reachable");
        appendLegendItem(legend, "state-no-active-race", `No active 2026 ${selectedRace()} race`);
        appendLegendItem(legend, "state-race-unavailable", "Active race · source unavailable");
      }
      appendLegendItem(legend, "party-flip", "Opposite party leading vs. current officeholder");
      appendLegendItem(legend, "new-result", "New results · click to acknowledge");
    }
  }

  function renderMapAttribution() {
    const attribution = elements["priority-attribution"];
    attribution.replaceChildren();
    if (pickupsMode()) {
      attribution.append(document.createTextNode(
        "Hold/pickup shading compares the reported leading party with the current incumbent party for that office or district. Lighter shades are holds; darker shades are pickup leads. Unreported contests stay grey, and a lead is not a Dalton projection or certified result.",
      ));
      return;
    }
    if (swingMode()) {
      const metadata = historicalResults?.metadata || {};
      attribution.append(document.createTextNode(
        `Swing is the current minus prior two-party margin ((D − R) ÷ (D + R)), in percentage points; aggregate values are weighted by comparable two-party votes. Only matching office/state or district pairs with reported D/R votes are included. County swing requires same-office historical county returns; none are bundled, so counties remain unavailable until those data exist. `,
      ));
      appendExternalLink(attribution, "Historical results ↗", metadata.houseSource || metadata.senateSource || metadata.governorSource);
      return;
    }
    if (currentControlMode()) {
      const metadata = currentControl?.metadata;
      attribution.append(document.createTextNode(
        currentControlError
          ? `Current-control roster unavailable: ${currentControlError}`
          : `Static officeholder party baseline as of ${metadata?.asOf || "date unavailable"}. In Senate view, senators are listed by class, lowest first. `,
      ));
      if (metadata && !currentControlError) {
        appendExternalLink(attribution, "House / Senate roster ↗", metadata.houseSource);
        appendExternalLink(attribution, "CC0 ↗", metadata.houseSenateLicense);
        appendExternalLink(attribution, "Governor roster ↗", metadata.governorSource);
      }
      return;
    }
    if (historicalMode()) {
      const metadata = historicalResults?.metadata || {};
      attribution.append(document.createTextNode(
        `${historicalResultsError ? `Historical results unavailable: ${historicalResultsError}. ` : ""}Past view uses each contest's latest completed election, including runoffs. House districts may have changed boundaries since 2024; historical county subtotals are unavailable. `,
      ));
      appendExternalLink(attribution, "House results ↗", metadata.houseSource);
      appendExternalLink(attribution, "Senate results dataset ↗", metadata.senateSource);
      appendExternalLink(attribution, "Governor results ↗", metadata.governorSource);
      appendExternalLink(attribution, "Wikipedia CC BY-SA 4.0 ↗", "https://creativecommons.org/licenses/by-sa/4.0/");
      return;
    }
    const source = priorities();
    const ratingCount = Object.values(source.house_races || {}).reduce((count, districts) => count + districts.length, 0);
    attribution.append(document.createTextNode(
      `Shading tracks the leading major-party candidate; deeper color means a larger reported margin. Priority states include 2026 Senate/Governor contests; the ${ratingCount} House districts follow Cook Political Report (${source.rating_as_of || "date unavailable"}). `,
    ));
    appendExternalLink(attribution, "Cook ratings ↗", source.rating_source);
    const metadata = candidateRoster?.metadata;
    if (metadata) {
      attribution.append(document.createTextNode(` Candidate names reflect the cited roster as of ${candidateRoster.asOf || "date unavailable"}; totals are from the live collector. `));
      appendExternalLink(attribution, "House candidates ↗", metadata.houseSource);
      appendExternalLink(attribution, "Senate candidates ↗", metadata.senateSource);
      appendExternalLink(attribution, "Governor candidates ↗", metadata.governorSource);
      appendExternalLink(attribution, "CC BY-SA 4.0 ↗", metadata.sourceLicense);
    }
  }

  function stateContestRows(code) {
    if (historicalMode()) return historicalRowsForRace(code);
    return raceResults(stateResults(code)).filter((row) => !row.county && !row.countyFips && !houseDistrict(row));
  }

  function countyResults(code, countyFeature) {
    const countyFips = String(countyFeature.id).padStart(5, "0");
    const countyName = normalizeCountyName(countyFeature.properties?.name || "");
    return raceResults(stateResults(code)).filter((result) => {
      if (result.countyFips) return String(result.countyFips).padStart(5, "0") === countyFips;
      return result.county && normalizeCountyName(result.county) === countyName;
    });
  }

  function swingHistoryEntry(state, district = null, countyFips = null) {
    if (!historicalResults) return null;
    if (countyFips) {
      const counties = historicalResults.counties?.[selectedRace().toLowerCase()];
      return counties?.[state]?.[countyFips] || counties?.[`${state}-${countyFips}`] || null;
    }
    const data = historicalOfficeData();
    return data?.[selectedRace() === "House" ? district : state] || null;
  }

  function twoPartyVotes(rows) {
    const candidates = new Map();
    for (const row of rows) {
      const party = row.partyCode || partyCode(row.party);
      if (party !== "D" && party !== "R") continue;
      const votes = Number(row.votes);
      if (!Number.isFinite(votes) || votes < 0) continue;
      const name = candidateKey(row.candidate);
      if (!name) continue;
      const key = `${party}:${name}`;
      candidates.set(key, Math.max(candidates.get(key) || 0, votes));
    }
    const totals = { D: 0, R: 0 };
    for (const [key, votes] of candidates) totals[key[0]] += votes;
    return totals;
  }

  function compareSwing(currentRows, historicalEntry) {
    if (!historicalEntry || !Array.isArray(historicalEntry.candidates)) return null;
    const current = twoPartyVotes(currentRows);
    const previous = twoPartyVotes(historicalEntry.candidates);
    const currentTotal = current.D + current.R;
    const previousTotal = previous.D + previous.R;
    if (currentTotal <= 0 || previousTotal <= 0) return null;
    const currentMargin = ((current.D - current.R) / currentTotal) * 100;
    const previousMargin = ((previous.D - previous.R) / previousTotal) * 100;
    return {
      swing: currentMargin - previousMargin,
      current,
      previous,
      year: historicalEntry.year || null,
    };
  }

  function combineSwingComparisons(comparisons) {
    const valid = comparisons.filter(Boolean);
    if (!valid.length) return null;
    const current = valid.reduce((totals, item) => ({
      D: totals.D + item.current.D,
      R: totals.R + item.current.R,
    }), { D: 0, R: 0 });
    const previous = valid.reduce((totals, item) => ({
      D: totals.D + item.previous.D,
      R: totals.R + item.previous.R,
    }), { D: 0, R: 0 });
    const currentTotal = current.D + current.R;
    const previousTotal = previous.D + previous.R;
    if (currentTotal <= 0 || previousTotal <= 0) return null;
    const currentMargin = ((current.D - current.R) / currentTotal) * 100;
    const previousMargin = ((previous.D - previous.R) / previousTotal) * 100;
    return {
      swing: currentMargin - previousMargin,
      units: valid.length,
      years: [...new Set(valid.map((item) => item.year).filter(Boolean))].sort(),
    };
  }

  function countyFipsForRow(row) {
    if (row.countyFips) return String(row.countyFips).padStart(5, "0");
    if (!row.county || !geography?.counties) return null;
    const match = geography.counties.find((feature) =>
      String(feature.id).padStart(5, "0").startsWith(STATE_FIPS[row.state]) &&
      normalizeCountyName(feature.properties?.name || "") === normalizeCountyName(row.county));
    return match ? String(match.id).padStart(5, "0") : null;
  }

  function swingForRows(rows, state = null, district = null, countyFips = null) {
    return compareSwing(rows, swingHistoryEntry(state, district, countyFips));
  }

  function aggregateSwing(rows, scopeState = null, countyLevel = false) {
    const units = new Map();
    for (const row of rows) {
      const key = countyLevel
        ? countyFipsForRow(row)
        : selectedRace() === "House" ? houseDistrict(row) : row.state;
      if (!key || (scopeState && row.state !== scopeState)) continue;
      if (!units.has(key)) units.set(key, []);
      units.get(key).push(row);
    }
    const comparisons = [];
    for (const [key, unitRows] of units) {
      const state = countyLevel ? scopeState || unitRows[0].state
        : selectedRace() === "House" ? key.slice(0, 2) : key;
      const district = !countyLevel && selectedRace() === "House" ? key : null;
      comparisons.push(swingForRows(unitRows, state, district, countyLevel ? key : null));
    }
    return combineSwingComparisons(comparisons);
  }

  function swingDescription(comparison) {
    if (!comparison) return "Unavailable — no comparable two-party results";
    const party = comparison.swing >= 0 ? "D" : "R";
    return `${party} +${Math.abs(comparison.swing).toFixed(1)} pp`;
  }

  function swingColor(swing) {
    if (!Number.isFinite(swing)) return "#222a38";
    const neutral = [87, 97, 111];
    const endpoint = swing > 0 ? [23, 75, 145] : [165, 46, 64];
    const strength = Math.min(1, Math.abs(swing) / 15);
    return `#${neutral.map((channel, index) =>
      Math.round(channel + (endpoint[index] - channel) * strength).toString(16).padStart(2, "0")).join("")}`;
  }

  function applySwingColor(node, comparison) {
    if (!comparison) {
      node.classList.add("swing-unavailable");
      return;
    }
    node.classList.add(comparison.swing > 0 ? "swing-dem" : comparison.swing < 0 ? "swing-rep" : "swing-even");
    node.style.fill = swingColor(comparison.swing);
  }

  function renderSwingMetric(id, label, comparison, unavailableMessage) {
    const card = elements[id];
    const [heading, value, note] = card.querySelectorAll("span, strong, small");
    heading.textContent = label;
    value.textContent = comparison ? swingDescription(comparison) : "Unavailable";
    card.classList.toggle("swing-positive", Boolean(comparison && comparison.swing > 0));
    card.classList.toggle("swing-negative", Boolean(comparison && comparison.swing < 0));
    card.classList.toggle("swing-neutral", Boolean(comparison && comparison.swing === 0));
    note.textContent = comparison
      ? `${comparison.units} comparable ${comparison.units === 1 ? "contest" : "contests"} · prior ${comparison.years.join(", ") || "year unavailable"}`
      : unavailableMessage;
    const marker = card.querySelector(".swing-track i");
    marker.style.left = comparison
      ? `${50 + Math.max(-50, Math.min(50, comparison.swing / 15 * 50))}%`
      : "50%";
    marker.classList.toggle("is-unavailable", !comparison);
    card.setAttribute("aria-label", `${label}: ${value.textContent}. ${note.textContent}`);
  }

  function renderSwingSummary() {
    const section = elements["swing-summary"];
    section.hidden = !swingMode();
    if (!swingMode()) return;
    const statewideRows = results().filter((row) => raceResults([row]).length && !row.county && !row.countyFips);
    const national = aggregateSwing(statewideRows);
    renderSwingMetric("swing-national", "National", national,
      "No comparable reported races yet");
    const stateRows = selectedState
      ? raceResults(stateResults(selectedState)).filter((row) => !row.county && !row.countyFips)
      : [];
    const stateSwing = selectedState ? aggregateSwing(stateRows, selectedState) : null;
    renderSwingMetric("swing-state", selectedState ? `${selectedState} · State` : "State", stateSwing,
      selectedState ? "No comparable reported contest in this state" : "Click a state on the map");
    if (!selectedState) {
      renderSwingMetric("swing-county", "County", null, "Choose a state; county history is required");
      return;
    }
    if (selectedCounty?.fips) {
      const feature = geography.counties.find((item) => String(item.id).padStart(5, "0") === selectedCounty.fips);
      const rows = feature ? countyResults(selectedState, feature) : [];
      const countyName = feature?.properties?.name || selectedCounty.name || selectedCounty.fips;
      renderSwingMetric("swing-county", `${countyName} · County`,
        combineSwingComparisons([swingForRows(rows, selectedState, null, selectedCounty.fips)]),
        "Unavailable — no prior same-office county returns");
      return;
    }
    const countyRows = raceResults(stateResults(selectedState)).filter((row) => row.county || row.countyFips);
    const countySwing = aggregateSwing(countyRows, selectedState, true);
    renderSwingMetric("swing-county", `${selectedState} · Counties`, countySwing,
      "Unavailable — no prior same-office county returns");
  }

  function houseDistrictResults(code, district) {
    return raceResults(stateResults(code)).filter((row) =>
      houseDistrict(row) === district && !row.county && !row.countyFips);
  }

  function normalizeCountyName(name) {
    return String(name).toLowerCase()
      .replace(/\b(county|parish|borough|municipality|census area)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function statewidePriorityOffices(code) {
    const offices = priorities().statewide_offices || {};
    return Object.entries(offices)
      .filter(([, states]) => Array.isArray(states) && states.includes(code))
      .map(([office]) => office);
  }

  function housePriorityRaces(code) {
    const races = priorities().house_races || {};
    return Object.entries(races).flatMap(([rating, districts]) =>
      (Array.isArray(districts) ? districts : [])
        .filter((district) => district.startsWith(`${code}-`))
        .map((district) => ({ rating, district })));
  }

  function stateRaceStatus(code) {
    const race = selectedRace();
    if (DEMO_MODE || currentControlMode() || historicalMode() || swingMode() || pickupsMode()
      || !candidateRoster || !["Senate", "Governor"].includes(race)) return null;
    const hasRace = race === "Senate"
      ? Boolean(candidateRoster.senate?.[code])
      : Boolean(candidateRoster.governor?.[code]);
    if (!hasRace) return { kind: "no-race", label: `No active 2026 ${race} race` };

    const resultsForRace = raceResults(stateResults(code), race);
    const sources = snapshot?.sources || [];
    const stateSources = sources.filter((source) => source.state === code);
    const sourceFailed = (source) => source.status === "error" || source.error != null;
    if (stateSources.some((source) => !sourceFailed(source))) {
      return { kind: "active", label: `${race} race active · results source reachable` };
    }
    const openAmericaStatus = sources.find((source) => source.source === "Open America" && source.office === race);
    const hasOpenAmericaResults = resultsForRace.some((row) => row.source === "Open America");
    if (hasOpenAmericaResults && openAmericaStatus && !sourceFailed(openAmericaStatus)) {
      return { kind: "active", label: `${race} race active · results available` };
    }
    if (!snapshot || !stateSources.length || stateSources.every(sourceFailed)) {
      return { kind: "unavailable", label: `${race} race active · results source unavailable` };
    }
    return { kind: "active", label: `${race} race active · results source reachable` };
  }

  function visibleStates() {
    const filter = elements["state-filter"].value;
    return STATES.filter((state) => {
      if (filter === "priority") return selectedRace() === "House" ? housePriorityRaces(state.code).length > 0 : statewidePriorityOffices(state.code).includes(selectedRace());
      if (filter === "reporting") return historicalMode()
        ? selectedRace() === "House"
          ? Object.keys(historicalResults?.house || {}).some((district) => district.startsWith(`${state.code}-`))
          : historicalRowsForRace(state.code).length > 0
        : raceResults(stateResults(state.code)).length > 0;
      return true;
    });
  }

  function appendSvgTitle(node, text) {
    const title = svgElement("title");
    title.textContent = text;
    node.append(title);
  }

  function tooltipLocation(context) {
    if (context.district) return context.district;
    if (context.countyName) return `${context.countyName}, ${context.stateName}`;
    return context.stateName;
  }

  function positionMapTooltip(event, node) {
    const tooltip = elements["map-tooltip"];
    const bounds = node.getBoundingClientRect();
    const left = event?.clientX ?? bounds.left + bounds.width / 2;
    const top = event?.clientY ?? bounds.top + Math.min(bounds.height / 2, 40);
    const margin = 12;
    const tooltipBounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(margin, Math.min(window.innerWidth - tooltipBounds.width - margin, left + 14))}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(window.innerHeight - tooltipBounds.height - margin, top + 14))}px`;
  }

  function showMapTooltip(context, event, node) {
    const tooltip = elements["map-tooltip"];
    const rows = candidateRowsForArea(context.state, context);
    tooltip.replaceChildren();
    tooltip.append(make("strong", "tooltip-title", `${tooltipLocation(context)} · ${historicalMode() ? "Past results" : "2026 candidates"}`));
    if (raceDataError && !historicalMode()) {
      tooltip.append(make("p", "tooltip-empty", `Candidate roster unavailable: ${raceDataError}`));
    } else if (!rows.length) {
      const noHistory = historicalMode() && selectedRace() === "House" && historicalResults?.metadata?.houseNoPriorContest?.includes(context.district);
      tooltip.append(make("p", "tooltip-empty", historicalResultsError
        ? `Historical results unavailable: ${historicalResultsError}`
        : noHistory
        ? "No same-district prior result is available after redistricting."
        : historicalMode() ? "No prior contest result is available for this location." : "No listed candidates are available."));
    } else {
      const list = make("div", "tooltip-candidates");
      for (const row of rows) {
        const item = make("div", "tooltip-candidate");
        appendCandidatePhoto(item, row.candidate, "compact");
        appendCandidateName(item, row.candidate, row.party, row.partyCode, "tooltip-candidate-name");
        const voteBlock = make("span", "tooltip-vote-block");
        voteBlock.append(make("strong", "", `${formatNumber(row.votes)}${row.placeholder ? " · awaiting" : " votes"}`));
        const share = percentValue(row, rows);
        voteBlock.append(make("span", "tooltip-share", share == null ? "Share —" : `${formatPercent(share)} ${percentCaption(row)}`));
        item.append(voteBlock);
        item.append(make("span", "tooltip-party", row.party || "Party not listed"));
        if (row.historical) item.append(make("span", "tooltip-party", `${row.historicalYear} ${row.resultStage} total`));
        list.append(item);
      }
      tooltip.append(list);
    }
    tooltip.hidden = false;
    positionMapTooltip(event, node);
  }

  function hideMapTooltip() {
    elements["map-tooltip"].hidden = true;
  }

  function bindMapActivation(node, label, action, tooltipContext = null) {
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", label);
    node.addEventListener("click", action);
    if (tooltipContext && !currentControlMode()) {
      node.setAttribute("aria-describedby", "map-tooltip");
      node.addEventListener("pointerenter", (event) => showMapTooltip(tooltipContext, event, node));
      node.addEventListener("pointermove", (event) => positionMapTooltip(event, node));
      node.addEventListener("pointerleave", hideMapTooltip);
      node.addEventListener("focus", () => showMapTooltip(tooltipContext, null, node));
      node.addEventListener("blur", hideMapTooltip);
    }
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action();
      }
    });
  }

  function addStateLabel(svg, feature, state, raceStatus = null) {
    const [centroidX, centroidY] = geography.path.centroid(feature);
    const labelOffsets = {
      FL: [28, 27],
      HI: [-55, 18],
      LA: [-10, -11],
      MI: [18, 34],
    };
    const [offsetX, offsetY] = labelOffsets[state.code] || [0, 0];
    const x = centroidX + offsetX;
    const y = centroidY + offsetY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const label = svgElement("text", "map-state-label");
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(y));
    label.textContent = state.code;
    mapLayer.append(label);
    if (!raceStatus) return;

    const markerX = x + 8;
    const markerY = y - 7;
    const marker = raceStatus.kind === "active"
      ? svgElement("circle", "state-race-marker state-race-active")
      : svgElement("rect", `state-race-marker ${raceStatus.kind === "unavailable" ? "state-race-unavailable" : "state-no-active-race"}`);
    marker.setAttribute("data-state", state.code);
    marker.setAttribute("data-status", raceStatus.kind);
    marker.setAttribute("aria-hidden", "true");
    if (raceStatus.kind === "active") {
      marker.setAttribute("cx", String(markerX));
      marker.setAttribute("cy", String(markerY));
      marker.setAttribute("r", "2.7");
    } else {
      marker.setAttribute("x", String(markerX - 2.7));
      marker.setAttribute("y", String(markerY - 2.7));
      marker.setAttribute("width", "5.4");
      marker.setAttribute("height", "5.4");
      if (raceStatus.kind === "unavailable") marker.setAttribute("transform", `rotate(45 ${markerX} ${markerY})`);
    }
    mapLayer.append(marker);
  }

  function renderNationalMap() {
    const svg = elements["election-map"];
    svg.setAttribute("viewBox", "0 0 975 610");
    const raceName = selectedRace();
    const controlMode = currentControlMode();
    svg.setAttribute("aria-label", controlMode
      ? `United States current ${raceName.toLowerCase()} officeholder party map. Select a state to inspect current officeholders.`
      : `United States ${raceName.toLowerCase()} race results map. Select a state to view its counties.`);
    if (controlMode && !currentControl) {
      elements["map-title"].textContent = `United States · ${raceName} Control`;
      elements["map-hint"].textContent = currentControlError
        ? `Current-control roster unavailable: ${currentControlError}`
        : "Loading current officeholder party roster…";
      return;
    }
    for (const feature of geography.states) {
      const fips = String(feature.id).padStart(2, "0");
      const state = STATES.find((entry) => entry.code === STATE_BY_FIPS[fips]);
      if (!state || !visibleStates().some((entry) => entry.code === state.code)) continue;
      const rows = stateContestRows(state.code);
      const summary = locationLeader(rows);
      const swing = swingMode() ? swingForRows(rows, state.code) : null;
      const holdPickup = pickupsMode() ? holdPickupSummary(rows, state.code) : null;
      const senators = senatorsForState(state.code);
      const officeholder = raceName === "Governor" ? governorForState(state.code) : null;
      const raceStatus = !controlMode && !historicalMode() && !swingMode() && !pickupsMode()
        ? stateRaceStatus(state.code)
        : null;
      const flipped = !controlMode && !historicalMode() && !swingMode() && !pickupsMode() && isPartyFlip(summary, state.code, null, rows);
      const projections = swingMode() || pickupsMode() ? [] : projectionsForArea(state.code);
      const selected = selectedState === state.code;
      const classes = ["map-shape", "state-shape"];
      if (flipped) classes.push("party-flip");
      if (!controlMode && !historicalMode()
        && unseenResultAreas.states.has(resultAreaKey(raceName, state.code, "state"))) classes.push("new-result");
      if (selected) classes.push("selected");
      if (controlMode && raceName === "Senate") classes.push("senate-split");
      const path = svgElement("path", classes.join(" "));
      path.setAttribute("d", geography.path(feature) || "");
      let label;
      if (controlMode && raceName === "Senate") {
        path.style.fill = addSenateSplitFill(state.code, senators);
        label = senators.length
          ? `${state.name}, ${senators.map((senator) => `${senator.name}, ${controlPartyLabel(senator.party)}, Class ${senator.class}`).join("; ")}`
          : `${state.name}, no current senators listed`;
      } else if (controlMode) {
        applyControlColor(path, officeholder?.party || null);
        label = officeholder
          ? `${state.name}, ${officeholder.name}, ${controlPartyLabel(officeholder.party)}`
          : `${state.name}, no current governor listed`;
      } else {
        if (swingMode()) {
          applySwingColor(path, swing);
          label = `${state.name}, ${swingDescription(swing)}${swing?.year ? ` versus ${swing.year}` : ""}`;
        } else if (pickupsMode()) {
          applyHoldPickupColor(path, holdPickup);
          label = `${state.name}, ${holdPickupDescription(holdPickup)}`;
        } else {
          applyLeaderColor(path, summary);
          label = `${state.name}, ${leadDescription(summary)}${flipped ? ", opposite party leading versus the current officeholder" : ""}`;
          if (projections.length) label += `, Dalton projects ${projections.map((projection) => projection.winner.candidate).join(" and ")} to win`;
        }
      }
      if (raceStatus) label += `, ${raceStatus.label}`;
      if (classes.includes("new-result")) label += ", new results since the last update; click to acknowledge";
      bindMapActivation(path, label, () => selectState(state.code), { state: state.code, stateName: state.name });
      appendSvgTitle(path, label);
      mapLayer.append(path);
      addStateLabel(svg, feature, state, raceStatus);
    }
    elements["map-title"].textContent = controlMode ? `United States · ${raceName} Control`
      : swingMode() ? `United States · ${raceName} Swing`
        : pickupsMode() ? `United States · ${raceName} Holds & Pickups` : "United States";
    elements["map-hint"].textContent = controlMode
      ? raceName === "Senate"
        ? "Current senators by party. Each state is split into its two seats, listed in ascending Senate-class order. Select a state to see senators' names."
        : "Current governors by party. Select a state to see the officeholder's name."
      : swingMode()
        ? `Showing ${raceName} overperformance against the prior comparable election. Positive values mean a shift toward Democrats; click a state for county results and county-history availability.`
        : pickupsMode()
          ? `Lighter blue/red indicates a current Democratic/Republican hold lead; darker shades indicate a pickup lead versus the incumbent party. These are reported leads, not calls.`
        : selectedRace() !== "House" && !historicalMode()
          ? `Showing ${raceName} race leaders by state. State markers indicate whether the 2026 race is active and whether its results source is reachable; color intensity reflects the D/R vote margin.`
        : historicalMode()
        ? historicalResultsError
          ? `Historical results unavailable: ${historicalResultsError}`
          : `Showing the most recent completed ${raceName} results by state. Select a state to inspect candidate totals and the election year.`
        : `Showing ${raceName} race leaders by state. Select a state to see county-level results when available. Color intensity reflects the D/R vote margin.`;
  }

  function renderHouseMap() {
    const svg = elements["election-map"];
    svg.setAttribute("viewBox", "0 0 975 610");
    const controlMode = currentControlMode();
    svg.setAttribute("aria-label", controlMode
      ? "United States House district current officeholder party map. Select a district to inspect its current representative."
      : pickupsMode()
        ? "United States congressional district map showing reported hold leads in lighter colors and pickup leads in darker colors compared with current representatives."
        : swingMode()
        ? "United States congressional district overperformance map. Blue indicates Democratic overperformance and red indicates Republican overperformance compared with the prior election."
        : "United States congressional district results map. Select a district to inspect candidates.");
    if (controlMode && !currentControl) {
      elements["map-title"].textContent = "U.S. House · District Control";
      elements["map-hint"].textContent = currentControlError
        ? `Current-control roster unavailable: ${currentControlError}`
        : "Loading current officeholder party roster…";
      return;
    }
    const districts = geography.districts.filter((feature) => {
      const code = STATE_BY_FIPS[String(feature.properties.stateFips).padStart(2, "0")];
      return code && visibleStates().some((state) => state.code === code);
    });
    for (const feature of districts) {
      const code = STATE_BY_FIPS[String(feature.properties.stateFips).padStart(2, "0")];
      const district = `${code}-${feature.properties.district === "00" ? "AL" : String(Number(feature.properties.district)).padStart(2, "0")}`;
      const rows = historicalMode()
        ? historicalRowsForRace(code, district)
        : houseDistrictResults(code, district);
      const summary = locationLeader(rows);
      const swing = swingMode() ? swingForRows(rows, code, district) : null;
      const holdPickup = pickupsMode() ? holdPickupSummary(rows, code, district) : null;
      const incumbent = districtControl(district);
      const projections = swingMode() || pickupsMode() ? [] : projectionsForArea(code, district);
      const classes = ["map-shape", "house-district"];
      if (selectedDistrict === district) classes.push("selected");
      if (!controlMode && !historicalMode() && !swingMode() && !pickupsMode() && isPartyFlip(summary, code, district, rows)) classes.push("party-flip");
      if (!controlMode && !historicalMode()
        && unseenResultAreas.districts.has(resultAreaKey("House", code, district))) classes.push("new-result");
      const path = svgElement("path", classes.join(" "));
      path.setAttribute("d", geography.districtPath(feature) || "");
      if (controlMode) {
        applyControlColor(path, incumbent?.party || null);
      } else if (swingMode()) applySwingColor(path, swing);
      else if (pickupsMode()) applyHoldPickupColor(path, holdPickup);
      else applyLeaderColor(path, summary);
      let label = controlMode
        ? `${district}, ${incumbent?.name || "No current representative listed"}, ${controlPartyLabel(incumbent?.party || null)}`
        : swingMode()
          ? `${district}, ${swingDescription(swing)}${swing?.year ? ` versus ${swing.year}` : ""}`
          : pickupsMode()
            ? `${district}, ${holdPickupDescription(holdPickup)}`
            : `${district}, ${leadDescription(summary)}${!historicalMode() && isPartyFlip(summary, code, district, rows) ? ", opposite party leading versus the current officeholder" : ""}${projections.length ? `, Dalton projects ${projections[0].winner.candidate} to win` : ""}`;
      if (classes.includes("new-result")) label += ", new results since the last update; click to acknowledge";
      bindMapActivation(path, label, () => selectDistrict(code, district), { state: code, stateName: STATES.find((state) => state.code === code)?.name || code, district });
      appendSvgTitle(path, label);
      mapLayer.append(path);
    }
    elements["map-title"].textContent = controlMode ? "U.S. House · District Control"
      : pickupsMode() ? "U.S. House · Holds & Pickups" : "U.S. House · Congressional Districts";
    elements["map-hint"].textContent = controlMode
      ? "Current party of each House officeholder across all 435 voting districts. Select a district to see its representative; vacancies are grey."
      : pickupsMode()
        ? "Lighter shades are hold leads and darker shades are pickup leads compared with each district's current representative. Grey means no reportable lead or incumbent-party baseline; leads are not calls."
      : historicalMode()
        ? historicalResultsError
          ? `Historical results unavailable: ${historicalResultsError}`
          : "Past-results view. Select a district to see the most recent completed election's candidate totals and year. District boundaries may differ from 2024."
        : swingMode()
          ? "Each shape compares current House results with that district's prior completed election. Positive swing means Democratic overperformance; districts without comparable history or current two-party votes stay grey."
          : "Each shape is a 119th Congress district. Select a district for its 2026 candidate totals. A dashed gold outline marks a lead by the opposite party from the current officeholder.";
  }

  function renderCountyMap() {
    const svg = elements["election-map"];
    const state = STATES.find((entry) => entry.code === selectedState);
    const stateFeature = geography.states.find((feature) => String(feature.id).padStart(2, "0") === STATE_FIPS[selectedState]);
    const allCounties = geography.counties.filter((feature) => String(feature.id).padStart(5, "0").startsWith(STATE_FIPS[selectedState]));
    const bounds = geography.path.bounds(stateFeature);
    const width = Math.max(1, bounds[1][0] - bounds[0][0]);
    const height = Math.max(1, bounds[1][1] - bounds[0][1]);
    const padding = Math.max(width, height) * 0.06;
    svg.setAttribute("viewBox", `${bounds[0][0] - padding} ${bounds[0][1] - padding} ${width + padding * 2} ${height + padding * 2}`);
    svg.setAttribute("aria-label", `${state.name} county results map. Select a county to inspect reported results.`);

    for (const feature of allCounties) {
      const rows = countyResults(selectedState, feature);
      const summary = locationLeader(rows);
      const fips = String(feature.id).padStart(5, "0");
      const swing = swingMode() ? swingForRows(rows, selectedState, null, fips) : null;
      const countyName = feature.properties?.name || "County";
      const classes = ["map-shape", "county-shape"];
      const countyHasNewResults = !historicalMode()
        && (unseenResultAreas.counties.has(resultAreaKey(selectedRace(), selectedState, `fips:${fips}`))
          || unseenResultAreas.counties.has(resultAreaKey(selectedRace(), selectedState, `name:${normalizeCountyName(countyName)}`)));
      if (countyHasNewResults) {
        classes.push("new-result");
      }
      const path = svgElement("path", classes.join(" "));
      path.setAttribute("d", geography.path(feature) || "");
      if (swingMode()) applySwingColor(path, swing);
      else applyLeaderColor(path, summary);
      const label = swingMode()
        ? `${countyName}, ${state.name}, ${swingDescription(swing)}${swing?.year ? ` versus ${swing.year}` : ""}`
        : `${countyName}, ${state.name}, ${leadDescription(summary)}`;
      const countyLabel = classes.includes("new-result")
        ? `${label}, new results since the last update; click to acknowledge`
        : label;
      bindMapActivation(path, countyLabel, () => selectCounty(fips, countyName), {
        state: selectedState, stateName: state.name, countyFips: fips, countyName,
      });
      appendSvgTitle(path, countyLabel);
      mapLayer.append(path);
    }

    const outline = svgElement("path", "map-shape state-outline");
    outline.setAttribute("d", geography.path(stateFeature) || "");
    mapLayer.append(outline);
    elements["map-title"].textContent = `${state.name} · ${selectedRace()} Counties`;
    const countyRows = raceResults(stateResults(selectedState)).filter((row) => row.county || row.countyFips);
    elements["map-hint"].textContent = swingMode()
      ? countyRows.length
        ? `${countyRows.length} ${selectedRace()} county-level candidate rows are available. Counties without same-office historical county returns stay grey.`
        : `County swing unavailable: no prior same-office county returns are bundled. Current ${selectedRace()} county rows are ${countyRows.length ? "available" : "not reported"}.`
      : DEMO_MODE
        ? !candidateRoster?.[selectedRace().toLowerCase()]?.[selectedState]
          ? `${selectedState} has no active ${selectedRace()} race in this demo.`
          : `${new Set(countyRows.map((row) => String(row.countyFips || "").padStart(5, "0"))).size} of ${allCounties.length} counties have reported ${selectedRace()} results. Select a county to inspect its totals.`
        : countyRows.length
        ? `${countyRows.length} ${selectedRace()} county-level candidate rows are available. Select a county to inspect its reported results.`
        : `Showing all ${allCounties.length} counties. No ${selectedRace()} county-level rows are available; these counties stay grey.`;
  }

  function renderMap() {
    if (!geography) return;
    hideMapTooltip();
    const svg = elements["election-map"];
    svg.replaceChildren();
    const nextViewKey = `${elements["map-mode"].value}:${selectedRace()}:${selectedState || "US"}`;
    if (nextViewKey !== mapViewKey) {
      mapScale = 1;
      mapTranslateX = 0;
      mapTranslateY = 0;
      mapViewKey = nextViewKey;
    }
    createMapLayer();
    const houseMode = selectedRace() === "House";
    elements["map-back"].hidden = historicalMode() || (houseMode ? !selectedDistrict : !selectedState);
    elements["map-back"].textContent = houseMode ? "← All districts" : selectedCounty ? "← State map" : "← All states";
    elements["state-filter"].hidden = houseMode || currentControlMode();
    elements["state-filter"].disabled = Boolean(selectedState);
    if (houseMode) {
      if (!Array.isArray(geography.districts)) {
        elements["map-title"].textContent = "U.S. House · Congressional Districts";
        elements["map-hint"].textContent = "Loading congressional district boundaries…";
      } else if (selectedDistrict) renderSelectedDistrictMap();
      else renderHouseMap();
    } else if (selectedState && !currentControlMode() && !historicalMode() && !pickupsMode()) renderCountyMap();
    else renderNationalMap();
    renderMapLegend();
    renderMapAttribution();
    renderSwingSummary();
  }

  function selectState(code) {
    acknowledgeResultArea("states", selectedRace(), code, "state");
    selectedState = code;
    selectedCounty = null;
    selectedDistrict = null;
    syncResultsStateFilter();
    renderMap();
    renderStateDetail();
    renderResults();
  }

  function selectCounty(fips, name) {
    acknowledgeResultArea("counties", selectedRace(), selectedState, `fips:${String(fips).padStart(5, "0")}`);
    acknowledgeResultArea("counties", selectedRace(), selectedState, `name:${normalizeCountyName(name)}`);
    selectedCounty = { fips, name };
    syncResultsStateFilter();
    renderMap();
    renderStateDetail();
    renderResults();
  }

  function selectDistrict(state, district) {
    acknowledgeResultArea("districts", "House", state, district);
    selectedState = state;
    selectedDistrict = district;
    selectedCounty = null;
    syncResultsStateFilter();
    renderMap();
    renderStateDetail();
    renderResults();
  }

  function renderSelectedDistrictMap() {
    renderHouseMap();
    elements["map-title"].textContent = pickupsMode()
      ? `${selectedDistrict} · House Holds & Pickups`
      : `${selectedDistrict} · House`;
    elements["map-hint"].textContent = currentControlMode()
      ? "District selected. The current representative and party are shown at right; select another district or return to all districts."
      : swingMode()
        ? "District selected. The district's margin change versus its prior comparable election is shown in the map and overlay; candidate totals remain in the results panel."
        : pickupsMode()
          ? "District selected. Shade compares the reported leader with the current representative's party; lighter is a hold lead, darker is a pickup lead. This is not a race call."
        : historicalMode()
        ? "Past-results view. Historical candidate totals and their election year are shown at right; districts redrawn since 2024 may not have comparable boundaries."
      : "District selected. Candidate totals are shown at right and in the results table; select another district or return to all districts.";
  }

  function appendExternalLink(parent, label, value) {
    const href = safeUrl(value);
    if (!href) return;
    const link = make("a", "source-link", label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    parent.append(link);
  }

  function pollCloseSchedule(stateCode, district) {
    const schedule = snapshot?.media?.pollClosingTimes;
    if (!schedule?.latestCloseEt?.[stateCode]) return null;
    let closeTime = schedule.latestCloseEt[stateCode];
    if (selectedRace() === "House" && district) {
      const match = district.match(/^[A-Z]{2}-(\d{1,2})$/);
      const override = schedule.districtOverrides?.[stateCode];
      if (match && override) {
        const districtNumber = match[1].padStart(2, "0");
        closeTime = override.specific?.[districtNumber] || override.default || closeTime;
      }
    }
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(closeTime);
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedule.electionDate || "");
    if (!timeMatch || !dateMatch) return null;
    const [year, month, day] = dateMatch.slice(1).map(Number);
    const closeUtc = Date.UTC(year, month - 1, day, Number(timeMatch[1]) + 5, Number(timeMatch[2]));
    const closeDate = new Date(closeUtc);
    const cutoffDate = new Date(closeUtc - 3 * 60 * 60 * 1000);
    const timeOptions = { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" };
    return {
      closeUtc,
      cutoffUtc: cutoffDate.getTime(),
      closeLabel: closeDate.toLocaleTimeString("en-US", timeOptions),
      cutoffLabel: cutoffDate.toLocaleTimeString("en-US", timeOptions),
      sourceUrl: schedule.sourceUrl,
    };
  }

  function appendPollCard(parent, poll) {
    const card = make("article", "media-card poll-card");
    const heading = make("div", "media-card-heading");
    heading.append(make("strong", "", poll.pollster));
    heading.append(make("span", "media-meta", `Field dates · ${poll.startDate || "?"}–${poll.endDate || "?"}`));
    card.append(heading);
    const details = [];
    if (poll.sampleSize) details.push(`n=${formatNumber(poll.sampleSize)}`);
    if (poll.population) details.push(String(poll.population).toUpperCase());
    if (details.length) card.append(make("div", "media-meta", details.join(" · ")));
    if (poll.answers?.length) {
      const answers = make("div", "poll-answers");
      for (const answer of poll.answers) {
        answers.append(make("span", "poll-answer", `${answer.choice} · ${Number(answer.pct).toFixed(1)}%`));
      }
      card.append(answers);
    }
    appendExternalLink(card, "View original poll ↗", poll.sourceUrl);
    parent.append(card);
  }

  function appendVoteHubAttribution(parent, polling) {
    const attribution = make("p", "media-attribution");
    attribution.append(document.createTextNode("Source: "));
    const providerLink = make("a", "", "VoteHub Polls API");
    providerLink.href = polling.sourceUrl;
    providerLink.target = "_blank";
    providerLink.rel = "noopener noreferrer";
    const licenseLink = make("a", "", "CC BY 4.0");
    licenseLink.href = "https://creativecommons.org/licenses/by/4.0/";
    licenseLink.target = "_blank";
    licenseLink.rel = "noopener noreferrer";
    attribution.append(providerLink, document.createTextNode(" · "), licenseLink,
      document.createTextNode(" · polls shown individually, no averages."));
    parent.append(attribution);
  }

  function statePollingFeed() {
    const livePolling = snapshot?.media?.polling;
    if (livePolling?.sources?.some((source) =>
      ["senate", "governor", "house"].includes(source.office?.toLowerCase()))) return livePolling;
    if (nationalPollingSnapshot?.stateSources?.length) {
      return {
        provider: nationalPollingSnapshot.provider,
        sourceUrl: nationalPollingSnapshot.sourceUrl,
        status: nationalPollingSnapshot.stateStatus,
        polls: nationalPollingSnapshot.statePolls || [],
        sources: nationalPollingSnapshot.stateSources,
        attribution: "Source: VoteHub Polls API, CC BY 4.0. Poll records are displayed individually; no averages are calculated.",
      };
    }
    return livePolling || null;
  }

  function appendPollingDetails(parent, stateCode, district) {
    const polling = statePollingFeed();
    const office = selectedRace().toLowerCase();
    const officeLabel = selectedRace() === "House" && district ? `House · ${district}` : selectedRace();
    const disclosure = make("details", "state-polling-disclosure");
    disclosure.open = statePollingExpanded;
    disclosure.addEventListener("toggle", () => {
      statePollingExpanded = disclosure.open;
    });
    disclosure.append(make("summary", "detail-section-title", `State-specific polling · ${officeLabel}`));
    parent.append(disclosure);
    if (!polling) {
      disclosure.append(make("p", "empty-state",
        `State polling data is unavailable: ${nationalPollingError || "no polling feed is available in this snapshot."}`));
      return;
    }

    const matches = selectedRace() === "House" && !district
      ? []
      : (polling.polls || [])
        .filter((poll) => poll.state === stateCode && poll.pollType === office)
        .filter((poll) => selectedRace() !== "House" || poll.district === district)
        .sort((left, right) => String(right.endDate || "").localeCompare(String(left.endDate || "")))
        .slice(0, 8);
    const officeStatus = (polling.sources || []).find((source) => source.office?.toLowerCase() === office);
    if (officeStatus?.fetchedAt) {
      disclosure.append(make("div", "media-meta", `VoteHub feed refreshed · ${displayDate(officeStatus.fetchedAt)}`));
    }
    if (officeStatus?.status === "error") {
      disclosure.append(make("p", "empty-state", `VoteHub polling data unavailable: ${officeStatus.error || "the provider request failed."}`));
    } else if (officeStatus?.status === "stale") {
      disclosure.append(make("p", "media-warning", `Showing the last successful VoteHub feed from ${displayDate(officeStatus.fetchedAt)}; refresh failed: ${officeStatus.error || "unknown error"}`));
    } else if (selectedRace() === "House" && !district) {
      disclosure.append(make("p", "empty-state", "Select a congressional district to see polls for that House race."));
    } else if (!matches.length) {
      disclosure.append(make("p", "empty-state", `No 2026 ${officeLabel} polls are currently listed for this race by VoteHub.`));
    }

    for (const poll of matches) appendPollCard(disclosure, poll);
    appendVoteHubAttribution(disclosure, polling);
  }

  function nationalPollingFromSnapshot() {
    const polling = snapshot?.media?.polling;
    if (!polling) return null;
    const sourceStatus = (polling.sources || []).find((source) =>
      source.office?.toLowerCase() === "generic ballot");
    const polls = (polling.polls || []).filter((poll) =>
      poll.pollType === "generic-ballot" && !poll.state);
    return sourceStatus || polls.length ? { ...polling, sourceStatus, polls } : null;
  }

  function nationalPollingFeed() {
    const snapshotFeed = nationalPollingFromSnapshot();
    if (snapshotFeed && (snapshotFeed.polls.length
      || ["reachable", "cached"].includes(snapshotFeed.sourceStatus?.status))) return snapshotFeed;
    return nationalPollingSnapshot || snapshotFeed;
  }

  function renderNationalPolling() {
    const parent = elements["national-polling"];
    elements["national-polling-panel"].hidden = selectedRace() !== "House";
    parent.replaceChildren();
    const feed = nationalPollingFeed();
    if (!feed) {
      elements["national-polling-status"].textContent = "Feed unavailable";
      parent.append(make("p", "empty-state",
        `National polling data is unavailable: ${nationalPollingError || "the published polling snapshot has not loaded."}`));
      return;
    }

    const status = feed.sourceStatus?.status || feed.status;
    const error = feed.sourceStatus?.error || feed.error;
    const fetchedAt = feed.sourceStatus?.fetchedAt || feed.capturedAt;
    elements["national-polling-status"].textContent = fetchedAt
      ? `Updated ${displayDate(fetchedAt)}`
      : "VoteHub polling feed";
    if (status === "error") {
      parent.append(make("p", "empty-state", `VoteHub national polls unavailable: ${error || "the provider request failed."}`));
      appendVoteHubAttribution(parent, feed);
      return;
    }
    if (status === "stale") {
      parent.append(make("p", "media-warning",
        `Showing the last successful VoteHub feed from ${displayDate(fetchedAt)}; refresh failed: ${error || "unknown error"}`));
    }
    if (nationalPollingError && feed === nationalPollingSnapshot) {
      parent.append(make("p", "media-warning",
        `Showing the last successful VoteHub feed from ${displayDate(fetchedAt)}; refresh failed: ${nationalPollingError}`));
    }

    const polls = (feed.polls || [])
      .filter((poll) => poll.pollType === "generic-ballot" && !poll.state)
      .sort((left, right) => String(right.endDate || "").localeCompare(String(left.endDate || "")))
      .slice(0, 8);
    if (!polls.length) {
      parent.append(make("p", "empty-state", "No national 2026 generic-ballot polls are currently listed by VoteHub."));
    }
    for (const poll of polls) appendPollCard(parent, poll);
    appendVoteHubAttribution(parent, feed);
  }

  async function loadNationalPolling(force = false) {
    const snapshotFeed = nationalPollingFromSnapshot();
    if (snapshotFeed && (snapshotFeed.polls.length
      || ["reachable", "cached"].includes(snapshotFeed.sourceStatus?.status))) {
      renderNationalPolling();
      return;
    }
    if (!force && Date.now() - nationalPollingLastAttemptAt < NATIONAL_POLL_REFRESH_MS) {
      renderNationalPolling();
      return;
    }
    nationalPollingLastAttemptAt = Date.now();
    try {
      const response = await fetch(`./national-polls.json?t=${nationalPollingLastAttemptAt}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`National VoteHub feed request failed (HTTP ${response.status}).`);
      const feed = await response.json();
      if (!feed || feed.schemaVersion !== 1 || !Array.isArray(feed.polls)
        || !["reachable", "error"].includes(feed.status)) {
        throw new Error("National VoteHub feed is invalid.");
      }
      nationalPollingSnapshot = feed;
      nationalPollingError = null;
    } catch (error) {
      nationalPollingError = error.message || "National polling data could not be loaded.";
      console.error(nationalPollingError);
    }
    renderNationalPolling();
    if (selectedState) renderStateDetail();
  }

  function appendNewsDetails(parent, stateCode) {
    const news = snapshot?.media?.news;
    parent.append(make("p", "detail-section-title", "State race news"));
    const feed = news?.feeds?.[stateCode];
    if (!feed) {
      parent.append(make("p", "empty-state", "No state news feed is available in this snapshot."));
      return;
    }
    if (feed.status === "error") {
      parent.append(make("p", "empty-state", `Google News RSS unavailable: ${feed.error || "the feed request failed."}`));
      return;
    }
    if (feed.status === "stale") {
      parent.append(make("p", "media-warning", `Showing the last successful feed from ${displayDate(feed.fetchedAt)}; the refresh failed: ${feed.error || "unknown error"}`));
    } else if (feed.fetchedAt) {
      parent.append(make("div", "media-meta", `RSS refreshed · ${displayDate(feed.fetchedAt)}`));
    }
    if (!feed.items?.length && feed.status !== "error") {
      parent.append(make("p", "empty-state", "No matching state-race headlines are currently in the RSS feed."));
    }

    for (const item of feed.items || []) {
      const card = make("article", "media-card news-card");
      const headline = make("a", "news-headline", item.title);
      const href = safeUrl(item.url);
      if (href) {
        headline.href = href;
        headline.target = "_blank";
        headline.rel = "noopener noreferrer";
      }
      card.append(headline);
      const metadata = [item.publisher, item.publishedAt].filter(Boolean);
      if (metadata.length) card.append(make("div", "media-meta", metadata.join(" · ")));
      parent.append(card);
    }
    const source = make("p", "media-attribution");
    source.append(document.createTextNode("Headlines via "));
    const providerLink = make("a", "", "Google News RSS");
    providerLink.href = safeUrl(feed.feedUrl) || news.sourceUrl;
    providerLink.target = "_blank";
    providerLink.rel = "noopener noreferrer";
    source.append(providerLink, document.createTextNode(" · opens each story at its linked source."));
    parent.append(source);
  }

  function appendPollingAndNews(parent, stateCode, district) {
    const schedule = pollCloseSchedule(stateCode, district);
    if (schedule && Date.now() >= schedule.cutoffUtc) {
      parent.append(make("p", "media-cutoff-note",
        `Polling and news panels are hidden within three hours of the latest scheduled poll close (${schedule.closeLabel}).`));
      appendExternalLink(parent, "View 2026 poll-closing schedule ↗", schedule.sourceUrl);
      return;
    }
    if (schedule) {
      parent.append(make("p", "media-window-note",
        `Polling and news shown until three hours before polls close · latest close ${schedule.closeLabel}.`));
    }
    appendPollingDetails(parent, stateCode, district);
    if (snapshot?.media?.news) appendNewsDetails(parent, stateCode);
    if (snapshot?.media?.polling?.status === "partial") {
      parent.append(make("p", "media-warning", "Some polling feeds could not be refreshed; source status is shown with the affected office."));
    }
    if (schedule) appendExternalLink(parent, "Poll-closing times source ↗", schedule.sourceUrl);
  }

  function appendControlCard(title, party, subtitle) {
    const card = make("div", "candidate-card");
    const top = make("div", "candidate-top");
    appendCandidateName(top, title, party === "D" ? "Democratic" : party === "R" ? "Republican" : party === "O" ? "Independent" : "", party);
    top.append(make("span", `party-control-label ${party ? `party-${party.toLowerCase()}` : "party-vacant"}`, controlPartyLabel(party)));
    card.append(top);
    if (subtitle) card.append(make("div", "candidate-meta", subtitle));
    elements["state-detail"].append(card);
  }

  function appendCandidateCard(parent, row, peers, historical = false) {
    const card = make("div", `candidate-card${row.placeholder ? " candidate-placeholder" : ""}`);
    const content = make("div", "candidate-card-content");
    appendCandidatePhoto(content, row.candidate);
    const copy = make("div", "candidate-card-copy");
    const top = make("div", "candidate-top");
    appendCandidateName(top, row.candidate, row.party, row.partyCode);
    const voteBlock = make("span", "candidate-vote-block");
    voteBlock.append(make("span", "candidate-votes", `${formatNumber(row.votes)} votes`));
    const share = percentValue(row, peers);
    voteBlock.append(make("span", "candidate-share", share == null ? "Vote share —" : `${formatPercent(share)} ${percentCaption(row)}`));
    top.append(voteBlock);
    copy.append(top);
    const historicalLabel = row.resultStage === "first-round"
      ? `${row.historicalYear} general election`
      : `${row.historicalYear} ${row.resultStage} election`;
    const metaParts = [historical ? historicalLabel : row.race || row.office || "2026 general election", row.party || "Party not listed"];
    if (row.resultStage === "first-round") metaParts.push("first-round total");
    if (row.precinctsReportingPct != null) metaParts.push(`${row.precinctsReportingPct}% reporting`);
    copy.append(make("div", "candidate-meta", metaParts.join(" · ")));
    if (row.placeholder) copy.append(make("span", "verification", "AWAITING RESULTS · PLACEHOLDER"));
    else if (row.verificationRequired) copy.append(make("span", "verification", "VERIFY OFFICIAL SOURCE"));
    content.append(copy);
    card.append(content);
    appendExternalLink(card, historical ? "View historical source ↗" : "View result source ↗", row.sourceUrl);
    parent.append(card);
  }

  function renderCurrentControlDetail() {
    const code = selectedState;
    const state = STATES.find((entry) => entry.code === code);
    elements["clear-state"].hidden = !code;
    elements["state-detail"].replaceChildren();
    elements["detail-eyebrow"].textContent = selectedDistrict ? `${code} · HOUSE DISTRICT` : "CURRENT OFFICEHOLDERS";
    if (!state) {
      elements["detail-title"].textContent = selectedRace() === "House" ? "Select a district" : "Select a state";
      elements["state-detail"].append(make("p", "empty-state",
        selectedRace() === "House"
          ? "Choose a congressional district to see its current representative and party."
          : "Choose a state to see the current officeholder party and names."));
      return;
    }
    elements["detail-title"].textContent = selectedDistrict || state.name;
    const summary = make("div", "state-summary");
    summary.append(make("span", "pill", `Current control · ${currentControl?.metadata?.asOf || "date unavailable"}`));
    elements["state-detail"].append(summary);
    elements["state-detail"].append(make("p", "detail-section-title", selectedRace() === "Senate"
      ? "Current senators · regular-election seats by class"
      : selectedRace() === "Governor" ? "Current governor" : "Current representative"));
    if (selectedRace() === "House") {
      const representative = districtControl(selectedDistrict);
      if (representative) {
        appendControlCard(representative.name, representative.party, representative.vacant ? "This district has no sitting voting representative." : selectedDistrict);
      } else {
        elements["state-detail"].append(make("p", "empty-state", "No representative entry is available for this district in the current roster."));
      }
      return;
    }
    if (selectedRace() === "Governor") {
      const governor = governorForState(code);
      if (governor) appendControlCard(governor.name, governor.party, "Governor");
      else elements["state-detail"].append(make("p", "empty-state", "No current governor entry is available for this state."));
      return;
    }
    const senators = senatorsForState(code);
    if (!senators.length) {
      elements["state-detail"].append(make("p", "empty-state", "No current senator entries are available for this state."));
      return;
    }
    for (const senator of senators) appendControlCard(senator.name, senator.party, `U.S. Senator · Class ${senator.class}`);
  }

  function renderStateDetail() {
    if (currentControlMode()) {
      renderCurrentControlDetail();
      return;
    }
    const code = selectedState;
    const state = STATES.find((entry) => entry.code === code);
    elements["clear-state"].hidden = !code;
    elements["state-detail"].replaceChildren();
    if (!state) {
      elements["detail-eyebrow"].textContent = "STATE DETAILS";
      elements["detail-title"].textContent = "Select a state";
      elements["state-detail"].append(make("p", "empty-state", "Choose a state on the map to inspect its results and official source links."));
      return;
    }

    const selectedTitle = selectedDistrict || (selectedCounty ? selectedCounty.name : state.name);
    elements["detail-eyebrow"].textContent = selectedDistrict ? `${code} · HOUSE DISTRICT` : selectedCounty ? `${code} · COUNTY` : code;
    elements["detail-title"].textContent = selectedTitle;
    if (historicalMode()) {
      const rows = historicalRowsForRace(code, selectedDistrict);
      const summary = make("div", "state-summary");
      const year = rows[0]?.historicalYear;
      if (year) summary.append(make("span", "pill", `Most recent completed election · ${year}`));
      elements["state-detail"].append(summary);
      elements["state-detail"].append(make("p", "detail-section-title", "Historical candidate totals"));
      if (historicalResultsError) {
        elements["state-detail"].append(make("p", "empty-state", `Historical results unavailable: ${historicalResultsError}`));
      } else if (!rows.length) {
        const noHistory = selectedDistrict && historicalResults?.metadata?.houseNoPriorContest?.includes(selectedDistrict);
        elements["state-detail"].append(make("p", "empty-state", noHistory
          ? `${selectedDistrict} has no comparable prior district result because the district was created after the 2024 election.`
          : `No prior completed ${selectedRace()} result is available for this location.`));
      }
      for (const row of rows) appendCandidateCard(elements["state-detail"], row, rows, true);
      return;
    }

    const location = {
      district: selectedDistrict,
      countyFips: selectedCounty?.fips,
      countyName: selectedCounty?.name,
    };
    const rows = selectedCounty
      ? countyResults(code, { id: selectedCounty.fips, properties: { name: selectedCounty.name } })
      : selectedDistrict
        ? houseDistrictResults(code, selectedDistrict)
        : raceResults(stateResults(code));
    const candidateRows = candidateRowsForArea(code, location);
    const summary = make("div", "state-summary");
    summary.append(make("span", "pill candidate-count-pill", `${candidateRows.length} listed candidate${candidateRows.length === 1 ? "" : "s"}`));
    summary.append(make("span", "pill", `${rows.length} reported result row${rows.length === 1 ? "" : "s"}`));
    if (!selectedCounty && isPartyFlip(locationLeader(rows), code, selectedDistrict, rows)) {
      summary.append(make("span", "pill party-flip-pill", "Opposite party leading · not a race call"));
    }
    if (pickupsMode() && !selectedCounty) {
      summary.append(make("span", "pill", holdPickupDescription(holdPickupSummary(rows, code, selectedDistrict))));
    }
    if (!selectedCounty && !selectedDistrict) {
      const raceStatus = stateRaceStatus(code);
      if (raceStatus) summary.append(make("span", `pill state-status-pill ${raceStatus.kind}`, raceStatus.label));
    }
    elements["state-detail"].append(summary);

    const candidateHeading = make("div", "detail-section-heading");
    candidateHeading.append(make("p", "detail-section-title", selectedCounty
      ? "County candidate totals · zero means no votes reported yet"
      : "2026 general-election candidate totals"));
    const watchButton = createWatchButton(selectedRaceWatchRow(), "watch-button-detail");
    if (watchButton) candidateHeading.append(watchButton);
    elements["state-detail"].append(candidateHeading);
    if (raceDataError) elements["state-detail"].append(make("p", "empty-state", `2026 candidate roster unavailable: ${raceDataError}`));
    else if (!candidateRows.length) elements["state-detail"].append(make("p", "empty-state", "No general-election candidates are listed for this location in the bundled roster."));
    for (const row of candidateRows) appendCandidateCard(elements["state-detail"], row, candidateRows);
    if (selectedCounty && rows.length === 0 && !candidateRows.length) {
      elements["state-detail"].append(make("p", "empty-state", "No candidate totals were parsed for this county. This does not mean candidates have zero votes."));
    }
    appendPollingAndNews(elements["state-detail"], code, selectedDistrict);

    const sourceRows = (snapshot?.sources || []).filter((source) => source.state === code || source.office === "Senate" && source.source === "Open America" && rows.some((row) => row.source === "Open America"));
    const sourceLinks = (snapshot?.discoveredResultLinks || []).filter((link) => link.state === code);
    if (sourceRows.length || sourceLinks.length) {
      elements["state-detail"].append(make("p", "detail-section-title", "Official pages & discovered results"));
      for (const source of sourceRows) appendExternalLink(elements["state-detail"], source.source || "Source page", source.sourceUrl);
      for (const link of sourceLinks) appendExternalLink(elements["state-detail"], link.label || "Discovered result link", link.url);
    }
  }

  function passesOfficeFilter(row, filter) {
    if (filter === "all") return true;
    if (filter === "state") return row.verificationRequired === true;
    return raceType(row) === filter;
  }

  function resultRaceGroupKey(row) {
    const type = raceType(row) || "State";
    const state = String(row.state || "").toUpperCase();
    const district = type === "House" ? houseDistrict(row) : null;
    const seatClass = type === "Senate" ? String(row.seatClass || row.class || "").trim() : "";
    const fallbackRace = normalizeCountyName(String(row.race || row.office || "Unspecified contest"));
    const contest = type === "House"
      ? district || fallbackRace
      : type === "Senate"
        ? seatClass ? `class:${seatClass.toLowerCase()}` : "senate"
        : type === "Governor" ? "governor" : fallbackRace;
    return JSON.stringify([type, state, contest]);
  }

  function countyResultAreaKey(row) {
    const rawFips = row.countyFips == null ? "" : String(row.countyFips).trim();
    const fips = /^\d{1,5}$/.test(rawFips) ? rawFips.padStart(5, "0") : "";
    if (fips) return `county:fips:${fips}`;
    const county = normalizeCountyName(row.county || "");
    return county ? `county:name:${county}` : "county:unknown";
  }

  function isCountyResult(row) {
    return Boolean(row.county || row.countyFips || row.reportingUnitType === "county");
  }

  function resultVoteValue(row) {
    if (row.votes == null || row.votes === "") return null;
    const votes = Number(String(row.votes).replace(/,/g, ""));
    return Number.isFinite(votes) && votes >= 0 ? votes : null;
  }

  function resultCandidateId(row) {
    const name = candidateKey(row.candidate || row.candidateId || "");
    return name || JSON.stringify([row.candidate || "", row.partyCode || partyCode(row.party) || ""]);
  }

  function resultObservationTime(row) {
    return String(row.sourceAsOf || row.capturedAt || "");
  }

  function preferResultObservation(current, candidate) {
    if (!current) return candidate;
    const currentVotes = resultVoteValue(current);
    const candidateVotes = resultVoteValue(candidate);
    if (candidateVotes != null && (currentVotes == null || candidateVotes > currentVotes)) return candidate;
    if (candidateVotes === currentVotes
      && (candidate.winnerDeclared === true && current.winnerDeclared !== true
        || resultObservationTime(candidate) > resultObservationTime(current))) return candidate;
    return current;
  }

  function aggregateResultReportingPct(rows, countyOnly) {
    if (!countyOnly) {
      const reportingRows = rows
        .filter((row) => row.precinctsReportingPct != null && row.precinctsReportingPct !== ""
          && Number.isFinite(Number(row.precinctsReportingPct))
          && Number(row.precinctsReportingPct) >= 0 && Number(row.precinctsReportingPct) <= 100)
        .sort((left, right) => resultObservationTime(right).localeCompare(resultObservationTime(left)));
      return reportingRows.length ? Number(reportingRows[0].precinctsReportingPct) : null;
    }

    const reportingUnits = new Map();
    for (const row of rows) {
      if (row.precinctsReported == null || row.precinctsReported === ""
        || row.precinctsTotal == null || row.precinctsTotal === "") continue;
      const reported = Number(row.precinctsReported);
      const total = Number(row.precinctsTotal);
      if (!Number.isFinite(reported) || !Number.isFinite(total)
        || reported < 0 || total <= 0 || reported > total) continue;
      const key = countyResultAreaKey(row);
      const current = reportingUnits.get(key);
      if (!current || resultObservationTime(row) > resultObservationTime(current)) {
        reportingUnits.set(key, row);
      }
    }
    if (!reportingUnits.size || reportingUnits.size !== new Set(rows.map(countyResultAreaKey)).size) return null;
    const reportedTotal = [...reportingUnits.values()]
      .reduce((sum, row) => sum + Number(row.precinctsReported), 0);
    const precinctTotal = [...reportingUnits.values()]
      .reduce((sum, row) => sum + Number(row.precinctsTotal), 0);
    return precinctTotal > 0 ? reportedTotal / precinctTotal * 100 : null;
  }

  function aggregateRaceResults(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = resultRaceGroupKey(row);
      let group = groups.get(key);
      if (!group) {
        group = { key, rows: [] };
        groups.set(key, group);
      }
      group.rows.push(row);
    }

    return [...groups.values()].map((group) => {
      const raceWideRows = group.rows.filter((row) => !isCountyResult(row));
      const countyOnly = raceWideRows.length === 0;
      const sourceRows = countyOnly ? group.rows.filter(isCountyResult) : raceWideRows;
      const candidatesByArea = new Map();
      for (const row of sourceRows) {
        const area = countyOnly ? countyResultAreaKey(row) : "race";
        let areaCandidates = candidatesByArea.get(area);
        if (!areaCandidates) {
          areaCandidates = new Map();
          candidatesByArea.set(area, areaCandidates);
        }
        const id = resultCandidateId(row);
        areaCandidates.set(id, preferResultObservation(areaCandidates.get(id), row));
      }

      const candidates = new Map();
      for (const areaCandidates of candidatesByArea.values()) {
        for (const [id, row] of areaCandidates) {
          const candidate = candidates.get(id) || { id, row, votes: 0, hasVotes: false };
          const votes = resultVoteValue(row);
          if (votes != null) {
            candidate.votes += votes;
            candidate.hasVotes = true;
          }
          candidate.row = preferResultObservation(candidate.row, row);
          candidates.set(id, candidate);
        }
      }

      const reportingPct = aggregateResultReportingPct(sourceRows, countyOnly);
      const representative = sourceRows[0] || group.rows[0];
      const candidateRows = [...candidates.values()].map((candidate) => ({
        ...candidate.row,
        votes: candidate.hasVotes ? candidate.votes : null,
        candidatePct: null,
        precinctsReportingPct: reportingPct,
        county: "",
        countyFips: "",
        reportingUnitType: "",
        aggregatedFromCounties: countyOnly,
        source: countyOnly ? "Aggregated county returns" : candidate.row.source,
      })).sort((left, right) => {
        const leftVotes = resultVoteValue(left);
        const rightVotes = resultVoteValue(right);
        if (leftVotes == null && rightVotes != null) return 1;
        if (leftVotes != null && rightVotes == null) return -1;
        return (rightVotes ?? 0) - (leftVotes ?? 0)
          || String(left.candidate || "").localeCompare(String(right.candidate || ""));
      });
      return {
        key: group.key,
        row: representative,
        rows: candidateRows,
        countyOnly,
        reportingPct,
      };
    }).filter((group) => group.rows.length > 0).sort((left, right) =>
      String(left.row.state || "").localeCompare(String(right.row.state || ""))
      || resultsRaceLabel(left.row).localeCompare(resultsRaceLabel(right.row)));
  }

  function resultsRaceLabel(row) {
    const type = raceType(row);
    const state = String(row.state || "").toUpperCase();
    const stateName = STATES.find((entry) => entry.code === state)?.name || state || "Unspecified state";
    if (type === "House") return `${stateName} · ${houseDistrict(row) || row.race || row.office || "House"}`;
    if (type === "Senate") {
      const seatClass = row.seatClass || row.class;
      return `${stateName} · Senate${seatClass ? ` · Class ${seatClass}` : ""}`;
    }
    if (type === "Governor") return `${stateName} · Governor`;
    return `${stateName} · ${row.race || row.office || "State-page contest"}`;
  }

  function renderResults() {
    const body = elements["results-body"];
    body.replaceChildren();
    const watchedOnly = elements["watched-only-toggle"].checked;
    const resultTitle = historicalMode() ? "Past candidate results" : "Reported results";
    elements["results-title"].textContent = watchedOnly ? `${resultTitle} · Watched races` : resultTitle;
    updateWatchlistCount();
    const filter = elements["office-filter"].value;
    const availableRows = historicalMode() ? allHistoricalRows() : results();
    const rows = availableRows.filter((row) => {
      if (!passesOfficeFilter(row, filter)) return false;
      if (watchedOnly && !watchedRaceKeys.has(raceWatchKey(row))) return false;
      if (selectedState && String(row.state || "").toUpperCase() !== selectedState) return false;
      if (selectedDistrict && houseDistrict(row) !== selectedDistrict) return false;
      return true;
    });
    elements["table-note"].textContent = historicalMode()
      ? `Historical totals are from each contest's most recent completed election, including runoffs. House district boundaries may have changed; county-level reporting is displayed only when precinct counts support a weighted calculation.${historicalResultsError ? ` Data error: ${historicalResultsError}` : ""}`
      : "Candidates are grouped by race. Race-wide totals are preferred; county returns are summed only when a race-wide total is unavailable. County-only reporting is shown as a percentage only when precinct counts support a weighted total.";
    if (!rows.length) {
      const tr = make("tr");
      let emptyMessage;
      if (historicalMode() && historicalResultsError) emptyMessage = `Historical results unavailable: ${historicalResultsError}`;
      else if (watchedOnly && watchedRaceKeys.size === 0) {
        emptyMessage = "Your watchlist is empty. Use a WATCH button on a race to add it.";
      } else if (watchedOnly) emptyMessage = "No results match your watched races and current filters.";
      else if (historicalMode()) emptyMessage = "No historical candidate results match this view.";
      else emptyMessage = snapshot ? "No matching results are available. This is not a zero-vote result." : "Waiting for results data.";
      const cell = make("td", "table-empty", emptyMessage);
      cell.colSpan = 7;
      tr.append(cell);
      body.append(tr);
      return;
    }
    for (const group of aggregateRaceResults(rows)) {
      const groupRow = make("tr", "result-race-group-row");
      const groupCell = make("td", "result-race-group-cell");
      groupCell.colSpan = 7;
      const heading = make("div", "result-race-group-heading");
      const title = make("span", "result-race-group-title", resultsRaceLabel(group.row));
      title.setAttribute("role", "heading");
      title.setAttribute("aria-level", "3");
      heading.append(title);
      if (group.countyOnly) heading.append(make("span", "result-race-group-meta", "County rollup"));
      const watchButton = !historicalMode() && createWatchButton(group.row, "watch-button-table");
      if (watchButton) heading.append(watchButton);
      groupCell.append(heading);
      groupRow.append(groupCell);
      body.append(groupRow);

      for (const row of group.rows) {
        const tr = make("tr", "result-candidate-row");
        const stateCell = make("td");
        const stateButton = make("button", "text-button state-code", row.state || "—");
        stateButton.type = "button";
        stateButton.addEventListener("click", () => {
          const type = raceType(row);
          if (!row.state) return;
          if (type && selectedRace() !== type) {
            elements["race-view"].value = type;
            elements["race-view"].dispatchEvent(new Event("change"));
          }
          if (type === "House" && houseDistrict(row)) selectDistrict(row.state, houseDistrict(row));
          else selectState(row.state);
        });
        stateCell.append(stateButton);
        tr.append(stateCell);
        tr.append(make("td", "", houseDistrict(row) || "—"));
        const candidate = make("td", "candidate-result-cell");
        appendCandidatePhoto(candidate, row.candidate, "compact");
        appendCandidateName(candidate, row.candidate || "—", row.party, row.partyCode, "table-candidate-name");
        tr.append(candidate);
        tr.append(make("td", "party", row.party || "—"));
        const votes = make("td", "numeric");
        const voteBlock = make("span", "table-vote-block");
        voteBlock.append(make("span", "", formatNumber(row.votes)));
        const share = percentValue(row, group.rows);
        voteBlock.append(make("span", "table-vote-share", share == null ? "Vote share —" : `${formatResultsPercent(share)} ${percentCaption(row)}`));
        votes.append(voteBlock);
        tr.append(votes);
        const reporting = make("td", "", row.aggregatedFromCounties && row.precinctsReportingPct == null
          ? "County rollup"
          : formatResultsPercent(row.precinctsReportingPct));
        if (row.aggregatedFromCounties && row.precinctsReportingPct != null) {
          reporting.title = "Weighted from county precinct counts.";
        }
        tr.append(reporting);
        const source = make("td");
        if (row.verificationRequired) source.append(make("span", "verification", "Verify"));
        else if (row.source) source.textContent = row.source;
        else if (!row.sourceUrl) source.textContent = "—";
        appendExternalLink(source, row.verificationRequired ? "Official link ↗" : "Source ↗", row.sourceUrl);
        tr.append(source);
        body.append(tr);
      }
    }
  }

  function renderSources() {
    const sources = snapshot?.sources || [];
    const reachable = sources.filter((source) => source.status !== "error" && source.error == null).length;
    elements["sources-count"].textContent = snapshot ? `${reachable}/${sources.length}` : "—";
    elements["sources-caption"].textContent = sources.length ? "feeds reachable this snapshot" : "No source health records";
    elements["source-total"].textContent = `${sources.length} source${sources.length === 1 ? "" : "s"}`;
    const list = elements["source-list"];
    list.replaceChildren();
    if (!sources.length) {
      list.append(make("p", "empty-state", "No source health data is available in this snapshot."));
      return;
    }
    for (const source of sources) {
      const isError = source.status === "error" || source.error != null;
      const statusLabel = isError
        ? source.httpStatus === 403 ? "HTTP 403 · ACCESS DENIED" : "ERROR"
        : source.stale === true
          ? "STALE"
          : source.final === true
            ? "FINAL"
            : source.counting === true
              ? "COUNTING"
              : source.live === true
                ? "LIVE"
                : source.status === "reachable"
                  ? "REACHABLE"
                  : source.live === false
                    ? "NOT LIVE"
                    : "OK";
      const card = make("article", "source-card");
      const head = make("div", "source-card-head");
      head.append(make("span", "source-name", [source.state, source.source, source.office].filter(Boolean).join(" · ")));
      head.append(make("span", `source-status${isError ? " error" : ""}`, statusLabel));
      card.append(head);
      const meta = [];
      if (source.httpStatus) meta.push(`HTTP ${source.httpStatus}`);
      if (source.resultCount != null) meta.push(`${source.resultCount} result rows`);
      if (source.raceCount != null) meta.push(`${source.raceCount} races`);
      if (source.stale === true) meta.push("Feed marked stale");
      if (source.asOf) meta.push(`Feed as of ${displayDate(source.asOf)}`);
      if (source.capturedAt) meta.push(`Captured ${displayDate(source.capturedAt)}`);
      if (source.sourceNote) meta.push(source.sourceNote);
      card.append(make("div", "source-meta", meta.join(" · ") || "No additional status details"));
      if (isError) card.append(make("div", "source-meta source-error", source.error || "Source request failed"));
      appendExternalLink(card, "Source page ↗", source.sourceUrl);
      list.append(card);
    }
  }

  function renderNotices() {
    const notices = snapshot?.notices || [];
    const element = elements["notices"];
    element.replaceChildren();
    element.hidden = notices.length === 0;
    for (const notice of notices) element.append(make("div", "", notice));
  }

  function animateWinningMascot(party) {
    const mascotName = party === "D" ? "blue" : party === "R" ? "red" : "beige";
    const mascot = document.querySelector(`.mascot-anchor-${mascotName}`);
    if (!mascot) return;
    mascot.classList.remove("mascot-winner");
    void mascot.getBoundingClientRect();
    mascot.classList.add("mascot-winner");
    window.setTimeout(() => mascot.classList.remove("mascot-winner"), 1200);
  }

  function renderProjectionAnnouncements() {
    const section = elements["projection-announcements"];
    const list = elements["projection-list"];
    if (!snapshot) {
      section.hidden = true;
      return;
    }
    const raceOrder = ["Governor", "Senate", "House"];
    const groupedProjections = new Map(raceOrder.map((race) => [race, daltonProjections(race).sort((left, right) =>
      (right.demoCall?.calledAt || right.capturedAt || right.sourceAsOf)
        .localeCompare(left.demoCall?.calledAt || left.capturedAt || left.sourceAsOf))]));
    const allProjections = raceOrder.flatMap((race) => groupedProjections.get(race));
    const knownBeforeRender = new Set(knownProjectionIds);
    for (const projection of allProjections) {
      const alertKey = projectionAlertKey(projection);
      if (projectionBaselineEstablished && !knownCallKeys.has(alertKey)) {
        notifyRaceCall(projection);
        animateWinningMascot(projection.winner.partyCode);
      }
      knownCallKeys.add(alertKey);
      knownProjectionIds.add(projection.id);
    }
    projectionBaselineEstablished = true;
    if (historicalMode() || currentControlMode()) {
      section.hidden = true;
      return;
    }
    const projections = [];
    for (let index = 0; projections.length < 20; index += 1) {
      let added = false;
      for (const race of raceOrder) {
        const projection = groupedProjections.get(race)[index];
        if (!projection) continue;
        projections.push(projection);
        added = true;
        if (projections.length === 20) break;
      }
      if (!added) break;
    }
    const signature = JSON.stringify([
      allProjections.length,
      projections.map((projection) => [
        projection.id,
        projection.winner.candidate,
        projection.winner.partyCode,
        projection.winner.votes,
        projection.sourceAsOf,
        projection.demoCall?.calledAt || "",
        projection.demoCall?.probability || null,
        projectionOutcomeTag(projection),
        watchedRaceKeys.has(raceWatchKey(projection)),
        projection.candidates.map((candidate) => [candidate.candidate, candidate.votes, candidate.candidatePct]),
      ]),
    ]);
    section.hidden = allProjections.length === 0;
    if (signature === projectionRenderSignature) return;
    projectionRenderSignature = signature;
    list.replaceChildren();
    elements["projection-summary"].textContent = allProjections.length > 20
      ? `Showing the 20 most recent of ${allProjections.length} projected races · Scroll to see them all`
      : `${allProjections.length} race${allProjections.length === 1 ? "" : "s"} projected · grouped by office`;

    for (const office of raceOrder) {
      const officeProjections = projections.filter((projection) => projection.office === office);
      if (!officeProjections.length) continue;
      const group = make("section", "projection-group");
      group.setAttribute("aria-label", `${office} projections`);
      group.append(make("h3", "projection-group-title", `${office === "Senate" ? "Senate" : office} · ${officeProjections.length}`));
      const cards = make("div", "projection-group-cards");
      for (const projection of officeProjections) {
        const partyClass = projection.winner.partyCode === "D" ? "projection-dem"
          : projection.winner.partyCode === "R" ? "projection-rep" : "projection-other";
        const card = make("article", `projection-card ${partyClass}${knownBeforeRender.has(projection.id) ? "" : " projection-arrival"}`);
        const identity = projection.district || `${projection.state} · ${projection.office}`;
        appendCandidatePhoto(card, projection.winner.candidate, "standard");
        const copy = make("div", "projection-copy");
        copy.append(make("p", "projection-status", "DALTON PROJECTS · RACE OVER"));
        const title = make("h3", "projection-race");
        title.append(document.createTextNode(identity));
        const outcome = projectionOutcomeTag(projection);
        if (outcome) {
          title.append(make("span", `projection-outcome-tag projection-outcome-${outcome.toLowerCase()}`,
            outcome));
        }
        copy.append(title);
        const winner = make("p", "projection-winner");
        appendCandidateName(winner, projection.winner.candidate, projection.winner.party, projection.winner.partyCode, "projection-candidate-name");
        winner.append(document.createTextNode(` · ${formatNumber(projection.winner.votes)} votes`));
        copy.append(winner);
        const share = percentValue(projection.winner, projection.candidates);
        copy.append(make("p", "projection-meta", share == null
          ? `(${projection.winner.candidate} is projected to win; vote share is unavailable.)`
          : `(${projection.winner.candidate} is projected to win, currently holds ${formatPercent(share)} of the vote.)`));
        if (projection.demoCall) {
          const detail = `DEMO MODEL · Polls closed ${projection.demoCall.pollCloseAt}; called ${projection.demoCall.calledAt} at ${formatPercent(projection.demoCall.probability * 100)} estimated win probability with ${formatPercent(projection.demoCall.reportingPct)} reported.`;
          copy.append(make("p", "projection-source", detail));
        } else if (projection.sourceAsOf) {
          copy.append(make("p", "projection-source", `Official feed marked final · observed ${displayDate(projection.capturedAt || projection.sourceAsOf)}`));
        }
        const watchButton = createWatchButton(projection, "watch-button-projection");
        if (watchButton) copy.append(watchButton);
        card.append(copy);
        cards.append(card);
      }
      group.append(cards);
      list.append(group);
    }
  }

  function renderSnapshot() {
    const allResults = results();
    const statesWithResults = new Set(allResults.map((row) => row.state).filter(Boolean));
    elements["captured-at"].textContent = displayDate(snapshot.capturedAt);
    elements["states-count"].textContent = String(statesWithResults.size);
    elements["results-count"].textContent = formatNumber(allResults.length);
    elements["verify-count"].textContent = formatNumber(allResults.filter((row) => row.verificationRequired).length);
    elements["refresh-note"].textContent = `Auto-refreshes every ${REFRESH_MS / 1000} seconds`;
    elements["connection-status"].classList.remove("error");
    elements["connection-status"].classList.add("connected");
    elements["connection-label"].textContent = DEMO_MODE ? "Demo · synthetic results" : "Connected · snapshot loaded";
    renderSeatTallies();
    renderProjectionAnnouncements();
    renderMap();
    renderNationalPolling();
    renderStateDetail();
    renderResults();
    renderSources();
    renderNotices();
    updateAnchorInsights(snapshot);
  }

  function anchorInsightContestLabel(office, state, district, seatClass) {
    if (district) return `${district} House`;
    const stateName = STATES.find((entry) => entry.code === state)?.name || state;
    return office === "Senate" && seatClass
      ? `${stateName} Senate Class ${seatClass}`
      : `${stateName} ${office}`;
  }

  function summarizeAnchorResults(currentSnapshot) {
    const groups = new Map();
    const countyAreas = new Map();
    for (const row of currentSnapshot?.results || []) {
      if (!row || typeof row !== "object" || row.placeholder) continue;
      const office = raceType(row);
      const state = String(row.state || "").toUpperCase();
      const name = String(row.candidate || row.candidateId || "").trim();
      const candidateId = candidateKey(name);
      const votes = row.votes == null ? Number.NaN : Number(String(row.votes).replace(/,/g, ""));
      if (!office || !state || !candidateId || !Number.isFinite(votes) || votes < 0) continue;

      const district = houseDistrict(row);
      const seatClass = String(row.seatClass || row.class || "");
      const raceId = district || String(row.race || row.office || office).trim().toLowerCase();
      const contestId = JSON.stringify([office, state, raceId, seatClass]);
      const rawFips = row.countyFips == null ? "" : String(row.countyFips).trim();
      const fips = /^\d{1,5}$/.test(rawFips) ? rawFips.padStart(5, "0") : "";
      const countyName = String(row.county || "").trim();
      const countyId = fips ? `county:fips:${fips}`
        : countyName ? `county:name:${normalizeCountyName(countyName)}`
          : "";
      const areaId = countyId || (district ? `district:${district}` : "state");
      const code = ["D", "R", "O"].includes(row.partyCode) ? row.partyCode : partyCode(row.party);
      let group = groups.get(contestId);
      if (!group) {
        group = {
          office,
          state,
          district,
          seatClass,
          label: anchorInsightContestLabel(office, state, district, seatClass),
          areas: new Map(),
        };
        groups.set(contestId, group);
      }
      let area = group.areas.get(areaId);
      if (!area) {
        area = new Map();
        group.areas.set(areaId, area);
      }
      const existing = area.get(candidateId);
      const rowAsOf = String(row.sourceAsOf || row.capturedAt || "");
      const existingAsOf = String(existing?.row.sourceAsOf || existing?.row.capturedAt || "");
      if (!existing || votes > existing.votes
        || votes === existing.votes && (row.winnerDeclared === true && existing.row.winnerDeclared !== true
          || rowAsOf > existingAsOf)) {
        area.set(candidateId, {
          candidateId,
          name,
          code,
          votes,
          row,
        });
      }
      if (countyId) {
        const stateCounties = countyAreas.get(contestId) || new Set();
        stateCounties.add(countyId);
        countyAreas.set(contestId, stateCounties);
      }
    }

    const summaries = new Map();
    for (const [contestId, group] of groups) {
      const statewideAreas = [...group.areas].filter(([areaId]) => !areaId.startsWith("county:"));
      const reportAreas = statewideAreas.length ? statewideAreas : [...group.areas];
      const areaIds = new Set(reportAreas.map(([areaId]) => areaId));
      const candidates = new Map();
      let reportingPct = null;
      for (const [, area] of reportAreas) {
        for (const candidate of area.values()) {
          const current = candidates.get(candidate.candidateId);
          if (current) {
            current.votes += candidate.votes;
            if (!current.row && candidate.row) current.row = candidate.row;
          } else {
            candidates.set(candidate.candidateId, { ...candidate });
          }
          const reported = Number(candidate.row.precinctsReportingPct);
          if (candidate.row.precinctsReportingPct != null && Number.isFinite(reported)) {
            reportingPct = reportingPct == null ? reported : Math.max(reportingPct, reported);
          }
        }
      }

      const partyTotals = { D: 0, R: 0, O: 0 };
      let totalVotes = 0;
      let callWinner = null;
      for (const candidate of candidates.values()) {
        totalVotes += candidate.votes;
        if (Object.prototype.hasOwnProperty.call(partyTotals, candidate.code)) {
          partyTotals[candidate.code] += candidate.votes;
        }
        if (candidate.row.winnerDeclared === true) callWinner = candidate;
      }
      const winnerNames = new Set([...candidates.values()]
        .map(({ row }) => candidateKey(row.raceWinner))
        .filter(Boolean));
      if (winnerNames.size === 1) {
        const winnerId = [...winnerNames][0];
        callWinner = candidates.get(winnerId) || callWinner;
      }
      const leaders = [...candidates.values()].filter((candidate) => candidate.votes === Math.max(
        0, ...[...candidates.values()].map((entry) => entry.votes),
      ));
      summaries.set(contestId, {
        ...group,
        candidates,
        areaIds,
        totalVotes,
        partyTotals,
        reportingPct,
        leader: leaders.length === 1 && leaders[0].votes > 0 ? leaders[0] : null,
        callWinner,
      });
    }
    return { summaries, countyAreas };
  }

  function anchorInsightMetrics(current, previous, countyAreas) {
    const oldTotal = previous?.totalVotes || 0;
    const partyDeltas = {};
    const partyShareDeltas = {};
    for (const code of ["D", "R", "O"]) {
      const oldVotes = previous?.partyTotals[code] || 0;
      partyDeltas[code] = current.partyTotals[code] - oldVotes;
      const oldShare = oldTotal ? oldVotes / oldTotal * 100 : 0;
      const currentShare = current.totalVotes ? current.partyTotals[code] / current.totalVotes * 100 : 0;
      partyShareDeltas[code] = currentShare - oldShare;
    }
    const newAreas = [...current.areaIds].filter((area) => !previous?.areaIds.has(area)).length;
    const previousCounties = countyAreas.previous.get(current.id) || new Set();
    const currentCounties = countyAreas.current.get(current.id) || new Set();
    const newCounties = [...currentCounties].filter((area) => !previousCounties.has(area)).length;
    const deltaVotes = current.totalVotes - oldTotal;
    const newlyReporting = oldTotal === 0 && current.totalVotes > 0;
    const newCall = current.callWinner && current.callWinner.candidateId !== previous?.callWinner?.candidateId;
    const changed = !previous || deltaVotes !== 0 || newAreas > 0
      || newCounties > 0
      || ["D", "R", "O"].some((code) => partyDeltas[code] !== 0)
      || current.reportingPct !== previous?.reportingPct
      || newCall;
    return {
      current,
      partyDeltas,
      partyShareDeltas,
      deltaVotes,
      newAreas,
      newCounties,
      newlyReporting,
      newCall,
      changed,
    };
  }

  function anchorInsightCandidates(changes, newCountyCount) {
    const insights = [];
    for (const [code, speaker] of [["D", "mika"], ["R", "rory"]]) {
      const positiveRaces = changes.filter((change) => {
        const { current, partyDeltas, partyShareDeltas, newlyReporting, newCall } = change;
        const hasPositiveSignal = partyDeltas[code] >= Math.max(100, Math.round(current.totalVotes * 0.002))
          || partyShareDeltas[code] >= 0.5 && partyDeltas[code] > 0
          || newlyReporting && current.totalVotes >= 1_000 && current.partyTotals[code] > 0
          || newCall && current.callWinner.code === code;
        return hasPositiveSignal
          && (current.leader?.code === code || newCall && current.callWinner.code === code);
      }).sort((left, right) => {
        const leftScore = left.partyDeltas[code] + Math.max(0, left.partyShareDeltas[code]) * left.current.totalVotes;
        const rightScore = right.partyDeltas[code] + Math.max(0, right.partyShareDeltas[code]) * right.current.totalVotes;
        return rightScore - leftScore;
      });
      const best = positiveRaces[0];
      if (!best) continue;
      const { current, partyDeltas, newCall } = best;
      const candidate = newCall ? current.callWinner : current.leader;
      const share = current.totalVotes ? candidate.votes / current.totalVotes * 100 : null;
      if (share == null) continue;
      const partyLabel = code === "D" ? "Democratic" : "Republican";
      const activity = newCall
        ? `${candidate.name} is projected to win ${current.label} with ${formatPercent(share)} of the vote.`
        : `${candidate.name} leads ${current.label} with ${formatPercent(share)}; ${formatNumber(partyDeltas[code])} ${partyLabel} votes were added this update.`;
      insights.push({ speaker, text: activity });
    }

    const changedRaces = changes.filter((change) => change.changed);
    const addedVotes = changedRaces.reduce((sum, change) => sum + Math.max(0, change.deltaVotes), 0);
    const newCalls = changedRaces.filter((change) => change.newCall).length;
    if (newCountyCount >= 3 || addedVotes >= 1_000 || changedRaces.length >= 3 || newCalls > 0) {
      let text;
      if (newCountyCount && addedVotes) {
        text = `${formatNumber(newCountyCount)} new county returns arrived; ${formatNumber(addedVotes)} votes were added across ${formatNumber(changedRaces.length)} races.`;
      } else if (newCountyCount) {
        text = `${formatNumber(newCountyCount)} counties reported new local results across ${formatNumber(changedRaces.length)} races.`;
      } else if (newCalls) {
        text = `${formatNumber(newCalls)} race${newCalls === 1 ? "" : "s"} moved to projected winners in the latest update.`;
      } else if (addedVotes) {
        text = `${formatNumber(addedVotes)} new votes arrived across ${formatNumber(changedRaces.length)} races; ${formatNumber(changedRaces.filter((change) => change.newlyReporting).length)} began reporting.`;
      } else {
        text = `Results changed in ${formatNumber(changedRaces.length)} races; no net vote increase was recorded this update.`;
      }
      insights.push({ speaker: "sora", text });
    }
    return insights;
  }

  function hideAnchorInsight() {
    if (anchorInsightTimer != null) window.clearTimeout(anchorInsightTimer);
    anchorInsightTimer = null;
    activeAnchorInsight = null;
    elements["anchor-insight-bubble"].hidden = true;
    elements["anchor-insight-bubble"].classList.remove(...ANCHOR_SPEAKERS.map((speaker) => `speaker-${speaker}`));
    elements["anchor-insight-speaker"].textContent = "";
    elements["anchor-insight-message"].textContent = "";
  }

  function nextAnchorInsight() {
    const lastIndex = ANCHOR_SPEAKERS.indexOf(lastAnchorSpeaker);
    const now = Date.now();
    for (let step = 1; step <= ANCHOR_SPEAKERS.length; step += 1) {
      const speaker = ANCHOR_SPEAKERS[(lastIndex + step) % ANCHOR_SPEAKERS.length];
      const insight = pendingAnchorInsights.get(speaker);
      if (!insight) continue;
      pendingAnchorInsights.delete(speaker);
      if (now - insight.queuedAt > ANCHOR_INSIGHT_MINIMUM_MS) continue;
      return insight;
    }
    return null;
  }

  function showNextAnchorInsight() {
    const insight = nextAnchorInsight();
    if (!insight) {
      hideAnchorInsight();
      return;
    }
    const bubble = elements["anchor-insight-bubble"];
    bubble.classList.remove(...ANCHOR_SPEAKERS.map((speaker) => `speaker-${speaker}`));
    bubble.classList.add(`speaker-${insight.speaker}`);
    elements["anchor-insight-speaker"].textContent = ANCHOR_SPEAKER_NAMES[insight.speaker];
    elements["anchor-insight-message"].textContent = insight.text;
    bubble.hidden = false;
    activeAnchorInsight = insight;
    activeAnchorInsightSince = Date.now();
    lastAnchorSpeaker = insight.speaker;
    if (anchorInsightTimer != null) window.clearTimeout(anchorInsightTimer);
    anchorInsightTimer = window.setTimeout(() => {
      activeAnchorInsight = null;
      showNextAnchorInsight();
    }, ANCHOR_INSIGHT_MINIMUM_MS);
  }

  function updateAnchorInsights(currentSnapshot) {
    const next = summarizeAnchorResults(currentSnapshot);
    if (previousAnchorSummaries == null) {
      previousAnchorSummaries = next.summaries;
      previousAnchorCountyAreas = next.countyAreas;
      return;
    }
    const previous = previousAnchorSummaries;
    const changes = [];
    let newCountyCount = 0;
    for (const [contestId, current] of next.summaries) {
      current.id = contestId;
      const metrics = anchorInsightMetrics(current, previous.get(contestId), {
        previous: previousAnchorCountyAreas,
        current: next.countyAreas,
      });
      if (metrics.changed) changes.push(metrics);
      newCountyCount += metrics.newCounties;
    }
    previousAnchorSummaries = next.summaries;
    previousAnchorCountyAreas = next.countyAreas;

    for (const insight of anchorInsightCandidates(changes, newCountyCount)) {
      pendingAnchorInsights.set(insight.speaker, { ...insight, queuedAt: Date.now() });
    }
    if (activeAnchorInsight && Date.now() - activeAnchorInsightSince >= ANCHOR_INSIGHT_MINIMUM_MS) {
      showNextAnchorInsight();
    } else if (!activeAnchorInsight) {
      showNextAnchorInsight();
    }
  }

  function loadGeography() {
    if (geography?.counties?.length) return Promise.resolve(geography);
    if (geographyPromise) return geographyPromise;
    geographyPromise = (async () => {
      try {
        const response = await fetch("./counties-albers-10m.json", { cache: "force-cache" });
        if (!response.ok) throw new Error(`County boundary request failed (HTTP ${response.status}).`);
        const topology = await response.json();
        geography = {
          states: topojson.feature(topology, topology.objects.states).features,
          counties: topojson.feature(topology, topology.objects.counties).features,
          path: d3.geoPath(null),
        };
        const districtResponse = await fetch("./congressional-districts-119.geojson", { cache: "force-cache" });
        if (!districtResponse.ok) throw new Error(`Congressional district boundary request failed (HTTP ${districtResponse.status}).`);
        const districtData = await districtResponse.json();
        geography.districts = districtData.features;
        geography.districtPath = d3.geoPath(d3.geoAlbersUsa().scale(1300).translate([487.5, 305]));
        renderMap();
        return geography;
      } catch (error) {
        elements["election-map"].replaceChildren();
        const label = svgElement("text", "map-loading");
        label.setAttribute("x", "487.5");
        label.setAttribute("y", "305");
        label.setAttribute("text-anchor", "middle");
        label.textContent = error.message || "County boundary data could not be loaded.";
        elements["election-map"].append(label);
        return null;
      }
    })();
    return geographyPromise;
  }

  async function loadCurrentControl() {
    try {
      const response = await fetch("./current-control.json", { cache: "force-cache" });
      if (!response.ok) throw new Error(`Current-control roster request failed (HTTP ${response.status}).`);
      const roster = await response.json();
      const senatorCount = Object.values(roster.senate || {}).reduce((count, senators) => count + senators.length, 0);
      const governorCount = Object.keys(roster.governor || {}).length;
      const validParty = (party) => party === "D" || party === "R" || party === "O" || party == null;
      const validHouse = roster.house && Object.keys(roster.house).length === 435
        && Object.values(roster.house).every((member) => member.name && validParty(member.party));
      const validSenate = senatorCount === 100 && Object.values(roster.senate || {}).every((senators) =>
        senators.length === 2 && senators.every((senator) => senator.name && validParty(senator.party) && [1, 2, 3].includes(senator.class)));
      const validGovernors = governorCount === 50 && Object.values(roster.governor || {}).every((governor) =>
        governor.name && validParty(governor.party));
      if (!validHouse || !validSenate || !validGovernors || !roster.metadata?.asOf) {
        throw new Error("Current-control roster is incomplete: expected 435 House districts, 100 senators, and 50 governors.");
      }
      currentControl = roster;
      currentControlError = null;
    } catch (error) {
      currentControl = null;
      currentControlError = error.message || "Current-control roster could not be loaded.";
    }
    renderSeatTallies();
    renderMap();
    renderStateDetail();
    projectionRenderSignature = "";
    renderProjectionAnnouncements();
  }

  async function fetchDashboardJson(path, description) {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`${description} request failed (HTTP ${response.status}).`);
    return response.json();
  }

  function validCandidateList(candidates) {
    return Array.isArray(candidates) && candidates.length > 0 && candidates.every((candidate) =>
      typeof candidate.candidate === "string" && candidate.candidate.trim()
      && typeof candidate.party === "string" && candidate.party.trim()
      && ["D", "R", "O"].includes(candidate.partyCode));
  }

  async function loadCandidateRoster() {
    try {
      const roster = await fetchDashboardJson("./candidates-2026.json", "2026 candidate roster");
      const validHouse = roster.house && Object.keys(roster.house).length === 435
        && Object.entries(roster.house).every(([district, candidates]) =>
          /^[A-Z]{2}-(?:AL|\d{2})$/.test(district) && validCandidateList(candidates));
      const validSenate = roster.senate && Object.keys(roster.senate).length === 35
        && Object.values(roster.senate).every((race) =>
          [1, 2, 3].includes(race.class) && validCandidateList(race.candidates));
      const validGovernor = roster.governor && Object.keys(roster.governor).length === 36
        && !Object.hasOwn(roster.governor, "DC") && Object.values(roster.governor).every(validCandidateList);
      if (!validHouse || !validSenate || !validGovernor || !roster.asOf || !roster.metadata?.sourceLicense) {
        throw new Error("Roster is incomplete: expected 435 House, 35 Senate, and 36 gubernatorial contests with cited candidates.");
      }
      candidateRoster = roster;
      raceDataError = null;
    } catch (error) {
      candidateRoster = null;
      raceDataError = error.message || "2026 candidate roster could not be loaded.";
    }
    renderSeatTallies();
    renderMap();
    renderStateDetail();
    renderResults();
  }

  async function loadHistoricalResults() {
    try {
      const history = await fetchDashboardJson("./historical-results.json", "Historical results");
      const validRows = (races) => races && Object.values(races).every((race) =>
        Number.isInteger(race.year) && Array.isArray(race.candidates) && race.candidates.length > 0
        && race.candidates.every((candidate) => typeof candidate.candidate === "string"
          && Number.isSafeInteger(candidate.votes) && candidate.votes >= 0));
      const validHouse = history.house && Object.keys(history.house).length === 434
        && !Object.hasOwn(history.house, "MT-AL") && validRows(history.house);
      const validSenate = history.senate && Object.keys(history.senate).length === 35 && validRows(history.senate);
      const validGovernor = history.governor && Object.keys(history.governor).length === 36 && validRows(history.governor);
      if (!validHouse || !validSenate || !validGovernor || !history.metadata?.houseNoPriorContest?.includes("WI-08")) {
        throw new Error("Historical dataset is incomplete or contains invalid vote totals.");
      }
      historicalResults = history;
      historicalResultsError = null;
    } catch (error) {
      historicalResults = null;
      historicalResultsError = error.message || "Historical results could not be loaded.";
    }
    renderMap();
    renderStateDetail();
    renderResults();
  }

  function stopDemoAutoPlay() {
    if (demoTimer != null) window.clearInterval(demoTimer);
    demoTimer = null;
    elements["demo-auto"].textContent = "Auto-play";
    elements["demo-auto"].setAttribute("aria-pressed", "false");
  }

  function renderDemoStage(index) {
    if (!demoData) return;
    demoStageIndex = Math.max(0, Math.min(index, demoData.stages.length - 1));
    const stageDefinition = demoData.stages[demoStageIndex];
    const capturedAt = new Date(Date.parse(demoData.schedule.firstPollClose)
      + stageDefinition.minutesAfterFirstClose * 60_000).toISOString();
    const stage = buildDemoStage(stageDefinition, capturedAt);
    const rows = [];
    const sourceStatuses = new Map();
    for (const update of stage.updates) {
      const contest = update.contest;
      if (!contest || contest.candidates.length !== update.votes.length) {
        throw new Error(`Demo update "${contest?.key || "unknown"}" does not match its candidate roster.`);
      }
      const totalVotes = update.votes.reduce((sum, votes) => sum + votes, 0);
      const leaderIndex = update.votes.indexOf(Math.max(...update.votes));
      const leaderIsTied = update.votes.filter((votes) => votes === update.votes[leaderIndex]).length > 1;
      const leaderParty = leaderIsTied ? "" : contest.candidates[leaderIndex][2];
      for (const [candidateIndex, [candidate, party, partyCode]] of contest.candidates.entries()) {
        const votes = update.votes[candidateIndex];
        rows.push({
          state: contest.state,
          office: contest.office,
          race: contest.race,
          district: contest.district,
          seatClass: contest.seatClass,
          candidate,
          party,
          partyCode,
          votes,
          candidatePct: totalVotes ? votes / totalVotes * 100 : null,
          precinctsReportingPct: update.reporting,
          raceLeaderParty: leaderParty,
          raceWinner: update.winner || "",
          winnerDeclared: update.final === true && update.winner === candidate,
          feedTotalVotes: totalVotes,
          feedFinal: update.final === true,
          feedLive: true,
          feedStale: false,
          source: "Synthetic demo feed",
          sourceUrl: "",
          sourceAsOf: capturedAt,
          capturedAt,
          method: "documented-json-api",
          verificationRequired: false,
          demo: true,
          demoCallProbability: update.callDecision?.probability ?? null,
          demoCallReportingPct: update.callDecision?.reportingPct ?? null,
          demoCallMarginPct: update.callDecision?.marginPct ?? null,
          demoCallAt: update.callDecision?.calledAt || "",
          demoPollCloseAt: update.callDecision?.pollCloseAt || "",
          demoPollCloseMinutes: update.callDecision?.pollCloseMinutes ?? null,
        });
      }
      rows.push(...(update.countyRows || []));
      const status = sourceStatuses.get(contest.office) || {
        source: "Synthetic demo feed",
        office: contest.office,
        status: "reachable",
        live: true,
        counting: true,
        final: false,
        resultCount: 0,
        capturedAt,
        asOf: capturedAt,
      };
      status.resultCount += contest.candidates.length + (update.countyRows?.length || 0);
      sourceStatuses.set(contest.office, status);
    }
    if (!sourceStatuses.size) {
      sourceStatuses.set("Demo", {
        source: "Synthetic demo feed",
        status: "reachable",
        live: false,
        capturedAt,
      });
    }
    snapshot = {
      schemaVersion: 1,
      election: { year: 2026, date: "2026-11-03" },
      capturedAt,
      results: rows,
      sources: [...sourceStatuses.values()],
      discoveredResultLinks: [],
      racePriorities: priorityConfig,
      notices: ["DEMO ONLY: candidate totals, feed statuses, and Dalton calls are synthetic test data."],
    };
    trackNewResultAreas(snapshot);
    elements["demo-stage-label"].textContent = `Update ${demoStageIndex + 1} of ${demoData.stages.length} · ${formatDemoClock(stageDefinition.minutesAfterFirstClose)} ET · ${stage.label}`;
    const threshold = formatPercent(demoData.callModel.minimumWinProbability * 100);
    elements["demo-call-rule"].textContent = `Demo call trigger: this race's polls have closed and the illustrative model assigns a unique leader at least ${threshold} win probability. Calls are latched once made; this model is not used for live results.`;
    const progress = stage.countyProgress;
    const progressPct = progress.totalVotes ? Math.round(progress.reportedVotes / progress.totalVotes * 100) : 0;
    elements["demo-county-progress"].setAttribute("aria-valuenow", String(progressPct));
    elements["demo-county-progress"].setAttribute("aria-valuetext", `${progress.reported} of ${progress.total} active county-race units have started reporting; ${progressPct}% of expected votes reported`);
    elements["demo-county-progress-fill"].style.width = `${progressPct}%`;
    elements["demo-county-progress-label"].textContent = `${progressPct}%`;
    elements["demo-county-progress-note"].textContent = progress.total
      ? `${formatNumber(progress.reported)} of ${formatNumber(progress.total)} county-race units have started reporting across active Governor and Senate contests; vote-weighted progress is ${progressPct}%. Click a state to follow its county map.`
      : "No active statewide races are available for county reporting.";
    elements["demo-next"].disabled = demoStageIndex === demoData.stages.length - 1;
    renderSnapshot();
    renderMapAttribution();
  }

  function demoHash(value) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function formatDemoClock(minutesAfterFirstClose) {
    const date = new Date(Date.parse(demoData.schedule.firstPollClose) + minutesAfterFirstClose * 60_000);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: demoData.schedule.timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function allocateDemoShares(counties, targetShare, shareForCounty) {
    let low = -1;
    let high = 1;
    const totalWeight = counties.reduce((sum, county) => sum + county.weight, 0);
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const offset = (low + high) / 2;
      const weightedShare = counties.reduce((sum, county) =>
        sum + Math.max(0.01, Math.min(0.99, shareForCounty(county) + offset)) * county.weight, 0) / totalWeight;
      if (weightedShare < targetShare) low = offset;
      else high = offset;
    }
    const offset = (low + high) / 2;
    return new Map(counties.map((county) => [
      county.fips,
      Math.max(0.01, Math.min(0.99, shareForCounty(county) + offset)),
    ]));
  }

  function allocateDemoVotes(totalVotes, shares, salt) {
    const exactVotes = shares.map((share) => totalVotes * share);
    const allocated = exactVotes.map(Math.floor);
    const remainderOrder = exactVotes.map((votes, index) => ({
      index,
      remainder: votes - allocated[index],
      tieBreaker: demoHash(`${salt}\u0000${index}`),
    })).sort((left, right) => right.remainder - left.remainder || left.tieBreaker - right.tieBreaker);
    let remainingVotes = totalVotes - allocated.reduce((sum, votes) => sum + votes, 0);
    for (let index = 0; remainingVotes > 0; index += 1, remainingVotes -= 1) {
      allocated[remainderOrder[index].index] += 1;
    }
    return allocated;
  }

  function demoCandidateShares(candidates, demShare, otherShare, independentWinner = null) {
    const codes = candidates.map((candidate) => candidate.partyCode || partyCode(candidate.party) || "O");
    const shares = Array(candidates.length).fill(0);
    const otherIndexes = codes.map((code, index) => code === "O" ? index : -1).filter((index) => index >= 0);
    const democraticIndexes = codes.map((code, index) => code === "D" ? index : -1).filter((index) => index >= 0);
    const republicanIndexes = codes.map((code, index) => code === "R" ? index : -1).filter((index) => index >= 0);
    const majorIndexes = codes.map((code, index) => code === "O" ? -1 : index).filter((index) => index >= 0);
    const winnerIndex = independentWinner
      ? candidates.findIndex((candidate) => candidate.candidate === independentWinner.candidate)
      : -1;
    if (winnerIndex >= 0) shares[winnerIndex] = otherShare;
    else for (const index of otherIndexes) shares[index] = otherShare / Math.max(1, otherIndexes.length);
    const majorShare = 1 - shares.reduce((sum, share) => sum + share, 0);
    if (democraticIndexes.length && republicanIndexes.length) {
      for (const index of democraticIndexes) shares[index] = majorShare * demShare / democraticIndexes.length;
      for (const index of republicanIndexes) shares[index] = majorShare * (1 - demShare) / republicanIndexes.length;
    } else if (majorIndexes.length) {
      for (const index of majorIndexes) shares[index] = majorShare / majorIndexes.length;
    } else {
      for (const index of otherIndexes) shares[index] = 1 / Math.max(1, otherIndexes.length);
    }
    const totalShare = shares.reduce((sum, share) => sum + share, 0);
    return shares.map((share) => share / totalShare);
  }

  function demoCountyReportingFraction(elapsedMinutes, county, rank, countyCount, contestKey) {
    const hash = demoHash(`${contestKey}\u0000county-arrival\u0000${county.fips}`);
    const arrivalDelay = 5 + Math.round(rank * 27 / Math.max(1, countyCount - 1)) + hash % 9;
    const reportingDuration = 34 + Math.round(rank * 34 / Math.max(1, countyCount - 1)) + (hash >>> 8) % 20;
    if (elapsedMinutes <= arrivalDelay) return 0;
    return Math.min(1, (elapsedMinutes - arrivalDelay) / reportingDuration);
  }

  function demoCandidateReportingFraction(fraction, party) {
    const earlyBias = party === "R" ? 0.09 : party === "D" ? -0.09 : 0;
    return Math.max(0, Math.min(1, fraction + earlyBias * Math.sin(Math.PI * fraction)));
  }

  function demoWinProbability(marginPct, reportingPct) {
    const model = demoData.callModel;
    const unreportedShare = 1 - Math.max(0, Math.min(100, reportingPct)) / 100;
    const uncertainty = Math.sqrt(
      model.finalUncertaintyFloorPoints ** 2
      + (model.unreportedUncertaintyPoints * unreportedShare) ** 2,
    );
    const z = marginPct / uncertainty / Math.SQRT2;
    const absoluteZ = Math.abs(z);
    const t = 1 / (1 + 0.3275911 * absoluteZ);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-absoluteZ * absoluteZ);
    return Math.max(0, Math.min(1, 0.5 * (1 + Math.sign(z) * erf)));
  }

  function buildDemoStage(stage, capturedAt) {
    const minute = stage.minutesAfterFirstClose;
    const stateCloseTimes = demoData.schedule.pollCloseMinutesByState;
    const districtCloseTimes = demoData.schedule.houseDistrictCloseMinutes;
    const districtDefaults = demoData.schedule.houseDistrictDefaultMinutesByState;
    const contests = [];
    for (const [district, candidates] of Object.entries(candidateRoster.house)) {
      contests.push({ key: district, state: district.slice(0, 2), office: "House", race: district, district, candidates });
    }
    for (const [state, race] of Object.entries(candidateRoster.senate)) {
      contests.push({
        key: `${state}-SEN`,
        state,
        office: "Senate",
        race: `${state} Senate Class ${race.class}`,
        seatClass: race.class,
        candidates: race.candidates,
      });
    }
    for (const [state, candidates] of Object.entries(candidateRoster.governor)) {
      contests.push({ key: `${state}-GOV`, state, office: "Governor", race: `${state} Governor`, candidates });
    }
    const countiesByState = new Map();
    for (const feature of geography.counties) {
      const fips = String(feature.id).padStart(5, "0");
      const state = STATE_BY_FIPS[fips.slice(0, 2)];
      if (!state) continue;
      const baseline = demoCountyBaselines.counties[fips];
      if (!baseline || !Number.isFinite(baseline.turnout) || baseline.turnout <= 0
        || !Number.isFinite(baseline.votesDem) || !Number.isFinite(baseline.votesRep)) {
        throw new Error(`County baseline is missing or invalid for ${fips}.`);
      }
      const counties = countiesByState.get(state) || [];
      const twoPartyVotes = baseline.votesDem + baseline.votesRep;
      counties.push({
        fips,
        name: feature.properties?.name || "County",
        weight: baseline.turnout,
        turnout: baseline.turnout,
        demShare: twoPartyVotes ? baseline.votesDem / twoPartyVotes : 0.5,
      });
      countiesByState.set(state, counties);
    }
    const stateBaselines = new Map([...countiesByState.entries()].map(([state, counties]) => {
      const totalTurnout = counties.reduce((sum, county) => sum + county.turnout, 0);
      const demVotes = counties.reduce((sum, county) =>
        sum + county.turnout * county.demShare, 0);
      return [state, { turnout: totalTurnout, demShare: demVotes / totalTurnout }];
    }));
    const statewideContests = contests.filter((contest) => contest.office !== "House");
    const totalCountyRaces = statewideContests.reduce((sum, contest) =>
      sum + (countiesByState.get(contest.state)?.length || 0), 0);
    const eligibleContests = contests.filter((contest) => {
      const distinctCandidates = new Set(contest.candidates.map((candidate) =>
        `${candidateKeyForProjection(candidate.candidate)}\u0000${candidate.partyCode || partyCode(candidate.party) || "O"}`));
      return distinctCandidates.size >= 2;
    });
    const independentCandidates = eligibleContests.filter((contest) => contest.candidates
      .some((candidate) => (candidate.partyCode || partyCode(candidate.party)) === "O"));
    const independentWinnerCount = Math.min(
      Math.round(eligibleContests.length * demoData.callModel.independentWinnerShare),
      independentCandidates.length,
    );
    const independentWinnerCandidates = new Map(independentCandidates
      .sort((left, right) => demoHash(`${left.key}\u0000independent-winner`)
        - demoHash(`${right.key}\u0000independent-winner`))
      .slice(0, independentWinnerCount)
      .map((contest) => {
        const candidate = contest.candidates.filter((entry) =>
          (entry.partyCode || partyCode(entry.party)) === "O")
          .sort((left, right) => demoHash(`${contest.key}\u0000independent-candidate\u0000${left.candidate}`)
            - demoHash(`${contest.key}\u0000independent-candidate\u0000${right.candidate}`))[0];
        return [contest.key, candidate];
      }));
    const updates = [];
    let reportedCountyRaces = 0;
    let totalExpectedVotes = 0;
    let totalReportedVotes = 0;
    for (const contest of contests) {
      if (!contest.candidates?.length) continue;
      const closeMinutes = contest.office === "House"
        ? districtCloseTimes[contest.district] ?? districtDefaults[contest.state] ?? stateCloseTimes[contest.state]
        : stateCloseTimes[contest.state];
      if (!Number.isFinite(closeMinutes)) {
        throw new Error(`Poll-close time is missing for ${contest.district || contest.state}.`);
      }
      if (minute < closeMinutes) continue;
      const hash = demoHash(contest.key);
      const independentWinnerCandidate = independentWinnerCandidates.get(contest.key) || null;
      const independentWinner = independentWinnerCandidate != null;
      const otherShare = independentWinner ? 0.57 : 0.035;
      const stateBaseline = stateBaselines.get(contest.state);
      if (!stateBaseline) throw new Error(`County baselines are unavailable for ${contest.state}.`);
      const swing = ((hash >>> 8) % 2601) / 10_000 - 0.13;
      const targetDemShare = independentWinner
        ? 0.5
        : Math.max(0.08, Math.min(0.92, stateBaseline.demShare + swing));
      const expectedFinalVotes = Array(contest.candidates.length).fill(0);
      const reportedVotes = Array(contest.candidates.length).fill(0);
      let reportingPct = 0;
      let contestExpectedVotes = 0;
      let countyRows = [];
      const countyProfiles = contest.office === "House" ? [] : [...(countiesByState.get(contest.state) || [])]
        .sort((left, right) => left.weight - right.weight || left.fips.localeCompare(right.fips));
      if (contest.office !== "House" && !countyProfiles.length) {
        throw new Error(`County boundaries are missing for active ${contest.state} ${contest.office} race.`);
      }
      const expectedShares = contest.office === "House"
        ? null
        : allocateDemoShares(countyProfiles, targetDemShare, (county) => county.demShare);
      const noiseForCounty = (county) =>
        (((demoHash(`${contest.key}\u0000county-lean\u0000${county.fips}`) % 2001) - 1000) / 1000) * 0.025;
      const actualShares = contest.office === "House"
        ? null
        : allocateDemoShares(countyProfiles, targetDemShare, (county) => county.demShare + noiseForCounty(county));
      if (contest.office !== "House") {
        for (const [rank, county] of countyProfiles.entries()) {
          const turnoutMultiplier = 0.8 + (demoHash(`${contest.key}\u0000turnout\u0000${county.fips}`) % 41) / 100;
          const countyBallots = Math.max(1, Math.round(county.turnout * DEMO_MIDTERM_TURNOUT_SHARE * turnoutMultiplier));
          const expectedVotes = allocateDemoVotes(countyBallots,
            demoCandidateShares(contest.candidates, expectedShares.get(county.fips), otherShare, independentWinnerCandidate),
            `${contest.key}\u0000expected\u0000${county.fips}`);
          const finalVotes = allocateDemoVotes(countyBallots,
            demoCandidateShares(contest.candidates, actualShares.get(county.fips), otherShare, independentWinnerCandidate),
            `${contest.key}\u0000actual\u0000${county.fips}`);
          expectedVotes.forEach((votes, index) => { expectedFinalVotes[index] += votes; });
          const baseFraction = demoCountyReportingFraction(minute - closeMinutes, county, rank, countyProfiles.length, contest.key);
          if (baseFraction <= 0) continue;
          reportedCountyRaces += 1;
          const countyReportedVotes = [];
          for (const [candidateIndex, candidate] of contest.candidates.entries()) {
            const code = candidate.partyCode || partyCode(candidate.party) || "O";
            const fraction = demoCandidateReportingFraction(baseFraction, code);
            const votes = Math.min(finalVotes[candidateIndex], Math.floor(finalVotes[candidateIndex] * fraction));
            reportedVotes[candidateIndex] += votes;
            countyReportedVotes.push(votes);
          }
          const countyTotal = countyReportedVotes.reduce((sum, votes) => sum + votes, 0);
          const countyLeaderVote = Math.max(...countyReportedVotes);
          const countyLeaderIndexes = countyReportedVotes
            .map((votes, candidateIndex) => votes === countyLeaderVote ? candidateIndex : -1)
            .filter((candidateIndex) => candidateIndex >= 0);
          const countyLeaderParty = countyLeaderIndexes.length === 1
            ? contest.candidates[countyLeaderIndexes[0]].partyCode || ""
            : "";
          for (const [candidateIndex, candidate] of contest.candidates.entries()) {
            const votes = countyReportedVotes[candidateIndex];
            countyRows.push({
              state: contest.state,
              office: contest.office,
              race: contest.race,
              seatClass: contest.seatClass,
              county: county.name,
              countyFips: county.fips,
              candidate: candidate.candidate,
              party: candidate.party,
              partyCode: candidate.partyCode,
              votes,
              candidatePct: countyTotal ? votes / countyTotal * 100 : null,
              precinctsReportingPct: baseFraction * 100,
              raceLeaderParty: countyLeaderParty,
              raceWinner: "",
              winnerDeclared: false,
              feedTotalVotes: countyTotal,
              feedFinal: false,
              feedLive: true,
              feedStale: false,
              source: "Synthetic demo feed",
              sourceUrl: "",
              sourceAsOf: capturedAt,
              capturedAt,
              method: "documented-json-api",
              verificationRequired: false,
              reportingUnitType: "county",
              demo: true,
            });
          }
        }
        contestExpectedVotes = expectedFinalVotes.reduce((sum, votes) => sum + votes, 0);
      } else {
        const districtCount = Math.max(1, Object.keys(candidateRoster.house)
          .filter((district) => district.startsWith(`${contest.state}-`)).length);
        const turnoutMultiplier = 0.8 + (hash % 41) / 100;
        const districtBallots = Math.max(1, Math.round(
          stateBaseline.turnout / districtCount * DEMO_MIDTERM_TURNOUT_SHARE * turnoutMultiplier,
        ));
        const expectedSharesForContest = demoCandidateShares(contest.candidates, targetDemShare, otherShare, independentWinnerCandidate);
        const outcomeShare = Math.max(0.01, Math.min(0.99, targetDemShare + (((hash >>> 12) % 401) - 200) / 10_000));
        const actualSharesForContest = demoCandidateShares(contest.candidates, outcomeShare, otherShare, independentWinnerCandidate);
        expectedFinalVotes.splice(0, expectedFinalVotes.length,
          ...allocateDemoVotes(districtBallots, expectedSharesForContest, `${contest.key}\u0000expected`));
        const finalVotes = allocateDemoVotes(districtBallots, actualSharesForContest, `${contest.key}\u0000actual`);
        contestExpectedVotes = districtBallots;
        const elapsed = minute - closeMinutes;
        const arrivalDelay = 4 + hash % 12;
        const reportingDuration = 95 + (hash >>> 8) % 45;
        const fraction = elapsed <= arrivalDelay ? 0 : Math.min(1, (elapsed - arrivalDelay) / reportingDuration);
        for (const [candidateIndex, candidate] of contest.candidates.entries()) {
          const code = candidate.partyCode || partyCode(candidate.party) || "O";
          const reportedFraction = demoCandidateReportingFraction(fraction, code);
          reportedVotes[candidateIndex] = Math.min(finalVotes[candidateIndex],
            Math.floor(finalVotes[candidateIndex] * reportedFraction));
        }
        reportingPct = contestExpectedVotes
          ? reportedVotes.reduce((sum, votes) => sum + votes, 0) / contestExpectedVotes * 100
          : 0;
      }
      const expectedVotesTotal = expectedFinalVotes.reduce((sum, votes) => sum + votes, 0);
      const reportedTotal = reportedVotes.reduce((sum, votes) => sum + votes, 0);
      if (contest.office !== "House") {
        reportingPct = expectedVotesTotal ? reportedTotal / expectedVotesTotal * 100 : 0;
        totalExpectedVotes += expectedVotesTotal;
        totalReportedVotes += reportedTotal;
      }
      const forecastVotes = reportedVotes.map((votes, index) =>
        votes + Math.max(0, expectedFinalVotes[index] - votes));
      const forecastOrder = forecastVotes.map((votes, index) => ({ votes, index }))
        .sort((left, right) => right.votes - left.votes);
      const forecastTotal = forecastVotes.reduce((sum, votes) => sum + votes, 0);
      const marginPct = forecastTotal && forecastOrder.length > 1
        ? (forecastOrder[0].votes - forecastOrder[1].votes) / forecastTotal * 100
        : 0;
      let callDecision = demoCallDecisions.get(contest.key) || null;
      const probability = demoWinProbability(marginPct, reportingPct);
      if (!callDecision && reportingPct > 0 && probability >= demoData.callModel.minimumWinProbability) {
        const winner = contest.candidates[forecastOrder[0].index];
        callDecision = {
          candidate: winner.candidate,
          probability,
          reportingPct,
          marginPct,
          calledAt: `${formatDemoClock(minute)} ET`,
          pollCloseAt: `${formatDemoClock(closeMinutes)} ET`,
          pollCloseMinutes: closeMinutes,
        };
        demoCallDecisions.set(contest.key, callDecision);
      }
      if (callDecision) {
        const winnerIndex = contest.candidates.findIndex((candidate) =>
          candidateKeyForProjection(candidate.candidate) === candidateKeyForProjection(callDecision.candidate));
        if (winnerIndex < 0) throw new Error(`Latched demo call candidate is missing from ${contest.key}.`);
      }
      const votes = reportedVotes;
      const totalVotes = votes.reduce((sum, count) => sum + count, 0);
      const leaderIndex = votes.indexOf(Math.max(...votes));
      const leaderIsTied = votes.filter((count) => count === votes[leaderIndex]).length > 1;
      const winner = callDecision?.candidate || "";
      updates.push({
        contest: {
          ...contest,
          candidates: contest.candidates.map((candidate) => [candidate.candidate, candidate.party, candidate.partyCode]),
        },
        votes,
        reporting: Math.max(0, Math.min(100, reportingPct)),
        leaderParty: leaderIsTied || totalVotes === 0 ? "" : contest.candidates[leaderIndex].partyCode || "",
        final: Boolean(callDecision),
        winner,
        countyRows,
        callDecision: callDecision ? {
          ...callDecision,
          probability: Math.max(callDecision.probability, demoData.callModel.minimumWinProbability),
          reportingPct: callDecision.reportingPct,
        } : null,
      });
    }
    return {
      label: stage.label,
      updates,
      countyProgress: {
        reported: reportedCountyRaces,
        total: totalCountyRaces,
        reportedVotes: totalReportedVotes,
        totalVotes: totalExpectedVotes,
      },
    };
  }

  function advanceDemoStage(index) {
    const previousIndex = demoStageIndex;
    try {
      renderDemoStage(index);
      return true;
    } catch (error) {
      demoStageIndex = previousIndex;
      stopDemoAutoPlay();
      const message = error.message || "Synthetic demo results could not be generated.";
      console.error("Synthetic demo update failed.", error);
      elements["demo-stage-label"].textContent = `Demo update failed: ${message}`;
      elements["connection-status"].classList.remove("connected");
      elements["connection-status"].classList.add("error");
      elements["connection-label"].textContent = "Demo update failed";
      elements["demo-next"].disabled = true;
      elements["demo-auto"].disabled = true;
      return false;
    }
  }

  async function loadDemoData() {
    elements["demo-controls"].hidden = false;
    try {
      if (!candidateRoster) throw new Error(raceDataError || "2026 candidate roster must load before the demo.");
      demoData = await fetchDashboardJson("./demo-trickle.json", "Synthetic trickle demo");
      const stageTimes = demoData.stages?.map((stage) => stage.minutesAfterFirstClose);
      if (demoData.schemaVersion !== 4 || !Array.isArray(stageTimes) || stageTimes.length < 30
        || stageTimes.some((minute, index) => !Number.isInteger(minute) || minute < 0
          || index > 0 && minute <= stageTimes[index - 1])
        || stageTimes[0] !== 0 || stageTimes.at(-1) < 420) {
        throw new Error("Demo fixture is incomplete: expected 30 or more chronologically ordered simulation stages.");
      }
      const schedule = demoData.schedule;
      const callModel = demoData.callModel;
      if (schedule?.timeZone !== "America/New_York" || !Number.isFinite(Date.parse(schedule.firstPollClose))
        || !schedule.pollCloseMinutesByState || !schedule.houseDistrictCloseMinutes
        || !schedule.houseDistrictDefaultMinutesByState
        || !Number.isFinite(callModel?.minimumWinProbability) || callModel.minimumWinProbability <= 0.5
        || callModel.minimumWinProbability >= 1 || !Number.isFinite(callModel.unreportedUncertaintyPoints)
        || callModel.unreportedUncertaintyPoints <= 0 || !Number.isFinite(callModel.finalUncertaintyFloorPoints)
        || callModel.finalUncertaintyFloorPoints <= 0 || !Number.isFinite(callModel.independentWinnerShare)
        || callModel.independentWinnerShare < 0 || callModel.independentWinnerShare > 1) {
        throw new Error("Demo fixture has an invalid poll-close schedule or illustrative call model.");
      }
      for (const state of [...Object.keys(candidateRoster.senate), ...Object.keys(candidateRoster.governor)]) {
        if (!Number.isFinite(schedule.pollCloseMinutesByState[state])) {
          throw new Error(`Demo poll-close schedule is missing ${state}.`);
        }
      }
      for (const [district, closeMinutes] of Object.entries(schedule.houseDistrictCloseMinutes)) {
        if (!Object.hasOwn(candidateRoster.house, district) || !Number.isFinite(closeMinutes)) {
          throw new Error(`Demo poll-close exception is invalid for ${district}.`);
        }
      }
      for (const [state, closeMinutes] of Object.entries(schedule.houseDistrictDefaultMinutesByState)) {
        if (!Number.isFinite(closeMinutes) || !Object.keys(candidateRoster.house).some((district) => district.startsWith(`${state}-`))) {
          throw new Error(`Demo House district poll-close default is invalid for ${state}.`);
        }
      }
      demoCountyBaselines = await fetchDashboardJson("./demo-county-baselines.json", "Synthetic county baselines");
      if (demoCountyBaselines.schemaVersion !== 1 || demoCountyBaselines.electionYear !== 2024
        || demoCountyBaselines.source?.license !== "MIT"
        || !demoCountyBaselines.counties || Object.keys(demoCountyBaselines.counties).length < 3_000
        || !Number.isInteger(demoCountyBaselines.estimatedCountyCount)
        || demoCountyBaselines.estimatedCountyCount < 0) {
        throw new Error("County baseline data is incomplete or its source attribution is invalid.");
      }
      if (!Object.keys(priorityConfig).length) {
        const config = await fetchDashboardJson("../config/sources.json", "Race priority configuration");
        priorityConfig = config.race_priorities || {};
      }
      await loadGeography();
      if (!geography?.counties?.length) {
        throw new Error("County geography could not be loaded, so county-level demo results are unavailable.");
      }
      const geographyFips = new Set(geography.counties.map((feature) => String(feature.id).padStart(5, "0")));
      const baselineFips = new Set(Object.keys(demoCountyBaselines.counties));
      if (geographyFips.size !== baselineFips.size
        || [...geographyFips].some((fips) => !baselineFips.has(fips))) {
        throw new Error("County baselines do not match the dashboard's county map geography.");
      }
      renderDemoStage(0);
    } catch (error) {
      elements["demo-stage-label"].textContent = error.message || "Synthetic demo data could not be loaded.";
      elements["demo-next"].disabled = true;
      elements["demo-auto"].disabled = true;
      elements["demo-reset"].disabled = true;
      elements["connection-status"].classList.remove("connected");
      elements["connection-status"].classList.add("error");
      elements["connection-label"].textContent = "Demo unavailable";
    }
  }

  async function refresh() {
    if (DEMO_MODE) {
      if (!demoData) await loadDemoData();
      await loadNationalPolling();
      return;
    }
    try {
      if (!Object.keys(priorityConfig).length) {
        const configResponse = await fetch(`../config/sources.json?t=${Date.now()}`, { cache: "no-store" });
        if (!configResponse.ok) throw new Error(`Priority race configuration request failed (HTTP ${configResponse.status}).`);
        const config = await configResponse.json();
        priorityConfig = config.race_priorities || {};
        renderMapAttribution();
        renderMap();
      }
      const response = await fetch(`../data/latest.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "No data/latest.json yet. Run the collector once to create the first snapshot." : `Snapshot request failed (HTTP ${response.status}).`);
      const nextSnapshot = await response.json();
      if (!nextSnapshot || !Array.isArray(nextSnapshot.results) || !Array.isArray(nextSnapshot.sources)) {
        throw new Error("Snapshot format is invalid: expected results and sources arrays.");
      }
      trackNewResultAreas(nextSnapshot);
      snapshot = nextSnapshot;
      await loadNationalPolling();
      renderSnapshot();
    } catch (error) {
      elements["connection-status"].classList.remove("connected");
      elements["connection-status"].classList.add("error");
      elements["connection-label"].textContent = error.message || "Unable to load snapshot";
      if (!snapshot) {
        elements["captured-at"].textContent = "No data available";
        elements["states-count"].textContent = "0";
        elements["results-count"].textContent = "0";
        elements["verify-count"].textContent = "0";
        renderMap();
        renderResults();
        renderSources();
      }
      await loadNationalPolling();
    }
  }

  elements["state-filter"].addEventListener("change", renderMap);
  elements["office-filter"].addEventListener("change", renderResults);
  elements["watched-only-toggle"].addEventListener("change", renderResults);
  elements["results-state-filter"].addEventListener("change", () => {
    const state = elements["results-state-filter"].value;
    if (state !== "all") {
      selectState(state);
      return;
    }
    selectedState = null;
    selectedCounty = null;
    selectedDistrict = null;
    elements["state-filter"].value = "all";
    renderMap();
    renderStateDetail();
    renderResults();
  });
  elements["map-mode"].addEventListener("change", () => {
    selectedState = null;
    selectedCounty = null;
    selectedDistrict = null;
    elements["state-filter"].value = "all";
    syncResultsStateFilter();
    renderProjectionAnnouncements();
    renderMap();
    renderStateDetail();
    renderResults();
  });
  elements["demo-next"].addEventListener("click", () => {
    stopDemoAutoPlay();
    advanceDemoStage(demoStageIndex + 1);
  });
  elements["demo-reset"].addEventListener("click", () => {
    stopDemoAutoPlay();
    resetMajorityAlerts();
    demoCallDecisions.clear();
    knownProjectionIds.clear();
    knownCallKeys.clear();
    projectionBaselineEstablished = false;
    projectionRenderSignature = "";
    resultBaselineEstablished = false;
    previousResultFingerprints.clear();
    unseenResultAreas.states.clear();
    unseenResultAreas.counties.clear();
    unseenResultAreas.districts.clear();
    advanceDemoStage(0);
  });
  elements["demo-results-view"].addEventListener("click", () => {
    elements["map-mode"].value = "results";
    selectedState = null;
    selectedCounty = null;
    selectedDistrict = null;
    syncResultsStateFilter();
    renderProjectionAnnouncements();
    renderMap();
    renderStateDetail();
    renderResults();
  });
  elements["demo-control-view"].addEventListener("click", () => {
    elements["map-mode"].value = "control";
    selectedState = null;
    selectedCounty = null;
    selectedDistrict = null;
    syncResultsStateFilter();
    renderProjectionAnnouncements();
    renderMap();
    renderStateDetail();
    renderResults();
  });
  elements["demo-auto"].addEventListener("click", () => {
    if (demoTimer != null) {
      stopDemoAutoPlay();
      return;
    }
    elements["demo-auto"].textContent = "Pause";
    elements["demo-auto"].setAttribute("aria-pressed", "true");
    demoTimer = window.setInterval(() => {
      if (demoStageIndex >= demoData.stages.length - 1) {
        stopDemoAutoPlay();
        return;
      }
      if (!advanceDemoStage(demoStageIndex + 1)) return;
      if (demoStageIndex === demoData.stages.length - 1) stopDemoAutoPlay();
    }, DEMO_STEP_MS);
  });
  const themes = {
    classic: { className: "", color: "#10141d" },
    sakura: { className: "sakura-theme", color: "#1a111d" },
    orchid: { className: "orchid-theme", color: "#171023" },
    america: { className: "america-theme", color: "#101b2d" },
    mizu: { className: "mizu-theme", color: "#0d1e22" },
  };
  function applyTheme(themeName, persist = false) {
    if (!Object.prototype.hasOwnProperty.call(themes, themeName)) {
      console.warn(`Unknown dashboard theme "${themeName}"; using Classic.`);
      themeName = "classic";
    }
    document.body.classList.remove("sakura-theme", "orchid-theme", "america-theme", "mizu-theme");
    const theme = themes[themeName];
    if (theme.className) document.body.classList.add(theme.className);
    elements["theme-select"].value = themeName;
    document.querySelector('meta[name="theme-color"]').setAttribute("content", theme.color);
    if (persist) {
      try {
        window.localStorage.setItem("dalton-election-theme", themeName);
      } catch (error) {
        console.error("Dashboard theme preference could not be saved.", error);
      }
    }
  }
  let savedTheme = "classic";
  try {
    savedTheme = window.localStorage.getItem("dalton-election-theme") || "classic";
  } catch (error) {
    console.error("Dashboard theme preference could not be loaded.", error);
  }
  applyTheme(savedTheme);
  elements["theme-select"].addEventListener("change", () => applyTheme(elements["theme-select"].value, true));
  elements["majority-alert-dismiss"].addEventListener("click", dismissMajorityAlert);
  window.addEventListener("keydown", (event) => {
    if (!activeMajorityAlert) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismissMajorityAlert();
    } else if (event.key === "Tab") {
      event.preventDefault();
      elements["majority-alert-dismiss"].focus();
    }
  });
  elements["call-alert-toggle"].addEventListener("click", toggleCallAlerts);
  updateCallAlertControl();
  elements["zoom-in"].addEventListener("click", () => zoomAtCenter(1.25));
  elements["zoom-out"].addEventListener("click", () => zoomAtCenter(0.8));
  elements["zoom-reset"].addEventListener("click", () => {
    mapScale = 1;
    mapTranslateX = 0;
    mapTranslateY = 0;
    updateZoom();
  });
  elements["election-map"].addEventListener("wheel", (event) => {
    event.preventDefault();
    const svg = elements["election-map"];
    const bounds = svg.getBoundingClientRect();
    const box = mapViewBox();
    const anchorX = box.x + ((event.clientX - bounds.left) / bounds.width) * box.width;
    const anchorY = box.y + ((event.clientY - bounds.top) / bounds.height) * box.height;
    setMapScale(mapScale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), anchorX, anchorY);
  }, { passive: false });
  elements["election-map"].addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, translateX: mapTranslateX, translateY: mapTranslateY, moved: false };
    elements["election-map"].classList.add("is-panning");
  });
  window.addEventListener("pointermove", (event) => {
    if (!pointerStart) return;
    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    if (!pointerStart.moved && Math.hypot(deltaX, deltaY) < 4) return;
    pointerStart.moved = true;
    const bounds = elements["election-map"].getBoundingClientRect();
    const box = mapViewBox();
    mapTranslateX = pointerStart.translateX + (deltaX / bounds.width * box.width) / mapScale;
    mapTranslateY = pointerStart.translateY + (deltaY / bounds.height * box.height) / mapScale;
    clampMapTranslation();
    updateZoom();
  });
  window.addEventListener("pointerup", () => {
    if (!pointerStart) return;
    suppressMapClick = pointerStart.moved;
    pointerStart = null;
    elements["election-map"].classList.remove("is-panning");
    if (suppressMapClick) window.setTimeout(() => { suppressMapClick = false; }, 0);
  });
  elements["election-map"].addEventListener("click", (event) => {
    if (!suppressMapClick) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressMapClick = false;
  }, true);
  elements["race-view"].addEventListener("change", () => {
    selectedState = null;
    selectedCounty = null;
    selectedDistrict = null;
    elements["state-filter"].value = "all";
    syncResultsStateFilter();
    renderProjectionAnnouncements();
    renderMap();
    renderStateDetail();
    renderResults();
    renderNationalPolling();
  });
  elements["clear-state"].addEventListener("click", () => {
    selectedState = null;
    selectedCounty = null;
    selectedDistrict = null;
    syncResultsStateFilter();
    renderMap();
    renderStateDetail();
    renderResults();
  });
  elements["map-back"].addEventListener("click", () => {
    if (selectedRace() === "House") {
      selectedDistrict = null;
      selectedState = null;
    } else if (selectedCounty) selectedCounty = null;
    else selectedState = null;
    syncResultsStateFilter();
    renderMap();
    renderStateDetail();
    renderResults();
  });

  loadWatchedRaces();
  populateResultsStateFilter();
  renderResults();
  renderStateDetail();
  updateZoom();
  loadGeography();
  loadHistoricalResults();
  loadCandidatePhotoIndex();
  if (DEMO_MODE) {
    Promise.all([loadCurrentControl(), loadCandidateRoster(), loadNationalPolling()]).then(loadDemoData);
  } else {
    loadCurrentControl();
    loadCandidateRoster();
    refresh();
    window.setInterval(refresh, REFRESH_MS);
  }
})();
