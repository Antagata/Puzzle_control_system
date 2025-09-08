# routes/campaign_index.py
from flask import Blueprint, current_app, jsonify
import os, pandas as pd

campaign_bp = Blueprint("campaign_index", __name__, url_prefix="/api")

@campaign_bp.get("/campaign_index")
def campaign_index():
    path = current_app.config.get("CAMPAIGN_HISTORY_CSV")
    if not path or not os.path.exists(path):
        return jsonify({"by_id": {}, "by_name": {}})

    try:
        df = pd.read_csv(path)
    except Exception:
        return jsonify({"by_id": {}, "by_name": {}})

    # Normalize expected columns
    cols = {c.lower(): c for c in df.columns}
    id_col      = cols.get("id") or cols.get("wine_id") or cols.get("sku")
    wine_col    = cols.get("wine") or cols.get("name")
    vintage_col = cols.get("vintage")
    # last campaign can be in various headings
    last_cols   = [c for c in df.columns if c.lower() in ("last_campaign", "last_campaign_date", "lastcampaign")]
    last_col    = last_cols[0] if last_cols else None

    if not last_col or not (id_col or (wine_col and vintage_col)):
        return jsonify({"by_id": {}, "by_name": {}})

    # make safe strings
    def _s(x): return "" if pd.isna(x) else str(x).strip()
    def _norm_v(v): 
        v = _s(v).upper()
        return "NV" if v in ("", "N/A", "NA", "NONE") else v

    by_id, by_name = {}, {}
    for _, r in df.iterrows():
        last = _s(r.get(last_col))
        if not last:
            continue

        if id_col:
            rid = _s(r.get(id_col))
            if rid:
                by_id[rid] = last

        if wine_col and vintage_col:
            wine = _s(r.get(wine_col)).lower()
            vint = _norm_v(r.get(vintage_col)).lower()
            if wine:
                key = f"{wine}::{vint or 'nv'}"
                by_name[key] = last

    return jsonify({"by_id": by_id, "by_name": by_name})
