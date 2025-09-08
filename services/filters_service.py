from __future__ import annotations
from pathlib import Path
import json

def load_filters(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

def save_filters(path: Path, filters: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(filters, indent=2), encoding="utf-8")
