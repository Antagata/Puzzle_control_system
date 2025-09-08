from flask import Blueprint as _Blueprint
# --- Notebook runner endpoints ---
notebook_runner_api = _Blueprint("notebook_runner_api", __name__)

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

# routes/calendar.py
"""Calendar + notebook endpoints."""

from __future__ import annotations
from flask import Blueprint, jsonify, request
from pathlib import Path
import json, logging

from config import Settings
from pathlib import Path as _Path
calendar_api = Blueprint("calendar_api", __name__)
ROOT = _Path(__file__).resolve().parents[1]
NB = ROOT / "notebooks"

def _load_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return fallback

# --- Thin predictable endpoints ---
@calendar_api.get("/api/schedule")
def api_schedule():
    year = request.args.get("year", type=int)
    week = request.args.get("week", type=int)
    # Your notebook should write this file. Fallback to empty.
    data = _load_json(NB / "filters_resolved.json", {"weekly_calendar": {
        "Monday": [], "Tuesday": [], "Wednesday": [], "Thursday": [], "Friday": [], "Saturday": [], "Sunday": []
    }})
    return jsonify(data)

@calendar_api.get("/api/locked")
def api_locked():
    year = request.args.get("year", type=int)
    week = request.args.get("week", type=int)
    data = _load_json(NB / "locked_calendar.json", {"locked_calendar": {}})
    return jsonify(data)

@calendar_api.get("/api/leads")
def api_leads():
    year = request.args.get("year", type=int)
    week = request.args.get("week", type=int)
    # You can wire to leads_service; return empty array if none
    return jsonify({"leads": []})
from utils.schemas import ScheduleValidator, LockedValidator, list_errors
from services.calendar_service import (
    clamp_week, load_schedule, default_empty_schedule,
    is_engine_ready, load_locked_calendar, save_locked_calendar
)
from services.cards_service import attach_cards

calendar_bp = Blueprint("calendar_bp", __name__)

IRON_DATA_PATH: Path = Settings.IRON_DATA_PATH
LOCKED_PATH: Path = IRON_DATA_PATH / "locked_weeks"
LOCKED_PATH.mkdir(parents=True, exist_ok=True)

DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
NUM_SLOTS = 5

def _nocache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp

def _ensure_five_slots(payload: dict) -> dict:
    fixed = {}
    for d in DAYS:
        lst = list(payload.get(d, []))
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

@calendar_bp.get("/api/schedule")
def get_schedule():
    # Accept ?week= (UI may also send ?year=)
    week_arg = request.args.get("week")
    week = clamp_week(week_arg) if week_arg else None

    schedule = load_schedule(IRON_DATA_PATH, week)
    if schedule is None:
        payload = default_empty_schedule()
        return _nocache(jsonify(payload))

    schedule_fixed = _ensure_five_slots(schedule)
    errs = list_errors(ScheduleValidator, schedule_fixed)
    if errs:
        logging.warning("schedule validation failed: %s", errs)
        payload = default_empty_schedule()
    else:
        payload = attach_cards(schedule_fixed)

    return _nocache(jsonify(payload))
