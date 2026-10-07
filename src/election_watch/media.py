"""Normalize polling and news records for the election dashboard."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlencode


VOTEHUB_API_URL = "https://api.votehub.com/polls"
VOTEHUB_DOCS_URL = "https://votehub.com/polls/api/"
GOOGLE_NEWS_BASE_URL = "https://news.google.com/rss/search"
GOOGLE_NEWS_DOCS_URL = "https://news.google.com/"


def _state_code(record: dict[str, Any], subject: str, states: list[dict[str, str]]) -> str | None:
    direct = str(record.get("state") or record.get("state_code") or "").upper()
    valid_codes = {state["state"] for state in states}
    if direct in valid_codes:
        return direct

    for state in sorted(states, key=lambda item: len(item["name"]), reverse=True):
        if re.search(rf"\b{re.escape(state['name'])}\b", subject, re.IGNORECASE):
            return state["state"]
    seat_name = str(record.get("seat_name") or "")
    for state in states:
        if re.search(rf"\b{re.escape(state['state'])}\s*[- ]", seat_name, re.IGNORECASE):
            return state["state"]
    return None


def _house_district(record: dict[str, Any], subject: str, state: str | None) -> str | None:
    seat_name = str(record.get("seat_name") or "")
    combined = f"{seat_name} {subject}"
    if state and re.search(r"\bat[\s-]+large\b", combined, re.IGNORECASE):
        return f"{state}-00"
    if state:
        code_match = re.search(rf"\b{re.escape(state)}\s*[- ]\s*(\d{{1,2}})\b", combined, re.IGNORECASE)
        if code_match:
            return f"{state}-{int(code_match.group(1)):02d}"

    for value in (seat_name, subject):
        if state and re.fullmatch(r"\s*\d{1,2}\s*", value):
            return f"{state}-{int(value):02d}"
        match = re.search(r"\b(?:district|dist\.?|cd)\s*[-#:]?\s*(\d{1,2})\b", value, re.IGNORECASE)
        if not match:
            match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)\s+(?:congressional\s+)?district\b", value, re.IGNORECASE)
        if not match:
            match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)\b", value, re.IGNORECASE)
        if match and state:
            return f"{state}-{int(match.group(1)):02d}"
    return None


def normalize_votehub_polls(
    payload: Any,
    poll_type: str,
    states: list[dict[str, str]],
    election_year: int,
) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        payload = payload.get("polls")
    if not isinstance(payload, list):
        raise ValueError("VoteHub response must be a list of poll records.")

    polls: list[dict[str, Any]] = []
    for record in payload:
        if not isinstance(record, dict) or str(record.get("poll_type", "")).lower() != poll_type:
            continue
        subject = str(record.get("subject") or "")
        if str(election_year) not in subject:
            continue
        state = _state_code(record, subject, states)
        if not state and poll_type != "generic-ballot":
            continue

        answers = []
        raw_answers = record.get("answers")
        answer_rows = raw_answers if isinstance(raw_answers, list) else []
        for answer in answer_rows:
            if not isinstance(answer, dict):
                continue
            try:
                percentage = float(answer["pct"])
            except (KeyError, TypeError, ValueError):
                continue
            if not 0 <= percentage <= 100:
                continue
            answers.append({"choice": str(answer.get("choice") or "Unspecified"), "pct": percentage})

        polls.append({
            "id": str(record.get("id") or ""),
            "pollType": poll_type,
            "state": state,
            "district": _house_district(record, subject, state) if poll_type == "house" else None,
            "subject": subject,
            "pollster": str(record.get("pollster") or "Pollster not listed"),
            "startDate": record.get("start_date"),
            "endDate": record.get("end_date"),
            "sampleSize": record.get("sample_size"),
            "population": record.get("population"),
            "sponsors": [
                str(sponsor)
                for sponsor in record.get("sponsors", [])
                if sponsor
            ] if isinstance(record.get("sponsors"), list) else [],
            "answers": answers,
            "sourceUrl": record.get("url"),
            "createdAt": record.get("created_at"),
        })
    return polls


def latest_votehub_polls(polls: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    return sorted(
        polls,
        key=lambda poll: str(poll.get("endDate") or ""),
        reverse=True,
    )[:limit]


def google_news_rss_url(state_name: str, election_year: int) -> str:
    query = f"{election_year} election {state_name} Senate Governor House"
    return f"{GOOGLE_NEWS_BASE_URL}?{urlencode({'q': query, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'})}"


def parse_google_news_rss(content: bytes, limit: int = 8) -> list[dict[str, str]]:
    root = ET.fromstring(content)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("Google News RSS response has no channel.")

    items: list[dict[str, str]] = []
    seen_links: set[str] = set()
    for item in channel.findall("item"):
        link = (item.findtext("link") or "").strip()
        title = (item.findtext("title") or "").strip()
        if not title or not link.startswith(("https://", "http://")) or link in seen_links:
            continue
        seen_links.add(link)
        source = item.find("source")
        items.append({
            "title": title,
            "url": link,
            "publisher": (source.text or "").strip() if source is not None else "",
            "publishedAt": (item.findtext("pubDate") or "").strip(),
        })
        if len(items) >= limit:
            break
    return items
