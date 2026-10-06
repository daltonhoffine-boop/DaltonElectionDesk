"""Command-line entry point."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from .runner import Watcher, watch

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll Open America and official state election result pages.")
    parser.add_argument("--config", type=Path, default=PROJECT_ROOT / "config" / "sources.json")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "data")
    parser.add_argument("--watch", action="store_true", help="Keep polling continuously until stopped.")
    parser.add_argument("--interval", type=int, default=60, help="Seconds between polling cycles (default: 60).")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
    if args.interval < 30:
        parser.error("--interval must be at least 30 seconds to avoid aggressive polling")
    if args.watch:
        watch(args.config, args.output, args.interval)
    else:
        Watcher(args.config, args.output).run_once()


if __name__ == "__main__":
    main()
