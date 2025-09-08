# app.py – slim orchestrator: registers blueprints; keeps engine/status/catalog intact
from flask import Flask, render_template, request, jsonify, g, send_from_directory
from pathlib import Path
from datetime import datetime, timezone
from time import time as now_time
import threading, json, logging, uuid, os
import pandas as pd

from config import Settings
from services.calendar_service import set_engine_ready
from utils.notebook_runner import run_notebook as nb_run
from utils.notebook_status import update_status, get_status, Heartbeat

# --- Environment defaults (before Settings is loaded is fine)
os.environ.setdefault("ENABLE_OUTLOOK", "1")
os.environ.setdefault(
    "IRON_DATA",
    r"C:\Users\Marco.Africani\OneDrive - AVU SA\AVU CPI Campaign\Puzzle_control_Reports\IRON_DATA"
)

# --- Flask app (CREATE ONCE)
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config.from_object(Settings)
app.config["JSON_AS_ASCII"] = False
app.config["MAX_CONTENT_LENGTH"] = Settings.MAX_CONTENT_LENGTH

# --- Paths (DEFINE BEFORE USE)
IRON_DATA_PATH: Path = Settings.IRON_DATA_PATH
SOURCE_PATH: Path = Settings.SOURCE_PATH
FILTERS_PATH = Path("notebooks") / "filters.json"
TRANSIENT_LOCKED_SNAPSHOT = Path("notebooks") / "locked_calendar.json"
LOCKED_PATH = IRON_DATA_PATH / "locked_weeks"
SELECTED_WINE_PATH = IRON_DATA_PATH / "selected_wine.json"
UI_SELECTION_PATH = IRON_DATA_PATH / "ui_selection.json"

# Ensure folders exist
IRON_DATA_PATH.mkdir(parents=True, exist_ok=True)
Path("notebooks").mkdir(parents=True, exist_ok=True)
LOCKED_PATH.mkdir(parents=True, exist_ok=True)

# Expose path for other blueprints
app.config["IRON_DATA"] = str(IRON_DATA_PATH)

# --- Campaign history CSV config (set ONCE)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
default_csv = os.path.join(BASE_DIR, "data", "campaign_history.csv")
app.config["CAMPAIGN_HISTORY_CSV"] = os.environ.get("CAMPAIGN_HISTORY_CSV", default_csv)

# --- Favicon (ensure you have static/favicon.ico OR change this to .svg and add that file)
@app.route('/favicon.ico')
def favicon():
    return send_from_directory(app.static_folder, 'favicon.ico', mimetype='image/vnd.microsoft.icon')

# --- Blueprints (import AFTER app exists; register ONCE)
from routes.calendar import calendar_bp, calendar_api, notebook_runner_api
from routes.filters import filters_bp
from routes.cards import cards_bp
from routes.campaign_index import campaign_bp
from routes.leads import bp as leads_bp  # alias the leads blueprint

app.register_blueprint(calendar_bp)
app.register_blueprint(calendar_api)
app.register_blueprint(notebook_runner_api)
app.register_blueprint(filters_bp)
app.register_blueprint(cards_bp)
app.register_blueprint(campaign_bp)
app.register_blueprint(leads_bp)

# --- Logging (request ID, duration)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

@app.before_request
def _req_start():
    g.request_id = uuid.uuid4().hex[:8]
    g.t0 = now_time()

@app.after_request
def _req_log(resp):
    try:
        dt = int((now_time() - getattr(g, "t0", now_time())) * 1000)
        logging.info("rid=%s %s %s %s %dms",
                     getattr(g, "request_id", "-"),
                     request.method, request.path, resp.status_code, dt)
    except Exception:
        pass
    return resp

# ----------------------------- UI ---------------------------------
@app.route("/")
def cockpit():
    try:
        missing = Settings.missing_path_messages()
        warning = " • ".join(missing) if missing else ""
    except Exception:
        warning = ""
    return render_template("cockpit_ui.html", app_version=int(now_time()), env_warning=warning)

# --------------------------- Status --------------------------------
@app.route("/status")
def status():
    data = get_status() or {}
    raw_progress = data.get("progress", 0)
    try:
        progress = int(float(raw_progress)) if isinstance(raw_progress, (int, float, str)) else 0
    except Exception:
        progress = 0
    payload = {
        "notebook": data.get("notebook", ""),
        "state": (data.get("state") or data.get("status") or "idle"),
        "progress": progress,
        "message": data.get("message") or "Waiting…",
        "updated_at": data.get("updated_at") or datetime.now(timezone.utc).isoformat(),
    }
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp

# ---------------------- Selected wine (transient) -------------------
@app.post("/api/selected_wine")
def set_selected_wine():
    try:
        payload = request.get_json(force=True) or {}
        SELECTED_WINE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return jsonify({"ok": True})
    except Exception as e:
        app.logger.exception("selected_wine failed")
        return jsonify({"ok": False, "error": str(e)}), 500

# ------------------------ Run full engine ---------------------------
RUNTIME = {"inflight": False}
RUNTIME_LOCK = threading.Lock()

def _start_run() -> bool:
    with RUNTIME_LOCK:
        if RUNTIME["inflight"]:
            return False
        RUNTIME["inflight"] = True
        return True

def _end_run():
    with RUNTIME_LOCK:
        RUNTIME["inflight"] = False

@app.post("/run_full_engine")
def run_full_engine():
    if not _start_run():
        return jsonify({"error": "A run is already in progress."}), 409

    notebook = "AVU_ignition_1.ipynb"
    input_path = Path("notebooks") / notebook
    output_path = Path("notebooks") / f"executed_{notebook}"

    hb = Heartbeat(interval=5, notebook=notebook, base_message="🔥 Ignition running…")

    def run_thread():
        hb.start()
        update_status({
            "notebook": notebook, "state": "running", "done": False,
            "progress": 0, "message": "🚀 Starting full AVU engine…"
        })
        try:
            nb_run(str(input_path), str(output_path), {
                "input_path": str(SOURCE_PATH),
                "output_path": str(IRON_DATA_PATH),
                "week_number": datetime.now().isocalendar().week,
            })
            update_status({"progress": 95, "message": "Writing schedule…"})
        except Exception as e:
            update_status({
                "notebook": notebook, "state": "error", "done": True,
                "progress": 0, "message": f"❌ Error: {e}"
            })
        else:
            set_engine_ready(IRON_DATA_PATH)
            update_status({
                "notebook": notebook, "state": "completed", "done": True,
                "progress": 100, "message": "✅ AVU engine finished."
            })
        finally:
            hb.stop()
            _end_run()

    threading.Thread(target=run_thread, daemon=True).start()
    return jsonify({"message": "✅ Full AVU Engine started.", "rid": g.request_id}), 200

# ---------------------- Run schedule/offer notebook -----------------
@app.post("/run_notebook")
def run_notebook_route():
    if not _start_run():
        return jsonify({"error": "A run is already in progress."}), 409
    try:
        data = request.get_json(force=True, silent=False) or {}
    except Exception as e:
        _end_run()
        return jsonify({"error": f"Invalid JSON: {e}"}), 400

    run_mode = data.get("mode", "full")  # 'partial' (schedule), 'offer', or 'full'
    requested_nb = (data.get("notebook") or "").strip()
    week_number = data.get("week_number") or datetime.now().isocalendar().week
    ui_sel = data.get("ui_selection")
    selected_wine = data.get("selected_wine")
    locked_calendar = data.get("locked_calendar") or {}
    filters = data.get("filters") or {}

    # Persist transient UI state (used by notebooks)
    try:
        FILTERS_PATH.write_text(json.dumps(filters, indent=2), encoding="utf-8")
        TRANSIENT_LOCKED_SNAPSHOT.write_text(json.dumps(locked_calendar, indent=2), encoding="utf-8")
        if ui_sel is not None:
            UI_SELECTION_PATH.write_text(json.dumps(ui_sel, indent=2), encoding="utf-8")
        if selected_wine is not None:
            SELECTED_WINE_PATH.write_text(json.dumps(selected_wine, indent=2), encoding="utf-8")
    except Exception as e:
        _end_run()
        return jsonify({"error": f"Failed to write transient UI state: {e}"}), 500

    if requested_nb:
        notebook = requested_nb
    elif run_mode == "partial":
        notebook = "AVU_schedule_only.ipynb"
    elif run_mode == "offer":
        notebook = "AUTONOMOUS_AVU_OMT_3.ipynb"
    else:
        notebook = "AVU_ignition_1.ipynb"

    input_path = Path("notebooks") / notebook
    output_path = Path("notebooks") / f"executed_{notebook}"
    hb = Heartbeat(interval=5, notebook=notebook, base_message="⏳ Processing…")

    def run_with_status():
        hb.start()
        update_status({
            "notebook": notebook, "state": "running", "done": False,
            "progress": 0, "message": f"Notebook started for Week {week_number}…"
        })
        try:
            nb_run(str(input_path), str(output_path), {
                "input_path": str(SOURCE_PATH),
                "output_path": str(IRON_DATA_PATH),
                "week_number": int(week_number),
            })
            update_status({"progress": 95, "message": "Writing schedule…"})
        except Exception as e:
            update_status({
                "notebook": notebook, "state": "error", "done": True,
                "progress": 0, "message": f"❌ Error: {e}"
            })
        else:
            update_status({
                "notebook": notebook, "state": "completed", "done": True,
                "progress": 100, "message": f"✅ Notebook executed for Week {week_number}."
            })
        finally:
            hb.stop()
            _end_run()

    threading.Thread(target=run_with_status, daemon=True).start()
    return jsonify({"ok": True, "notebook": notebook, "rid": g.request_id})

# --------------------------- Catalog API ----------------------------
_CATALOG_CACHE = {"df": None, "src": None, "mtime": None}

@app.get("/api/catalog")
def catalog_search():
    try:
        q = (request.args.get("q") or "").strip().lower()
        limit = min(max(int(request.args.get("limit", 15)), 1), 50)

        candidates = [
            IRON_DATA_PATH / "stock_df_final.pkl",
            IRON_DATA_PATH / "stock_df_with_seasonality.pkl",
        ]
        src = next((p for p in candidates if p.exists()), None)
        if src is None:
            return jsonify({"items": []})

        mtime = src.stat().st_mtime
        if (_CATALOG_CACHE["df"] is None
            or _CATALOG_CACHE["src"] != str(src)
            or _CATALOG_CACHE["mtime"] != mtime):
            df = pd.read_pickle(src)
            df = df.rename(columns={"Stock": "stock"})
            for c in ("id", "wine", "vintage", "region_group", "full_type", "stock"):
                if c not in df.columns:
                    df[c] = "" if c != "stock" else 0
            df["id"] = df["id"].astype(str).str.replace(r"\.0$", "", regex=True)
            df["wine_lc"] = df["wine"].astype(str).str.strip().str.lower()
            _CATALOG_CACHE.update(df=df, src=str(src), mtime=mtime)

        df = _CATALOG_CACHE["df"]
        sub = df if not q else df[df["wine_lc"].str.contains(q, na=False)]

        grp = sub.groupby("wine", dropna=False).agg({
            "vintage": lambda s: sorted(set(str(x).strip() for x in s.dropna())),
            "id": lambda s: {str(v): str(i) for v, i in zip(sub.loc[s.index, "vintage"], s)},
            "region_group": "first",
            "full_type": "first",
        }).reset_index()

        items = []
        for _, r in grp.head(limit).iterrows():
            vintages = [v if str(v).upper() == "NV" else v for v in r["vintage"]]
            items.append({
                "wine": r["wine"],
                "vintages": vintages,
                "ids_by_vintage": r["id"],
                "region_group": (r["region_group"] or "Unknown"),
                "full_type": (r["full_type"] or "Unknown"),
            })
        return jsonify({"items": items})
    except Exception as e:
        return jsonify({"error": str(e), "items": []}), 200

# ----------------------------- Main --------------------------------

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5055, debug=True)
