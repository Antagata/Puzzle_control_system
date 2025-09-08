# routes/leads.py
from flask import Blueprint, request, jsonify, make_response, current_app
from pathlib import Path
import json

bp = Blueprint("leads_bp", __name__)

DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
MERGED_MAP = {
    "MonTue": ("Monday", 2), "TueWed": ("Tuesday", 2), "WedThu": ("Wednesday", 2),
    "ThuFri": ("Thursday", 2), "FriSat": ("Friday", 2), "SatSun": ("Saturday", 2),
    "SunMon": ("Sunday", 2),
}

def _normalize_leads(payload):
    out = []
    if isinstance(payload, dict):
        if isinstance(payload.get("leads"), list):
            return {"leads": payload["leads"]}
        for key, arr in payload.items():
            if not isinstance(arr, list):
                continue
            if key in DAY_NAMES:
                out += [{**ch, "day": key, "span": int(ch.get("span", 1) or 1)} for ch in arr]
            elif key in MERGED_MAP:
                start, span = MERGED_MAP[key]
                out += [{**ch, "day": start, "span": span} for ch in arr]
        return {"leads": out}
    if isinstance(payload, list):
        return {"leads": payload}
    return {"leads": []}

def _load_json(path: Path):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

@bp.get("/api/leads")
def api_leads():
    year = request.args.get("year", type=int)
    week = request.args.get("week", type=int)
    debug = request.args.get("debug", type=int) == 1

    # 🔑 Late-bind IRON root from the actual app config
    iron_root = Path(current_app.config.get("IRON_DATA", ""))

    candidates = []
    src_used = None

    if year and week:
        candidates.append(iron_root / f"leads_{year}_W{week:02d}.json")
    if week:
        candidates.append(iron_root / f"leads_W{week:02d}.json")
    candidates.append(iron_root / "leads_default.json")

    data = None
    for p in candidates:
        if p.exists():
            data = _load_json(p)
            if data is not None:
                src_used = p
                break

    if data is None:
        data = {"TueWed": [], "ThuFri": []}

    normalized = _normalize_leads(data)

    # Safety net: synthesize minimal leads if still empty
    if not normalized["leads"]:
        normalized["leads"] = [
            {"day": "Tuesday",  "span": 2, "title": "VIP tasting push", "meta": "Team A", "lane": 0},
            {"day": "Thursday", "span": 2, "title": "Autumn promo",     "meta": "Team B", "lane": 1},
        ]
        resolved = {"source": "synthesized", "path": None}
    else:
        resolved = {"source": "file", "path": str(src_used) if src_used else None}

    if debug:
        normalized["_debug"] = {
            "iron_data": str(iron_root),
            "resolved": resolved,
        }

    resp = make_response(jsonify(normalized))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp
