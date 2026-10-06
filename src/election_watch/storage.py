"""Small atomic JSON and JSONL snapshot store."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_snapshot(output_dir: Path, snapshot: dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "latest.json"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_dir, delete=False) as temporary:
        json.dump(snapshot, temporary, indent=2, ensure_ascii=True)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, target)
    with (output_dir / "history.jsonl").open("a", encoding="utf-8") as history:
        history.write(json.dumps(snapshot, separators=(",", ":"), ensure_ascii=True) + "\n")
