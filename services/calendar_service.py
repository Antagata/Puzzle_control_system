from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
import json

DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
NUM_SLOTS = 5

def clamp_week(n) -> int:
    try:
        n = int(n)
    except Exception:
        n = datetime.now().isocalendar().week
    return max(1, min(53, n))

def engine_ready_path(iron_data: Path) -> Path:
    return iron_data / ".engine_ready.json"

def set_engine_ready(iron_data: Path):
    p = engine_ready_path(iron_data)
    p.write_text(json.dumps({"ready": True, "ts": datetime.now(timezone.utc).isoformat()}, indent=2), encoding="utf-8")

def is_engine_ready(iron_data: Path) -> bool:
    p = engine_ready_path(iron_data)
    if not p.exists():
        return False
    try:
        return bool(json.loads(p.read_text(encoding="utf-8")).get("ready"))
    except Exception:
        return False

def default_empty_schedule() -> dict:
    return {d: [None]*NUM_SLOTS for d in DAYS}

def week_file(iron_data: Path, week: int) -> Path:
    return iron_data / f"weekly_campaign_schedule_week_{week}.json"

def load_schedule(iron_data: Path, week: int | None) -> dict | None:
    # Prefer week-specific, then canonical
    if week:
        p = week_file(iron_data, week)
        if p.exists():
            try:
                raw = json.loads(p.read_text(encoding="utf-8"))
                return raw.get("weekly_calendar", raw)
            except Exception:
                return None
    p = iron_data / "weekly_campaign_schedule.json"
    if p.exists():
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            return raw.get("weekly_calendar", raw)
        except Exception:
            return None
    return None

def save_locked_calendar(base_dir: Path, week: int, data: dict) -> Path:
    base_dir.mkdir(parents=True, exist_ok=True)
    out = base_dir / f"locked_calendar_week_{week}.json"
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return out

def load_locked_calendar(base_dir: Path, week: int) -> dict:
    p = base_dir / f"locked_calendar_week_{week}.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
