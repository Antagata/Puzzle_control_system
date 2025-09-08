from __future__ import annotations
from typing import Any, Dict, Tuple
from flask import jsonify, request
import logging

WEEK_KEYS = ("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")

def empty_week() -> Dict[str, list]:
    return {k: [] for k in WEEK_KEYS}

def coerce_week_shape(obj: Any) -> Dict[str, list]:
    """Return a guaranteed 7-day dict of lists. Safe for None/garbage input."""
    out = empty_week()
    if not isinstance(obj, dict):
        return out
    for k, v in obj.items():
        if isinstance(v, list):
            key = str(k).strip().capitalize()
            if key in out:
                out[key] = v
    return out

def json_ok(data: Dict[str, Any] | None = None, **extra):
    payload = {"ok": True}
    if data:
        payload.update(data)
    if extra:
        payload.update(extra)
    return jsonify(payload), 200

def json_error(message: str, status: int = 400, **extra):
    logging.exception(message) if status >= 500 else logging.warning(message)
    payload = {"ok": False, "error": message}
    if extra:
        payload.update(extra)
    return jsonify(payload), status

def parse_year_week(args=None) -> Tuple[int|None,int|None]:
    args = args or request.args
    year = args.get("year", type=int)
    week = args.get("week", type=int)
    if year is not None and year < 1970:
        year = None
    if week is not None and (week < 1 or week > 53):
        week = None
    return year, week
