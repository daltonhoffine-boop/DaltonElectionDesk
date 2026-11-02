#!/usr/bin/env python3
"""Verify (and repair) candidate portraits against Wikidata identity checks.

Usage:
  python scripts/verify_candidate_photos.py            # report only
  python scripts/verify_candidate_photos.py --apply    # drop bad photos, download verified ones
  python scripts/verify_candidate_photos.py --apply --all

Manual overrides live in dashboard/candidate-photos/overrides.json:
  {"approve": {"candidatekey": "why"}, "reject": {"candidatekey": "why"}}
Rejected candidates never show a photo; approved ones keep their current photo.
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.candidate_identity import STATE_NAMES, Verdict, evaluate, normalize_file, photo_too_old  # noqa: E402
from scripts.refresh_candidate_photos import (  # noqa: E402
    DASHBOARD, INDEX_PATH, LICENSE_PATTERN, PHOTO_DIR, PRIORITIES_PATH, ROOT, ROSTER_PATH,
    Wikimedia, candidate_key, candidates_to_process, metadata_text,
)

OVERRIDES_PATH = PHOTO_DIR / "overrides.json"
CACHE_PATH = ROOT / "data" / "photo-verification-cache.json"
REPORT_PATH = ROOT / "data" / "photo-review.html"
WIKIDATA = "https://www.wikidata.org/w/api.php"
ENWIKI = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"


def roster_people(roster: dict) -> dict[str, dict]:
    people: dict[str, dict] = {}

    def add(row: dict, state: str, office: str) -> None:
        name = str(row.get("candidate", "")).strip()
        key = candidate_key(name)
        if key:
            people.setdefault(key, {
                "name": name, "state": state, "party": row.get("partyCode", ""),
                "office": office,
            })

    for district, rows in roster.get("house", {}).items():
        for row in rows:
            add(row, district.split("-")[0], f"House {district}")
    for state, race in roster.get("senate", {}).items():
        for row in race.get("candidates", []):
            add(row, state, f"Senate {state}")
    for state, rows in roster.get("governor", {}).items():
        for row in rows:
            add(row, state, f"Governor {state}")
    return people


class Resolver:
    def __init__(self) -> None:
        self.api = Wikimedia()
        self.api.pause = lambda: time.sleep(1.5)

    @staticmethod
    def title_guesses(person: dict) -> list[str]:
        name, state = person["name"], STATE_NAMES.get(person["state"], person["state"])
        return [name, f"{name} (politician)", f"{name} ({state} politician)",
                f"{name} (American politician)"]

    def lookup_pages(self, titles: list[str]) -> dict[str, dict]:
        """Batch-fetch Wikipedia intros. Returns requested title -> page (non-disambiguation only)."""
        found: dict[str, dict] = {}
        for i in range(0, len(titles), 20):
            batch = titles[i:i + 20]
            data = self.api.get_json(ENWIKI, {
                "action": "query", "prop": "extracts|pageprops", "exintro": "1", "explaintext": "1",
                "exlimit": "max", "ppprop": "wikibase_item|disambiguation", "redirects": "1",
                "titles": "|".join(batch), "format": "json",
            })
            self.api.pause()
            print(f"  fetched {min(i + 20, len(titles))}/{len(titles)} titles", flush=True)
            query = data.get("query", {})
            alias = {t: t for t in batch}
            for hop in query.get("normalized", []) + query.get("redirects", []):
                for original, current in list(alias.items()):
                    if current == hop["from"]:
                        alias[original] = hop["to"]
            pages = {p.get("title"): p for p in query.get("pages", {}).values()}
            for original, final in alias.items():
                page = pages.get(final)
                props = (page or {}).get("pageprops", {})
                if page and "missing" not in page and "disambiguation" not in props and props.get("wikibase_item"):
                    found[original] = page
        return found

    def search_titles(self, person: dict) -> list[str]:
        found = self.api.get_json(ENWIKI, {
            "action": "query", "list": "search", "srlimit": "5", "format": "json",
            "srsearch": f"{person['name']} {STATE_NAMES.get(person['state'], '')} politician",
        })
        self.api.pause()
        return [r["title"] for r in found.get("query", {}).get("search", [])
                if candidate_key(re.sub(r"\s*\(.*\)$", "", r["title"])) == candidate_key(person["name"])]

    def entities(self, qids: list[str]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for i in range(0, len(qids), 50):
            data = self.api.get_json(WIKIDATA, {
                "action": "wbgetentities", "ids": "|".join(qids[i:i + 50]), "props": "claims",
                "format": "json",
            })
            self.api.pause()
            out.update(data.get("entities", {}))
        return out

    def verify_many(self, people: dict[str, dict]) -> dict[str, Verdict]:
        guesses = {key: self.title_guesses(p) for key, p in people.items()}
        pages = self.lookup_pages(sorted({t for g in guesses.values() for t in g}))
        qids = sorted({p["pageprops"]["wikibase_item"] for p in pages.values()})
        entities = self.entities(qids)
        verdicts = {}
        for key, person in people.items():
            matched = {pages[t]["pageprops"]["wikibase_item"]: pages[t] for t in guesses[key] if t in pages}
            hits = [entities[q] for q in matched if q in entities]
            articles = {q: (f"https://en.wikipedia.org/wiki/{pg['title'].replace(' ', '_')}", pg.get("extract", ""))
                        for q, pg in matched.items()}
            verdicts[key] = evaluate(person["name"], person["state"], person["party"], hits, articles)
        # A namesake page exists but is not the candidate: search for the right article.
        for key, verdict in list(verdicts.items()):
            if verdict.ok or not any("not a living human" in e for e in verdict.evidence):
                continue
            print(f"  searching for the right {people[key]['name']}...", flush=True)
            extra = [t for t in self.search_titles(people[key]) if t not in pages]
            if not extra:
                continue
            more = self.lookup_pages(extra)
            entities.update(self.entities(sorted({p["pageprops"]["wikibase_item"] for p in more.values()} - set(entities))))
            matched = {p["pageprops"]["wikibase_item"]: p for p in more.values()}
            for t in guesses[key]:
                if t in pages:
                    matched.setdefault(pages[t]["pageprops"]["wikibase_item"], pages[t])
            hits = [entities[q] for q in matched if q in entities]
            articles = {q: (f"https://en.wikipedia.org/wiki/{pg['title'].replace(' ', '_')}", pg.get("extract", ""))
                        for q, pg in matched.items()}
            person = people[key]
            verdicts[key] = evaluate(person["name"], person["state"], person["party"], hits, articles)
        return verdicts
    def image(self, file_name: str) -> dict | None:
        data = self.api.get_json(COMMONS, {
            "action": "query", "titles": f"File:{file_name}", "prop": "imageinfo",
            "iiprop": "url|extmetadata", "iiurlwidth": "320", "format": "json",
        })
        self.api.pause()
        page = next(iter(data.get("query", {}).get("pages", {}).values()), {})
        info = page.get("imageinfo", [{}])[0]
        meta = info.get("extmetadata", {})
        license_name = meta.get("LicenseShortName", {}).get("value", "").strip()
        if not LICENSE_PATTERN.fullmatch(license_name) or not info.get("thumburl"):
            return None
        if photo_too_old(meta, file_name):
            return None
        return {
            "fileName": file_name, "imageUrl": info["thumburl"], "sourceUrl": info.get("descriptionurl"),
            "artist": metadata_text(meta.get("Artist", {}).get("value", "")) or "Artist not listed",
            "description": metadata_text(meta.get("ImageDescription", {}).get("value", "")),
            "license": license_name,
        }


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_report(rows: list[dict]) -> None:
    REPORT_PATH.parent.mkdir(exist_ok=True)
    cells = []
    for row in rows:
        img = f'<img src="../dashboard/{row["path"][2:]}" width="120">' if row.get("path") else "(none)"
        link = f'<a href="{row["wikipedia"]}">{html_lib.escape(row["qid"] or "")}</a>' if row.get("wikipedia") else ""
        cells.append(
            f'<tr class="{row["status"]}"><td>{img}</td><td>{html_lib.escape(row["name"])}<br>'
            f'<small>{html_lib.escape(row["office"])}</small></td><td>{row["status"]}</td>'
            f'<td>{html_lib.escape(row["reason"])}</td><td>{link}</td></tr>'
        )
    REPORT_PATH.write_text(
        "<meta charset=utf-8><title>Photo review</title><style>body{font:14px sans-serif}"
        "tr.removed{background:#fdd}tr.verified,tr.approved{background:#dfd}td{padding:4px 8px}</style>"
        "<table>" + "".join(cells) + "</table>", encoding="utf-8")


def run(apply: bool, all_candidates: bool, limit: int | None) -> int:
    roster = load_json(ROSTER_PATH, {})
    priorities = load_json(PRIORITIES_PATH, {}).get("race_priorities", {})
    overrides = load_json(OVERRIDES_PATH, {})
    approve, reject = overrides.get("approve", {}), overrides.get("reject", {})
    people = roster_people(roster)
    index = load_json(INDEX_PATH, {"photos": {}})
    photos: dict[str, dict] = dict(index.get("photos", {}))
    wanted = {candidate_key(n) for n in candidates_to_process(roster, priorities, all_candidates)}
    keys = sorted((wanted | set(photos)) & set(people))
    if limit:
        keys = keys[:limit]
    cache = load_json(CACHE_PATH, {})
    resolver = Resolver()
    todo = {k: people[k] for k in keys if k not in reject and not (k in approve and k in photos)
            and not (cache.get(k, {}).get("name") == people[k]["name"] and cache[k].get("state") == people[k]["state"])}
    print(f"Verifying {len(todo)} candidates against Wikipedia/Wikidata (batched)...")
    for key, verdict in resolver.verify_many(todo).items():
        cache[key] = {"name": people[key]["name"], "state": people[key]["state"], "verdict": verdict.__dict__}
    CACHE_PATH.parent.mkdir(exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache), encoding="utf-8")
    report, removed, added, kept = [], 0, 0, 0
    for n, key in enumerate(keys, 1):
        person, current = people[key], photos.get(key)
        row = {"name": person["name"], "office": person["office"], "path": (current or {}).get("path"),
               "qid": None, "wikipedia": None}
        if key in reject:
            verdict = Verdict(False, f"manually rejected: {reject[key]}")
        elif key in approve and current:
            row.update(status="approved", reason=f"manually approved: {approve[key]}")
            current["verified"] = {"method": "manual", "note": approve[key], "verifiedAt": date.today().isoformat()}
            report.append(row)
            kept += 1
            continue
        else:
            verdict = Verdict(**cache[key]["verdict"])
        row.update(qid=verdict.qid, wikipedia=verdict.wikipedia_url, reason=verdict.reason)
        if not verdict.ok:
            row["status"] = "removed" if current else "no-photo"
            if current:
                removed += 1
                photos.pop(key, None)
            print(f"[{n}/{len(keys)}] {'REMOVE' if current else 'none  '} {person['name']} ({person['office']}): {verdict.reason}")
            report.append(row)
            continue
        stamp = {"method": "wikidata-p18", "qid": verdict.qid, "wikipedia": verdict.wikipedia_url,
                 "verifiedAt": date.today().isoformat()}
        if current and normalize_file(current.get("fileName", "")) == normalize_file(verdict.image_file):
            current["verified"] = stamp
            row["status"] = "verified"
            kept += 1
            print(f"[{n}/{len(keys)}] ok     {person['name']}")
        else:
            image = resolver.image(verdict.image_file) if apply else {}
            if image is None:
                photos.pop(key, None)
                row.update(status="removed" if current else "no-photo", reason="portrait is unlicensed or dated before 1990")
                removed += bool(current)
            elif not apply:
                row.update(status="would-replace", reason=f"would use {verdict.image_file}")
                print(f"[{n}/{len(keys)}] would use {verdict.image_file} for {person['name']}")
            else:
                data, ext = resolver.api.download(image)
                local = PHOTO_DIR / f"{hashlib.sha256(key.encode() + data).hexdigest()[:16]}{ext}"
                local.write_bytes(data)
                photos[key] = {"path": f"./candidate-photos/{local.name}", **{k: image[k] for k in
                               ("fileName", "sourceUrl", "artist", "description", "license")}, "verified": stamp}
                row.update(status="verified", path=photos[key]["path"], reason="replaced with the person's own Wikidata portrait")
                added += 1
                print(f"[{n}/{len(keys)}] NEW    {person['name']}: {verdict.image_file}")
        report.append(row)

    write_report(report)
    print(f"\nkept/verified {kept}, replaced/added {added}, removed {removed}. Review sheet: {REPORT_PATH}")
    if apply:
        manifest = {"schemaVersion": 1, "generatedAt": date.today().isoformat(),
                    "source": "Wikimedia Commons; each photo is the Wikidata portrait of an identity-verified candidate.",
                    "photos": {k: v for k, v in photos.items() if v.get("verified")}}
        INDEX_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        used = {Path(v["path"]).name for v in manifest["photos"].values()}
        for file in PHOTO_DIR.glob("*"):
            if file.suffix in {".jpg", ".png", ".webp"} and file.name not in used:
                file.unlink()
        print(f"Wrote {INDEX_PATH.relative_to(ROOT)} with {len(manifest['photos'])} verified photos.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write changes (default is report only)")
    parser.add_argument("--all", action="store_true", help="include all House candidates, not just priority races")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    return run(args.apply, args.all, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
