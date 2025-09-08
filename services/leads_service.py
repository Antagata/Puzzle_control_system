# services/leads_service.py
from pathlib import Path
import json

def load_leads(iron_data: Path, year: int | None, week: int | None):
    candidates = []
    if year and week:
        candidates.append(iron_data / f"leads_{year}_W{week:02d}.json")
    if week:
        candidates.append(iron_data / f"leads_W{week:02d}.json")
    candidates.append(iron_data / "leads_default.json")
    for p in candidates:
        try:
            if p.exists():
                with p.open("r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            continue
    return None
