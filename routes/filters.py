from __future__ import annotations
from flask import Blueprint, jsonify, request
from pathlib import Path
# Use Settings from app.py (merged config)
from flask import current_app
from services.filters_service import load_filters, save_filters

filters_bp = Blueprint("filters_bp", __name__)


def _nocache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp

@filters_bp.get("/api/filters")
def get_filters():
    filters_path = Path(current_app.config["NOTEBOOKS_DIR"]) / "filters.json"
    filters_path.parent.mkdir(parents=True, exist_ok=True)
    data = load_filters(filters_path)
    return _nocache(jsonify({"filters": data}))

@filters_bp.post("/api/filters")
def set_filters():
    filters_path = Path(current_app.config["NOTEBOOKS_DIR"]) / "filters.json"
    filters_path.parent.mkdir(parents=True, exist_ok=True)
    payload = request.get_json(force=True, silent=True) or {}
    filters = payload.get("filters", payload)  # accept both shapes
    save_filters(filters_path, filters)
    return jsonify({"ok": True, "saved": True})

