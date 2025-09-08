from __future__ import annotations
from flask import Blueprint, jsonify, request
from pathlib import Path
from config import Settings
from services.filters_service import load_filters, save_filters

filters_bp = Blueprint("filters_bp", __name__)
FILTERS_PATH: Path = Path("notebooks") / "filters.json"
FILTERS_PATH.parent.mkdir(parents=True, exist_ok=True)

def _nocache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp

@filters_bp.get("/api/filters")
def get_filters():
    data = load_filters(FILTERS_PATH)
    return _nocache(jsonify({"filters": data}))

@filters_bp.post("/api/filters")
def set_filters():
    payload = request.get_json(force=True, silent=True) or {}
    filters = payload.get("filters", payload)  # accept both shapes
    save_filters(FILTERS_PATH, filters)
    return jsonify({"ok": True, "saved": True})

