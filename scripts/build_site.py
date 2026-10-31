"""Stage the static dashboard site (with a fresh national poll feed) into _site/."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from scripts.build_national_polls import main as build_national_polls  # noqa: E402


def main() -> int:
    site = PROJECT_ROOT / "_site"
    if site.exists():
        shutil.rmtree(site)
    (site / "config").mkdir(parents=True)
    shutil.copy2(PROJECT_ROOT / "index.html", site / "index.html")
    shutil.copytree(PROJECT_ROOT / "dashboard", site / "dashboard")
    shutil.copy2(PROJECT_ROOT / "config" / "sources.json", site / "config" / "sources.json")
    sys.argv = ["build_national_polls", "--output", str(site / "dashboard" / "national-polls.json")]
    return build_national_polls()


if __name__ == "__main__":
    raise SystemExit(main())
