# routes/calendar.py
"""Calendar + notebook endpoints."""

from __future__ import annotations

from flask import Blueprint, request, current_app, jsonify
from pathlib import Path
import json, logging
from server_utils import coerce_week_shape, json_ok, json_error, parse_year_week


calendar_bp = Blueprint("calendar_bp", __name__)
calendar_api = Blueprint("calendar_api", __name__)
notebook_runner_api = Blueprint("notebook_runner_api", __name__)

# Helper to get config paths at request time
def _cfg_path(name: str, *parts) -> Path:
    base = current_app.config[name]
    return Path(base).joinpath(*parts) if parts else Path(base)

def _load_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return fallback

def _empty_week():
    return {d: [] for d in ("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")}

def _coerce_week_shape(obj):
    if not isinstance(obj, dict):
        return _empty_week()
    out = _empty_week()
    for k, v in obj.items():
        if isinstance(v, list):
            key = str(k).strip().capitalize()
            if key in out:
                out[key] = v
    return out

# --- Thin predictable endpoints ---
@calendar_api.get("/api/schedule")
def api_schedule():
    try:
        year, week = parse_year_week()
        path = _cfg_path("IRON_DATA_PATH", "weekly_campaign_schedule.json")
        data = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                logging.exception("Failed to read schedule JSON: %s", e)
        wk = data.get("weekly_calendar") if isinstance(data, dict) else data
        return json_ok({"weekly_calendar": coerce_week_shape(wk)}, year=year, week=week)
    except FileNotFoundError:
        return json_ok({"weekly_calendar": coerce_week_shape(None)})
    except Exception as e:
        return json_error(f"schedule failed: {e}", status=500)

@calendar_api.get("/api/locked")
def api_locked():
    year = request.args.get("year", type=int)
    week = request.args.get("week", type=int)
    data = _load_json(_cfg_path("NOTEBOOKS_DIR", "locked_calendar.json"), {"locked_calendar": {}})
    return jsonify(data)

@calendar_bp.get("/api/schedule")
def get_schedule():
    year = request.args.get("year", type=int)
    week = request.args.get("week", type=int)

    # Defensive: always validate input
    if not year or not (1 <= (week or 0) <= 53):
        return jsonify({
            "ok": False,
            "weekly_calendar": _empty_week(),
            "error": "invalid year/week"
        }), 200

    try:
        data_dir = Path(current_app.config["DATA_DIR"])
        fname = data_dir / f"schedule_{year}_W{week}.json"

        if not fname.exists():
            return jsonify({
                "ok": True,
                "weekly_calendar": _empty_week(),
                "year": year,
                "week": week
            }), 200

        with fname.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        wk = raw.get("weekly_calendar", raw)
        return jsonify({
            "ok": True,
            "weekly_calendar": _coerce_week(wk),
            "year": year,
            "week": week
        }), 200

    except Exception as e:
        current_app.logger.exception("get_schedule failed")
        return jsonify({
            "ok": False,
            "weekly_calendar": _empty_week(),
            "error": str(e),
            "year": year,
            "week": week
        }), 200
        if len(lst) < NUM_SLOTS:
            lst = lst + [None] * (NUM_SLOTS - len(lst))
        elif len(lst) > NUM_SLOTS:
            lst = lst[:NUM_SLOTS]
        fixed[d] = lst
    return fixed

@calendar_bp.get("/engine_ready")
def engine_ready():
    return ("", 204) if is_engine_ready(IRON_DATA_PATH) else ("", 409)

@calendar_bp.get("/api/locked")
def get_locked():
    week = clamp_week(request.args.get("week"))
    data = load_locked_calendar(LOCKED_PATH, week)
    return _nocache(jsonify({"locked_calendar": data}))

@calendar_bp.post("/api/locked")
def save_locked():
    try:
        data = request.get_json(force=True) or {}
        week = clamp_week(data.get("week"))
        locked_calendar = data.get("locked_calendar")
        if locked_calendar is None:
            return jsonify({"error": "locked_calendar required"}), 400

        errs = list_errors(LockedValidator, locked_calendar)
        if errs:
            logging.warning("locked_calendar validation failed: %s", errs)
            return jsonify({"error": "Validation failed", "details": errs}), 400

        out = save_locked_calendar(LOCKED_PATH, int(week), locked_calendar)
        return jsonify({"ok": True, "saved": out.name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

## Removed duplicate get_schedule endpoint (was causing AssertionError)
    if errs:
        logging.warning("schedule validation failed: %s", errs)
        payload = default_empty_schedule()
    else:
        payload = attach_cards(schedule_fixed)

    return _nocache(jsonify(payload))
# --- Notebook runner endpoints ---
notebook_runner_api = Blueprint("notebook_runner_api", __name__)

@notebook_runner_api.post("/api/run-notebook")
def run_notebook():
    payload = request.get_json(force=True) or {}
    notebook = payload.get("notebook")
    year = payload.get("year")
    week = payload.get("week")
    filters = payload.get("filters", {})
    # Call your actual runner; here stub a fake job id
    job_id = "job-" + str(week)
    # TODO: trigger utils.notebook_runner.run_async(notebook, year, week, filters)
    return jsonify({"job_id": job_id})

@notebook_runner_api.get("/api/status")
def job_status():
    job_id = request.args.get("job_id")
    # TODO: read real status from utils/notebook_status.py
    # Stub: pretend it's done
    return jsonify({"state": "completed"})
