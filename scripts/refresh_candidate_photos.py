#!/usr/bin/env python3
"""Download verified, freely licensed candidate portraits for the local dashboard."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
ROSTER_PATH = DASHBOARD / "candidates-2026.json"
PRIORITIES_PATH = ROOT / "config" / "sources.json"
PHOTO_DIR = DASHBOARD / "candidate-photos"
INDEX_PATH = PHOTO_DIR / "index.json"
USER_AGENT = (
    "ElectionNightMagicWall/1.0 "
    "(local election results dashboard; licensed portrait cache)"
)
LICENSE_PATTERN = re.compile(
    r"^(public domain|cc0|cc by(?:-sa)?(?:\s+[0-9.]+)?)$", re.IGNORECASE
)
REQUEST_PAUSE_SECONDS = 1
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def candidate_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", html.unescape(value or "").lower())
    value = "".join(character for character in value if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]", "", value)


def licensed(metadata: dict) -> bool:
    license_name = metadata.get("LicenseShortName", {}).get("value", "").strip()
    return bool(LICENSE_PATTERN.fullmatch(license_name))


def metadata_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value or ""))).strip()


def candidates_to_process(roster: dict, priorities: dict, all_candidates: bool) -> list[str]:
    names: dict[str, str] = {}

    def add(rows: list[dict]) -> None:
        for row in rows:
            name = str(row.get("candidate", "")).strip()
            key = candidate_key(name)
            if key:
                names.setdefault(key, name)

    if all_candidates:
        house_races = roster.get("house", {}).values()
    else:
        selected_districts = {
            district
            for districts in priorities.get("house_races", {}).values()
            for district in districts
        }
        house_races = (
            rows for district, rows in roster.get("house", {}).items()
            if district in selected_districts
        )
    for rows in house_races:
        add(rows)

    senate_states = set(roster.get("senate", {}))
    governor_states = set(roster.get("governor", {}))
    if not all_candidates:
        senate_states &= set(priorities.get("statewide_offices", {}).get("Senate", []))
        governor_states &= set(priorities.get("statewide_offices", {}).get("Governor", []))
    for state in senate_states:
        add(roster["senate"][state].get("candidates", []))
    for state in governor_states:
        add(roster["governor"][state])

    return sorted(names.values(), key=str.casefold)


class Wikimedia:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        retry = Retry(
            total=5,
            connect=3,
            read=3,
            status=5,
            backoff_factor=0.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
            respect_retry_after_header=True,
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    def get_json(self, url: str, params: dict) -> dict:
        response = self.session.get(url, params=params, timeout=20)
        response.raise_for_status()
        return response.json()

    def pause(self) -> None:
        time.sleep(REQUEST_PAUSE_SECONDS)

    def commons_file(self, name: str) -> dict | None:
        search_data = self.get_json(
            "https://commons.wikimedia.org/w/api.php",
            {
                "action": "query",
                "generator": "search",
                "gsrsearch": f'"{name}" portrait OR photo',
                "gsrnamespace": "6",
                "gsrlimit": "25",
                "prop": "imageinfo",
                "iiprop": "url|extmetadata",
                "iiurlwidth": "320",
                "format": "json",
            },
        )
        self.pause()
        for page in search_data.get("query", {}).get("pages", {}).values():
            title = page.get("title", "").removeprefix("File:")
            if candidate_key(name) not in candidate_key(title):
                continue
            file = self.accepted_file(page, name)
            if file:
                return file
        return None

    @staticmethod
    def accepted_file(page: dict, candidate_name: str) -> dict | None:
        image_info = page.get("imageinfo", [{}])[0]
        metadata = image_info.get("extmetadata", {})
        license_name = metadata.get("LicenseShortName", {}).get("value", "").strip()
        if not LICENSE_PATTERN.fullmatch(license_name):
            return None
        image_url = image_info.get("thumburl")
        source_url = image_info.get("descriptionurl")
        artist = metadata_text(metadata.get("Artist", {}).get("value", "")) or "Artist not listed"
        description = metadata_text(metadata.get("ImageDescription", {}).get("value", ""))
        if (
            not image_url
            or urlparse(image_url).hostname not in {"upload.wikimedia.org", "thumb.wikimedia.org"}
            or not source_url
            or urlparse(source_url).hostname != "commons.wikimedia.org"
            or candidate_key(candidate_name) not in candidate_key(page.get("title", "").removeprefix("File:"))
        ):
            return None
        if candidate_key(artist) == candidate_key(candidate_name) and candidate_key(candidate_name) not in candidate_key(description):
            return None
        return {
            "candidate": candidate_name,
            "fileName": page.get("title", "").removeprefix("File:"),
            "imageUrl": image_url,
            "sourceUrl": source_url,
            "artist": artist,
            "description": description,
            "license": license_name,
        }

    def download(self, image: dict) -> tuple[bytes, str]:
        response = self.session.get(image["imageUrl"], timeout=30, stream=True)
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if not content_type.startswith("image/"):
            raise ValueError(f"Unexpected photo content type: {content_type or 'missing'}")
        chunks = []
        total = 0
        for chunk in response.iter_content(64 * 1024):
            total += len(chunk)
            if total > MAX_IMAGE_BYTES:
                raise ValueError("Photo thumbnail exceeds the 5 MB size limit.")
            chunks.append(chunk)
        if not total:
            raise ValueError("Downloaded photo thumbnail is empty.")
        image_data = b"".join(chunks)
        if image_data.startswith(b"\xff\xd8\xff"):
            extension = ".jpg"
        elif image_data.startswith(b"\x89PNG\r\n\x1a\n"):
            extension = ".png"
        elif image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP":
            extension = ".webp"
        else:
            raise ValueError("Downloaded photo is not a supported JPEG, PNG, or WebP image.")
        return image_data, extension


def refresh(limit: int | None = None, all_candidates: bool = False) -> int:
    with ROSTER_PATH.open(encoding="utf-8") as file:
        roster = json.load(file)
    with PRIORITIES_PATH.open(encoding="utf-8") as file:
        priorities = json.load(file).get("race_priorities", {})

    priority_names = candidates_to_process(roster, priorities, all_candidates)
    names = priority_names
    if limit is not None:
        names = names[:limit]
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    try:
        old_index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        old_photos = old_index.get("photos", {})
    except (OSError, json.JSONDecodeError):
        old_photos = {}
    photos: dict[str, dict] = {
        key: value for key, value in old_photos.items() if isinstance(value, dict)
    }
    names_by_key = {candidate_key(name): name for name in priority_names}
    for old_key, photo in list(photos.items()):
        if (
            old_key in names_by_key
            and candidate_key(photo.get("artist", "")) == old_key
            and old_key not in candidate_key(photo.get("description", ""))
        ):
            del photos[old_key]
            continue
        if old_key in names_by_key:
            continue
        title_key = candidate_key(photo.get("fileName", ""))
        matches = [key for key in names_by_key if key in title_key]
        if len(matches) == 1:
            photos.setdefault(matches[0], photo)
            del photos[old_key]

    def write_index() -> None:
        manifest = {
            "schemaVersion": 1,
            "generatedAt": date.today().isoformat(),
            "source": "Wikimedia Commons; each entry links to its file page and license.",
            "photos": photos,
        }
        temporary_index = INDEX_PATH.with_suffix(".json.tmp")
        temporary_index.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        temporary_index.replace(INDEX_PATH)

    wikimedia = Wikimedia()
    for index, name in enumerate(names, start=1):
        key = candidate_key(name)
        existing = photos.get(key)
        if (
            existing
            and LICENSE_PATTERN.fullmatch(str(existing.get("license", "")))
            and re.fullmatch(r"[a-f0-9]{16}\.(jpg|png|webp)", Path(existing.get("path", "")).name)
            and existing.get("path") == f"./candidate-photos/{Path(existing['path']).name}"
            and (DASHBOARD / existing["path"].removeprefix("./")).is_file()
        ):
            print(f"[{index}/{len(names)}] Already cached: {name}")
            continue
        try:
            image = wikimedia.commons_file(name)
            if not image:
                print(f"[{index}/{len(names)}] No licensed image: {name}")
                continue
            image_data, extension = wikimedia.download(image)
            digest = hashlib.sha256(key.encode("utf-8") + image_data).hexdigest()[:16]
            local_path = PHOTO_DIR / f"{digest}{extension}"
            local_path.write_bytes(image_data)
            photos[key] = {
                "path": f"./candidate-photos/{local_path.name}",
                "fileName": image["fileName"],
                "sourceUrl": image["sourceUrl"],
                "artist": image["artist"],
                "description": image["description"],
                "license": image["license"],
            }
            write_index()
            print(f"[{index}/{len(names)}] Cached {name} ({image['license']})")
        except (requests.RequestException, ValueError, KeyError, IndexError) as error:
            print(f"[{index}/{len(names)}] Failed {name}: {error}", file=sys.stderr)

    write_index()
    print(f"Updated {INDEX_PATH.relative_to(ROOT)}: {len(photos)} photos from {len(names)} candidates.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--all",
        action="store_true",
        help="also include House candidates outside Cook-rated priority districts",
    )
    parser.add_argument("--limit", type=int, help="process only the first N names")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be a positive integer")
    return refresh(args.limit, args.all)


if __name__ == "__main__":
    raise SystemExit(main())
