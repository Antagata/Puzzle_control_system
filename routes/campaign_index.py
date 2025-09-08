# routes/campaign_index.py
from __future__ import annotations
from flask import make_response

from flask import Blueprint, current_app, jsonify, request
from pathlib import Path
import os, time
import pandas as pd
from datetime import datetime

campaign_bp = Blueprint("campaign_index", __name__)

# in-process cache by file mtime so we don't re-parse constantly
_CACHE = {"path": None, "mtime": None, "data": None, "meta": None}

# flexible header detection
ID_COLS       = ["id", "wine_id", "Id", "ID", "WineID", "wineId"]
NAME_COLS     = ["name", "wine", "Wine", "WineName", "product_name"]
VINTAGE_COLS  = ["vintage", "Vintage", "year", "Year"]
DATE_COLS     = ["last_campaign", "last_campaign_date", "LastCampaignDate", "lastCampaign", "date", "Date"]

def _nocache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp
    
def _pick_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for c in candidates:
        if c in df.columns:
            return c
    return None

def _norm_id(v) -> str:
    s = str(v or "").strip()
    # common CSV issue: numeric IDs come as "123.0"
    if s.endswith(".0"):
        s = s[:-2]
    return s

def _norm_vintage(v) -> str:
    s = str(v or "").strip()
    if not s:
        return "NV"
    s = s.replace(".", "").upper()  # "N.V." -> "NV"
    if s in {"N/A", "NA", "NONE"}:
        return "NV"
    return s

def _norm_name(v) -> str:
    return str(v or "").strip().lower()

def _parse_date(v) -> str | None:
    s = str(v or "").strip()
    if not s:
        return None
    # try several common formats → return YYYY-MM-DD
    fmts = ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d-%m-%Y")
    for f in fmts:
        try:
            return datetime.strptime(s, f).date().isoformat()
        except Exception:
            pass
    # pandas can help as a fallback
    try:
        dt = pd.to_datetime(s, errors="coerce")
        if pd.notna(dt):
            return dt.date().isoformat()
    except Exception:
        pass
    return None

def _build_index(csv_path: Path):
    if not csv_path.exists():
        return {"by_id": {}, "by_name": {}}, {
            "source": str(csv_path),
            "exists": False,
            "row_count": 0,
            "used_columns": {},
        }

    df = pd.read_csv(csv_path, dtype=str).fillna("")
    id_col      = _pick_col(df, ID_COLS)
    name_col    = _pick_col(df, NAME_COLS)
    vintage_col = _pick_col(df, VINTAGE_COLS)
    date_col    = _pick_col(df, DATE_COLS)

    meta = {
        "source": str(csv_path),
        "exists": True,
        "row_count": int(len(df)),
        "used_columns": {
            "id": id_col, "name": name_col, "vintage": vintage_col, "date": date_col
        },
    }

    if not date_col or not name_col:  # date and name are minimum viable
        return {"by_id": {}, "by_name": {}}, meta

    by_id: dict[str, str] = {}
    by_name: dict[str, str] = {}

    for _, r in df.iterrows():
        last = _parse_date(r[date_col])
        if not last:
            continue

        nm = _norm_name(r[name_col])
        vt = _norm_vintage(r[vintage_col] if vintage_col in df.columns else "NV")
        key = f"{nm}::{vt.lower()}"

        # prefer the most recent date if duplicates
        if key not in by_name or (by_name[key] < last):
            by_name[key] = last

        if id_col:
            rid = _norm_id(r[id_col])
            if rid:
                if rid not in by_id or (by_id[rid] < last):
                    by_id[rid] = last

    return {"by_id": by_id, "by_name": by_name}, meta

def _load_cached():
    csv_path = Path(current_app.config.get("CAMPAIGN_HISTORY_CSV", "data/campaign_history.csv"))
    try:
        mtime = csv_path.stat().st_mtime
    except FileNotFoundError:
        mtime = None

    if (
        _CACHE["data"] is not None
        and _CACHE["path"] == str(csv_path)
        and _CACHE["mtime"] == mtime
    ):
        return _CACHE["data"], _CACHE["meta"]

    data, meta = _build_index(csv_path)
    _CACHE.update(path=str(csv_path), mtime=mtime, data=data, meta=meta)
    return data, meta

@campaign_bp.get("/api/campaign_index")
def get_campaign_index():
    data, meta = _load_cached()
    resp = jsonify({**data, "meta": meta}) if request.args.get("debug") == "1" else jsonify(data)
    return _nocache(resp)

@campaign_bp.post("/api/campaign_index/refresh")
def refresh_campaign_index():
    _CACHE.update(path=None, mtime=None, data=None, meta=None)
    data, meta = _load_cached()
    return _nocache(jsonify({"ok": True, "counts": {
        "by_id": len(data["by_id"]), "by_name": len(data["by_name"])
    }, "meta": meta}))

