"""Fetch feeds, inspect state result pages, and write a normalized snapshot."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import requests

from .media import (
    GOOGLE_NEWS_DOCS_URL,
    VOTEHUB_API_URL,
    VOTEHUB_DOCS_URL,
    google_news_rss_url,
    latest_votehub_polls,
    normalize_votehub_polls,
    parse_google_news_rss,
)
from .normalize import normalize_open_america, parse_html_result_tables, partition_precinct_results, utc_now
from .state_pages import discover_result_links, inspect_state_page, is_target_election_link, parse_machine_file
from .storage import write_snapshot

LOGGER = logging.getLogger("election_watch")
USER_AGENT = "ElectionNightMagicWall/0.1 (personal results display; respectful polling)"
MAX_PAGE_BYTES = 12 * 1024 * 1024
MAX_DISCOVERED_FILES_PER_STATE = 2
MAX_DISCOVERED_RESULT_PAGES_PER_STATE = 2


class Watcher:
    def __init__(self, config_path: Path, output_dir: Path) -> None:
        self.config_path = config_path
        self.output_dir = output_dir
        self.config = json.loads(config_path.read_text(encoding="utf-8"))
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/html,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.5",
            "Accept-Encoding": "gzip, deflate",
        })
        self.cache: dict[str, tuple[bytes, dict[str, str]]] = {}
        self.media_cache: dict[str, tuple[float, str, Any]] = {}

    def _priority_reasons(self, state: str) -> list[str]:
        priorities = self.config.get("race_priorities", {})
        reasons = [
            office
            for office, states in priorities.get("statewide_offices", {}).items()
            if state in states
        ]
        for rating, districts in priorities.get("house_races", {}).items():
            if any(district.startswith(f"{state}-") for district in districts):
                reasons.append(f"House ({rating})")
        return reasons

    def _get(self, url: str) -> tuple[bytes, dict[str, str], int]:
        headers: dict[str, str] = {}
        cached = self.cache.get(url)
        if cached:
            if cached[1].get("ETag"):
                headers["If-None-Match"] = cached[1]["ETag"]
            if cached[1].get("Last-Modified"):
                headers["If-Modified-Since"] = cached[1]["Last-Modified"]
        response = self.session.get(url, headers=headers, timeout=(8, 25), allow_redirects=True, stream=True)
        if response.status_code == 304 and cached:
            response.close()
            return cached[0], cached[1], 304
        response.raise_for_status()
        body = bytearray()
        for chunk in response.iter_content(64 * 1024):
            body.extend(chunk)
            if len(body) > MAX_PAGE_BYTES:
                response.close()
                raise ValueError(f"Response exceeds {MAX_PAGE_BYTES} bytes: {url}")
        response_headers = dict(response.headers)
        response.close()
        content = bytes(body)
        self.cache[url] = (content, response_headers)
        return content, response_headers, 200

    def _open_america(self, captured_at: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        settings = self.config.get("open_america", {})
        if not settings.get("enabled", False):
            return [], []
        results: list[dict[str, Any]] = []
        statuses: list[dict[str, Any]] = []
        for office in settings.get("offices", ["House", "Senate", "Governor"]):
            url = settings["base_url"]
            try:
                content, headers, http_status = self._get(url + f"?year={self.config['election']['year']}&office={office}")
                payload = json.loads(content)
                normalized, status = normalize_open_america(payload, office, captured_at)
                status.update({"httpStatus": http_status, "etag": headers.get("ETag")})
                results.extend(normalized)
                statuses.append(status)
            except Exception as error:
                LOGGER.warning("Open America %s request failed: %s", office, error)
                statuses.append({"source": "Open America", "office": office, "status": "error", "error": str(error), "capturedAt": captured_at})
        return results, statuses

    def _state_pages(self, captured_at: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        results: list[dict[str, Any]] = []
        statuses: list[dict[str, Any]] = []
        all_discoveries: list[dict[str, Any]] = []
        precinct_results: list[dict[str, Any]] = []
        for page in self.config.get("state_pages", []):
            state_results: list[dict[str, Any]] = []
            state_precinct_results: list[dict[str, Any]] = []
            discoveries: list[dict[str, str]] = []
            priority_reasons = self._priority_reasons(page["state"])
            status: dict[str, Any] = {
                "source": page["name"],
                "state": page["state"],
                "priority": bool(priority_reasons or page.get("priority")),
                "priorityReasons": priority_reasons,
                "sourceUrl": page["results_page"],
                "capturedAt": captured_at,
            }
            if page.get("source_note"):
                status["sourceNote"] = page["source_note"]
            try:
                html, headers, http_status = self._get(page["results_page"])
                page_results, page_links = inspect_state_page(page, html, captured_at=captured_at)
                aggregate_rows, precinct_rows = partition_precinct_results(page_results)
                state_results.extend(aggregate_rows)
                state_precinct_results.extend(precinct_rows)
                discoveries.extend(page_links)
                same_host = lambda link: urlparse(link["url"]).hostname == urlparse(page["results_page"]).hostname
                result_pages = [
                    link for link in page_links
                    if link["kind"] == "linked-page" and same_host(link)
                    and is_target_election_link(link, self.config["election"]["year"])
                ][:MAX_DISCOVERED_RESULT_PAGES_PER_STATE]
                for link in result_pages:
                    try:
                        linked_html, linked_headers, linked_status = self._get(link["url"])
                        content_type = linked_headers.get("Content-Type", "").lower()
                        if content_type and not ("text/html" in content_type or "application/xhtml+xml" in content_type):
                            link["fetchStatus"] = str(linked_status)
                            link["fetchError"] = f"Linked result page is not HTML ({content_type})."
                            continue
                        linked_results = parse_html_result_tables(
                            linked_html,
                            state=page["state"],
                            source_name=f"{page['name']} linked results page",
                            source_url=link["url"],
                            captured_at=captured_at,
                        )
                        aggregate_rows, precinct_rows = partition_precinct_results(linked_results)
                        state_results.extend(aggregate_rows)
                        state_precinct_results.extend(precinct_rows)
                        link["fetchStatus"] = str(linked_status)
                        link["parsedRows"] = str(len(linked_results))
                        for child in discover_result_links(linked_html, link["url"]):
                            if child["url"] not in {existing["url"] for existing in discoveries}:
                                child["electionYearContext"] = str(self.config["election"]["year"])
                                discoveries.append(child)
                    except Exception as error:
                        link["fetchError"] = str(error)
                same_host_files = [
                    link for link in discoveries
                    if link["kind"] == "machine-readable-file" and same_host(link)
                    and is_target_election_link(link, self.config["election"]["year"])
                ]
                for link in same_host_files[:MAX_DISCOVERED_FILES_PER_STATE]:
                    try:
                        content, _, file_status = self._get(link["url"])
                        file_results = parse_machine_file(content, link["url"], state=page["state"], source_name=f"{page['name']} official results file", captured_at=captured_at)
                        aggregate_rows, precinct_rows = partition_precinct_results(file_results)
                        state_results.extend(aggregate_rows)
                        state_precinct_results.extend(precinct_rows)
                        link["fetchStatus"] = str(file_status)
                        link["parsedRows"] = str(len(file_results))
                    except Exception as error:
                        link["fetchError"] = str(error)
                status.update({
                    "status": "reachable",
                    "httpStatus": http_status,
                    "etag": headers.get("ETag"),
                    "lastModified": headers.get("Last-Modified"),
                    "resultCount": len(state_results) + len(state_precinct_results),
                    "precinctResultCount": len(state_precinct_results),
                    "discoveredLinkCount": len(discoveries),
                    "linkedResultPagesChecked": len(result_pages),
                    "resultFilesChecked": min(len(same_host_files), MAX_DISCOVERED_FILES_PER_STATE),
                    "priority": bool(priority_reasons or page.get("priority")),
                    "priorityReasons": priority_reasons,
                })
            except Exception as error:
                LOGGER.warning("%s page request failed: %s", page["state"], error)
                response = getattr(error, "response", None)
                status.update({
                    "status": "error",
                    "httpStatus": getattr(response, "status_code", None),
                    "error": str(error),
                    "resultCount": len(state_results) + len(state_precinct_results),
                    "precinctResultCount": len(state_precinct_results),
                })
            results.extend(state_results)
            precinct_results.extend(state_precinct_results)
            statuses.append(status)
            for link in discoveries:
                all_discoveries.append({"state": page["state"], "stateName": page["name"], **link})
        return results, statuses, all_discoveries, precinct_results

    def _cached_media(
        self,
        key: str,
        url: str,
        refresh_seconds: int,
        parser: Any,
        captured_at: str,
    ) -> tuple[Any, dict[str, Any]]:
        now = time.monotonic()
        cached = self.media_cache.get(key)
        if cached and now - cached[0] < refresh_seconds:
            return cached[2], {"status": "cached", "fetchedAt": cached[1]}

        try:
            content, headers, http_status = self._get(url)
            parsed = parser(content)
            self.media_cache[key] = (now, captured_at, parsed)
            return parsed, {
                "status": "reachable",
                "httpStatus": http_status,
                "etag": headers.get("ETag"),
                "fetchedAt": captured_at,
            }
        except Exception as error:
            LOGGER.warning("Media source request failed (%s): %s", key, error)
            if cached:
                return cached[2], {
                    "status": "stale",
                    "fetchedAt": cached[1],
                    "error": str(error),
                }
            return [], {"status": "error", "fetchedAt": captured_at, "error": str(error)}

    def _media(self, captured_at: str) -> dict[str, Any] | None:
        settings = self.config.get("media", {})
        if not settings.get("enabled", False):
            return None

        election_year = int(self.config["election"]["year"])
        refresh_seconds = int(settings.get("refresh_seconds", 1800))
        news_refresh_seconds = int(settings.get("news_refresh_seconds", 3600))
        states = [
            {"state": state["state"], "name": state["name"]}
            for state in self.config.get("state_pages", [])
        ]
        poll_records: list[dict[str, Any]] = []
        poll_statuses = []
        for poll_type in ("senate", "governor", "house", "generic-ballot"):
            url = f"{settings.get('votehub_api_url', VOTEHUB_API_URL)}?{urlencode({'poll_type': poll_type, 'subject': str(election_year)})}"
            records, status = self._cached_media(
                f"votehub-{poll_type}",
                url,
                refresh_seconds,
                lambda content, kind=poll_type: normalize_votehub_polls(
                    json.loads(content), kind, states, election_year,
                ),
                captured_at,
            )
            if poll_type == "generic-ballot":
                records = latest_votehub_polls(records)
            office = "Generic ballot" if poll_type == "generic-ballot" else poll_type.title()
            status.update({"office": office, "source": "VoteHub Polls API", "rowCount": len(records)})
            poll_records.extend(records)
            poll_statuses.append(status)

        news_feeds: dict[str, dict[str, Any]] = {}
        for state in states:
            url = google_news_rss_url(state["name"], election_year)
            items, status = self._cached_media(
                f"google-news-{state['state']}",
                url,
                news_refresh_seconds,
                parse_google_news_rss,
                captured_at,
            )
            news_feeds[state["state"]] = {
                **status,
                "feedUrl": url,
                "rowCount": len(items),
                "items": items,
            }

        poll_errors = [status for status in poll_statuses if status["status"] in {"error", "stale"}]
        polling_status = "error" if len(poll_errors) == len(poll_statuses) else "partial" if poll_errors else "reachable"
        return {
            "polling": {
                "provider": "VoteHub Polls API",
                "sourceUrl": VOTEHUB_DOCS_URL,
                "status": polling_status,
                "attribution": "Source: VoteHub Polls API, CC BY 4.0. Poll records are displayed individually; no averages are calculated.",
                "polls": poll_records,
                "sources": poll_statuses,
            },
            "news": {
                "provider": "Google News RSS",
                "sourceUrl": GOOGLE_NEWS_DOCS_URL,
                "status": "reachable" if any(feed["status"] in {"reachable", "cached"} for feed in news_feeds.values()) else "error",
                "feeds": news_feeds,
            },
            "pollClosingTimes": settings.get("poll_closing_times", {}),
        }

    def run_once(self) -> dict[str, Any]:
        captured_at = utc_now()
        open_results, open_statuses = self._open_america(captured_at)
        state_results, state_statuses, discoveries, precinct_results = self._state_pages(captured_at)
        snapshot = {
            "schemaVersion": 2,
            "election": self.config["election"],
            "capturedAt": captured_at,
            "results": open_results + state_results,
            "precinctResults": precinct_results,
            "sources": open_statuses + state_statuses,
            "discoveredResultLinks": discoveries,
            "racePriorities": self.config.get("race_priorities", {}),
            "media": self._media(captured_at),
            "notices": [
                "State-page rows are heuristic and require verification against the linked official source.",
                "County results appear only when an upstream source provides a county name or county FIPS code.",
                "Precinct-level candidate returns are stored separately in precinctResults and retained in history for backtesting.",
                "A reachable page with zero parsed rows means no recognized structured result data was found; it does not mean zero votes.",
                "Open America does not cover every state; absent races are not zero-vote races.",
            ],
        }
        write_snapshot(self.output_dir, snapshot)
        LOGGER.info("Wrote %d result rows and %d discovered links to %s", len(snapshot["results"]), len(discoveries), self.output_dir / "latest.json")
        return snapshot


def watch(config_path: Path, output_dir: Path, interval_seconds: int) -> None:
    watcher = Watcher(config_path, output_dir)
    while True:
        started = time.monotonic()
        try:
            watcher.run_once()
        except Exception:
            LOGGER.exception("Polling cycle failed")
        wait = max(0, interval_seconds - int(time.monotonic() - started))
        LOGGER.info("Next cycle in %d seconds", wait)
        time.sleep(wait)
