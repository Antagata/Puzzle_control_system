# routes/calendar.py
from __future__ import annotations
from flask import Blueprint, jsonify, request
from pathlib import Path
import json, logging

from config import Settings
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
    """Pad/truncate each day list to exactly 5 slots to satisfy UI/validator."""
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
    # Accept ?week= and ignore ?year= for now (UI sends both)
    week_arg = request.args.get("week")
    week = clamp_week(week_arg) if week_arg else None

    schedule = load_schedule(IRON_DATA_PATH, week)
    if schedule is None:
        payload = default_empty_schedule()
        return _nocache(jsonify(payload))

    # Normalize to 5 slots/day BEFORE validation, then validate
    schedule_fixed = _ensure_five_slots(schedule)
    errs = list_errors(ScheduleValidator, schedule_fixed)
    if errs:
        logging.warning("schedule validation failed: %s", errs)
        payload = default_empty_schedule()
    else:
        # Attach UI-friendly 'card' objects per slot, non-destructively
        payload = attach_cards(schedule_fixed)

    return _nocache(jsonify(payload))

@calendar_bp.get("/api/leads")
def get_leads():
    week = request.args.get("week")
    path = IRON_DATA_PATH / (f"leads_campaigns_week_{clamp_week(week)}.json" if week else "leads_campaigns.json")
    if not path.exists():
        return _nocache(jsonify({"TueWed": [], "ThuFri": []}))
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        data = {"TueWed": [], "ThuFri": []}
    return _nocache(jsonify(data))

@calendar_bp.get("/api/campaign_index")
def campaign_index_stub():
    # Quiet stub so the UI doesn't 404; extend later as needed.
    return _nocache(jsonify({
        "items": [],
        "meta": {
            "year": request.args.get("year"),
            "week": request.args.get("week")
        }
    }))
