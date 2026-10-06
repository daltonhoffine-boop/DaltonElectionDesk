import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlparse

from scripts.refresh_candidate_photos import (
    DASHBOARD,
    LICENSE_PATTERN,
    PRIORITIES_PATH,
    ROSTER_PATH,
    Wikimedia,
    candidate_key,
    candidates_to_process,
)


ROOT = Path(__file__).resolve().parents[1]
PHOTO_INDEX = DASHBOARD / "candidate-photos" / "index.json"


class CandidatePhotoTests(unittest.TestCase):
    def test_candidate_key_normalizes_accents_and_punctuation(self):
        self.assertEqual(candidate_key("Ben Ray Luján"), "benraylujan")
        self.assertEqual(candidate_key("Abdul El-Sayed"), "abdulelsayed")

    def test_priority_candidate_selection_includes_statewide_and_priority_house(self):
        roster = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
        priorities = json.loads(PRIORITIES_PATH.read_text(encoding="utf-8"))["race_priorities"]
        names = candidates_to_process(roster, priorities, all_candidates=False)
        keys = {candidate_key(name) for name in names}
        priority_districts = {
            district
            for districts in priorities["house_races"].values()
            for district in districts
        }
        self.assertTrue(names)
        for district in priority_districts & set(roster["house"]):
            for candidate in roster["house"][district]:
                self.assertIn(candidate_key(candidate["candidate"]), keys)
        self.assertEqual(names, sorted(names, key=str.casefold))

    def test_all_candidate_selection_includes_every_house_and_statewide_race(self):
        roster = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
        priorities = json.loads(PRIORITIES_PATH.read_text(encoding="utf-8"))["race_priorities"]
        names = candidates_to_process(roster, priorities, all_candidates=True)
        keys = {candidate_key(name) for name in names}
        expected = {
            candidate_key(row["candidate"])
            for rows in roster["house"].values()
            for row in rows
        }
        expected.update(
            candidate_key(row["candidate"])
            for race in roster["senate"].values()
            for row in race["candidates"]
        )
        expected.update(
            candidate_key(row["candidate"])
            for rows in roster["governor"].values()
            for row in rows
        )
        self.assertTrue(expected.issubset(keys))

    def test_commons_search_does_not_use_a_candidate_as_the_photographer(self):
        page = {
            "title": "File:Powelltown Tramway (photo by Alan Wilson, 1940s).jpg",
            "imageinfo": [{
                "thumburl": "https://upload.wikimedia.org/example.jpg",
                "descriptionurl": "https://commons.wikimedia.org/wiki/File:Example.jpg",
                "extmetadata": {
                    "LicenseShortName": {"value": "Public domain"},
                    "Artist": {"value": "Alan Wilson"},
                    "ImageDescription": {"value": "A tramway photograph."},
                },
            }],
        }
        self.assertIsNone(Wikimedia.accepted_file(page, "Alan Wilson"))

    def test_manifest_only_references_existing_local_licensed_images(self):
        manifest = json.loads(PHOTO_INDEX.read_text(encoding="utf-8"))
        self.assertEqual(manifest["schemaVersion"], 1)
        self.assertIsInstance(manifest["photos"], dict)
        roster = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
        priorities = json.loads(PRIORITIES_PATH.read_text(encoding="utf-8"))["race_priorities"]
        roster_keys = {
            candidate_key(name)
            for name in candidates_to_process(roster, priorities, all_candidates=True)
        }
        for key, photo in manifest["photos"].items():
            self.assertRegex(key, re.compile(r"^[a-z0-9]+$"))
            self.assertIn(key, roster_keys)
            self.assertRegex(photo["path"], re.compile(r"^\./candidate-photos/[a-f0-9]{16}\.(jpg|png|webp)$"))
            image_path = DASHBOARD / photo["path"].removeprefix("./")
            self.assertTrue(image_path.is_file())
            image_bytes = image_path.read_bytes()
            self.assertGreater(len(image_bytes), 0)
            if image_path.suffix == ".jpg":
                self.assertTrue(image_bytes.startswith(b"\xff\xd8\xff"))
            elif image_path.suffix == ".png":
                self.assertTrue(image_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
            else:
                self.assertTrue(image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP")
            self.assertTrue(LICENSE_PATTERN.fullmatch(photo["license"]))
            self.assertEqual("commons.wikimedia.org", urlparse(photo["sourceUrl"]).hostname)


if __name__ == "__main__":
    unittest.main()
