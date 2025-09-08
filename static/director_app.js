import * as U from "./js/utils.js";
import {
  buildCalendarSkeleton,
  handleWeekYearChange,
  renderDefaultScheduleFromData,
  loadFullCalendarSnapshot,
} from "./js/calendar.js";
import * as Filters from "./js/filters.js";
import * as Cards from "./js/cards.js";

// Use namespaced utils to avoid "$" collisions:
// - U.$, U.$all, U.getJSON, U.postJSON, U.CAL, U.URLS, etc.
const { CAL, URLS } = U;

// ---------- Filters toggle (persisted) ----------
const FILTERS_VISIBLE_KEY = "ui:filters:visible";

function findFiltersPanel() {
  // Try common selectors; adjust if your filters container has a known id
  return (
    U.$("#filtersPanel") ||
    U.$("#filters") ||
    U.$(".filters") ||
    U.$('[data-role="filters"]')
  );
}

function loadFiltersVisible() {
  return localStorage.getItem(FILTERS_VISIBLE_KEY) === "true";
}

function setFiltersVisible(visible) {
  localStorage.setItem(FILTERS_VISIBLE_KEY, String(visible));
  const panel = findFiltersPanel();
  if (panel) panel.classList.toggle("hidden", !visible);

  // NEW: flip layout classes so calendar spans full width
  const layout = U.$("#appLayout")
              || U.$('[data-role="layout"]')
              || U.$(".app-layout");
  const calendarArea = U.$("#calendar-area")
                     || U.$("#calendar-grid")?.parentElement;

  // Add a body flag for CSS overrides
  document.body.classList.toggle("filters-on",  visible);
  document.body.classList.toggle("filters-off", !visible);

  // If your layout is a CSS grid with 2 columns, collapse to 1 when filters are hidden
  if (layout) {
    layout.classList.toggle("grid", true);
    // remove any fixed 2-col classes you might have set elsewhere
    layout.classList.toggle("grid-cols-1", !visible);
    layout.classList.toggle("grid-cols-[320px_1fr]", visible); // Tailwind arbitrary value; OK with CDN
  }

  // Force the calendar region to occupy all columns when filters are off
  if (calendarArea) {
    if (!visible) {
      calendarArea.style.gridColumn = "1 / -1";
      calendarArea.style.width = "100%";
      calendarArea.style.minWidth = "0";
    } else {
      calendarArea.style.gridColumn = "";
      calendarArea.style.width = "";
      calendarArea.style.minWidth = "";
    }
  }

  const btn = U.$("#filtersToggle");
  if (btn) {
    btn.setAttribute("aria-pressed", String(visible));
    // optional little UI cue
    btn.querySelector('[data-role="knob"]')?.classList.toggle("translate-x-5", visible);
  }
}

function ensureFiltersToggle() {
  // Place the toggle in a sensible toolbar spot, falling back to before the calendar grid
  const host =
    U.$("#calendar-controls") ||
    U.$("#controls") ||
    U.$(".toolbar") ||
    (U.$("#calendar-grid")?.parentElement) ||
    document.body;

  if (!host.querySelector("#filtersToggle")) {
    const btn = document.createElement("button");
    btn.id = "filtersToggle";
    btn.type = "button";
    btn.title = "Show/Hide Filters";
    btn.className =
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white shadow-sm hover:bg-gray-50";
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `
      <span>Filters</span>
      <span class="relative inline-flex h-6 w-10 items-center rounded-full bg-gray-300 transition">
        <span data-role="knob" class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition translate-x-0"></span>
      </span>
    `;
    // Put it at the top of the host
    host.prepend(btn);

    btn.addEventListener("click", () => {
      const next = !loadFiltersVisible();
      setFiltersVisible(next);
    });
  }
  // Initialize hidden by default (OFF at start)
  setFiltersVisible(loadFiltersVisible()); // localStorage default => false
}

// Re-apply filters visibility if the filters panel is rendered later (e.g., hydrated async)
function applyFiltersVisibilitySoon() {
  // One-shot micro-wait so late DOM nodes get picked up
  requestAnimationFrame(() => setFiltersVisible(loadFiltersVisible()));
}


// Safe function aliases (avoid hard reference to a global "Cards")
const renderWineIntoBox    = Cards?.renderWineIntoBox    ?? (() => {});
const addDropZoneListeners = Cards?.addDropZoneListeners ?? (() => {});
const wireCardInteractions = Cards?.wireCardInteractions ?? (() => {}); // if you ever export it
const mapUIFiltersForBackend    = Filters?.mapUIFiltersForBackend    ?? (() => ({}));
const filterCalendarByUIFilters = Filters?.filterCalendarByUIFilters ?? (wk => wk);

// ---- MISSING helper: isoNowEurope (no external libs) ----
function isoNowEurope(tz = "Europe/Zurich") {
  // Convert "now" into a Date representing that timezone
  const nowTZ = new Date(
    new Date().toLocaleString("en-US", { timeZone: tz })
  );

  // ISO week calc on a copy (Thursday-based)
  const d = new Date(Date.UTC(
    nowTZ.getFullYear(),
    nowTZ.getMonth(),
    nowTZ.getDate()
  ));
  // Day of week with Monday=0..Sunday=6
  const dayNum = (d.getUTCDay() + 6) % 7;
  // Shift to Thursday of current week
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  // First Thursday of ISO year
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(
    (d - firstThursday) / (7 * 24 * 60 * 60 * 1000)
  );
  return { year: isoYear, week };
}

// ---- MISSING function: wireCalendarDelegation ----
// If you already attach per-card listeners in cards.js, this can be a no-op,
// but we'll keep a safe scaffold for future delegated events.
function wireCalendarDelegation(root = document) {
  root.addEventListener("click", (e) => {
    // Reserved for delegated handlers (e.g., day header buttons)
    // Currently no-op to satisfy existing calls safely.
  });
}

// ---- global state (shared across modules via window)
window.__avuState = window.__avuState || {
  engineReady: false,
  isWeekLoading: false,
  runInFlight: false,
  selectedWineEl: null,
  selectedWineData: (() => {
    try { return JSON.parse(sessionStorage.getItem("selectedWine")); }
    catch { return null; }
  })(),
  currentYear: U.isoNowEurope().year,
  currentWeek: U.isoNowEurope().week,
  CAMPAIGN_INDEX: { by_id: {}, by_name: {} },
  isoNow: U.isoNowEurope,
};

// expose a few hooks used by modules (keeps coupling low)
window.__avuFilters = Filters;
window.__avuCards   = Cards;


// these are defined later in the file; function declarations are hoisted
window.updateLoadBtnState     = updateLoadBtnState;
window.setOfferButtonsEnabled = setOfferButtonsEnabled;
window.recalcAndUpdateGauge   = recalcAndUpdateGauge;

// one-time boot
window.__BOOTED__ = true;
document.addEventListener("DOMContentLoaded", async () => {
  ensureFiltersToggle();
  applyFiltersVisibilitySoon();

  // Compute default year/week if not present
  if (!window.CAL?.year || !window.CAL?.week) {
    const now = new Date();
    const tzNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
    const d = new Date(Date.UTC(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const isoYear = d.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
    const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
    window.CAL = { ...(window.CAL || {}), year: isoYear, week };
  }

  buildCalendarSkeleton();

  // Snap then fresh fetch
  const snap = loadFullCalendarSnapshot(CAL.year, CAL.week);
  if (snap) {
    await renderDefaultScheduleFromData({ weekly_calendar: snap }, { year: CAL.year, week: CAL.week });
  }
  try {
    await handleWeekYearChange(CAL.year, CAL.week);
  } catch (e) {
    console.warn("[boot] schedule fetch failed", e);
  }
});

/* -------------------------------------------------------------------------- */
// week selector — bulletproof wiring
async function onWeekChange(e) {  
  const wk = parseInt(e.target.value, 10);
  if (!Number.isFinite(wk)) return;

  sessionStorage.setItem("selectedWeek", String(wk));
  Filters.resetFiltersToDefault();

  const yr = window.__avuState.currentYear || new Date().getUTCFullYear();
  await handleWeekYearChange(yr, wk);  // <- call the imported function directly
  console.log("[week] switched to", wk);
}


function wireWeekSelector(){
  const sel = document.getElementById("weekSelector");
  if (!sel || sel._wired) return;
  sel.disabled = false;
  sel.removeAttribute("aria-disabled");
  sel.classList.remove("pointer-events-none","opacity-50");
  sel.addEventListener("change", onWeekChange);
  sel.addEventListener("input", onWeekChange);
  sel._wired = true;
  console.log("[boot] week selector wired");
}
// Reattach if DOM swaps the control
const _wkObs = new MutationObserver(()=> wireWeekSelector());
_wkObs.observe(document.documentElement, { childList:true, subtree:true });

/* -------------------------------------------------------------------------- */
/* Leads lanes — ensure container exists before any leads rendering            */
/* -------------------------------------------------------------------------- */
function ensureLeadsLanes(){
  const grid = document.getElementById("main-calendar-grid");
  if (!grid) return;
  if (!grid.querySelector(".leads-lanes")) {
    const lanes = document.createElement("div");
    lanes.className = "leads-lanes";
    // Inline safety so it shows even if CSS is stale
    Object.assign(lanes.style, {
      gridColumn: "1 / -1",
      gridRow: "1",
      display: "grid",
      gridTemplateColumns: "repeat(7, 1fr)",
      gap: "8px",
      marginBottom: "6px"
    });
    for (let i=0;i<3;i++){
      const lane = document.createElement("div");
      lane.className = "lead-lane";
      Object.assign(lane.style, {
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridAutoFlow: "row dense",
        gap: "6px",
        minHeight: "0"
      });
      lanes.appendChild(lane);
    }
    // Put lanes on row 1; day columns already render as row 2 in CSS
    grid.prepend(lanes);
    console.log("[boot] leads lanes created");
  }
}

/* -------------------------------------------------------------------------- */
/* Status panel & busy states                                                 */
/* -------------------------------------------------------------------------- */
function showStatusPanel(){ const el=U.$("#status-panel"); if(!el) return; el.classList.remove("hidden"); el.style.display="flex"; setStatusBadge("running"); setCalendarInteractivity(false); }
function hideStatusPanel(){ const el=U.$("#status-panel"); if(!el) return; el.classList.add("hidden"); el.style.display="none"; setCalendarInteractivity(true); }
function setStatus({ message="", progress=0, state="" }) {
  U.$("#status-message").textContent = message || "";
  U.$("#progress-bar-fill").style.width = `${Math.max(0, Math.min(100, progress))}%`;
  U.$("#progress-percent").textContent = `${Math.round(progress)}%`;
  if (state) setStatusBadge(state);
}
function setStatusBadge(state) {
  const badge=U.$("#status-badge"); if(!badge) return;
  const s=String(state||"idle").toLowerCase();
  badge.textContent=s.charAt(0).toUpperCase()+s.slice(1);
  badge.className="badge";
  badge.classList.add(s==="running"?"badge-running": s==="completed"?"badge-completed": s==="error"?"badge-error":"badge-idle");
}

// IMPORTANT: do NOT touch the week selector here; only the calendar container.
function setCalendarInteractivity(enabled) {
  const grid = document.getElementById("main-calendar-grid");
  if (grid) grid.classList.toggle("is-busy", !enabled);
  // never touch #weekSelector here
  updateLoadBtnState();
}


async function pollStatusUntilDone({ refreshSchedule=true } = {}) {
  showStatusPanel();
  window.__avuState.runInFlight = true;
  startGaugeOscillation();
  updateStartBtnState(); updateLoadBtnState();
  setStatus({ message:"Starting…", progress:0, state:"running" });

  return new Promise((resolve)=>{
    const timer = setInterval(async ()=>{
      try{
        const s = await U.getJSON(URLS.status);
        setStatus({ message:s.message, progress:s.progress, state:s.state });
        const finished = (s.state==="completed") || (s.state==="error") || Number(s.progress)>=100;
        if(!finished) return;
        clearInterval(timer);
        setStatusBadge(s.state);
        if(s.state==="completed" && refreshSchedule){
          await handleWeekYearChange(window.__avuState.currentYear, window.__avuState.currentWeek);
          hideStatusPanel();
        } else { setCalendarInteractivity(true); }
        stopGaugeOscillation();
        window.__avuState.runInFlight = false;
        updateStartBtnState(); updateLoadBtnState();
        recalcAndUpdateGauge({ animate:false });
        wireWeekSelector(); // make sure it’s live after any DOM churn
        resolve(s);
      }catch(e){
        console.error("Polling error:", e);
        clearInterval(timer);
        setStatus({ message:"Polling failed", progress:0, state:"error" });
        stopGaugeOscillation();
        window.__avuState.runInFlight=false;
        setCalendarInteractivity(true);
        updateStartBtnState(); updateLoadBtnState();
        wireWeekSelector();
        resolve({ state:"error", message:"Polling failed" });
      }
    }, 1200);
  });
}

/* -------------------------------------------------------------------------- */
/* Buttons enable/disable                                                     */
/* -------------------------------------------------------------------------- */
function updateLoadBtnState(){
  const btn=U.$("#loadScheduleBtn"); if(!btn) return;
  const calBusy = !!document.querySelector(".calendar-grid-container")?.classList.contains("is-busy");
  const shouldDisable = !window.__avuState.engineReady || window.__avuState.runInFlight || calBusy;
  btn.disabled = shouldDisable;
  btn.classList.toggle("opacity-50", shouldDisable);
  btn.classList.toggle("pointer-events-none", shouldDisable);
  btn.setAttribute("aria-disabled", String(shouldDisable));
  if (!window.__avuState.engineReady) btn.title = "Run Start AVU Engine first";
  else if (window.__avuState.filtersDirty) btn.title = "Apply filters & rebuild the calendar";
  else if (shouldDisable) btn.title = "Please wait…";
  else btn.title = "Reload calendar for the selected week";
}
function updateStartBtnState(){
  const btn=U.$("#startEngineBtn"); if(!btn) return;
  const disable = window.__avuState.engineReady || window.__avuState.runInFlight;
  btn.disabled = disable;
  btn.classList.toggle("opacity-50", disable);
  btn.classList.toggle("pointer-events-none", disable);
  btn.setAttribute("aria-disabled", String(disable));
  btn.title = disable ? "Engine already initialized" : "Start AVU Engine";
}
function setOfferButtonsEnabled(enabled){
  ["#generateOfferBtn","#generateTailorMadeOfferBtn"].map((s)=>U.$(s)).forEach((b)=>{
    if(!b) return;
    b.disabled = !enabled;
    b.classList.toggle("opacity-50", !enabled);
    b.classList.toggle("pointer-events-none", !enabled);
    b.setAttribute("aria-disabled", String(!enabled));
  });
}

/* -------------------------------------------------------------------------- */
/* Gauge (unchanged calculation; shortened here)                              */
/* -------------------------------------------------------------------------- */
const PRICE_INDEX = { "budget":0.20,"mid-range":0.40,"midrange":0.40,"premium":0.60,"luxury":0.80,"ultra luxury":1.00,"ultra-luxury":1.00,"ultra":1.00 };
const DEFAULT_BASELINES = { all:0.55, vip:0.75, gold:0.65, silver:0.50, bronze:0.35 };
const GAUGE = { raf:null, angle:0, targetAngle:0, oscillate:false, dom:{ needle:null, arc:null } };
function tierToIndex(t){ if(!t) return null; t=String(t).toLowerCase().trim(); if(PRICE_INDEX[t]!=null) return PRICE_INDEX[t];
  if(t.includes("ultra")) return PRICE_INDEX["ultra luxury"]; if(t.includes("luxury")) return PRICE_INDEX["luxury"];
  if(t.includes("premium")) return PRICE_INDEX["premium"]; if(t.includes("mid")) return PRICE_INDEX["mid-range"];
  if(t.includes("budget")||t.includes("<")||t.includes("cheap")) return PRICE_INDEX["budget"]; return null; }
function getSelectedLoyalty(){ const act=document.querySelector('#loyalty-group button.active'); return (act?.dataset?.value || "all").toLowerCase(); }
function getBaselineIndex(){ const map=(window.APP_CFG?.priceBaselineByLoyalty)||{}; const merged={...DEFAULT_BASELINES, ...map}; const key=getSelectedLoyalty(); return merged[key]??merged["all"]; }
function computeCalendarPriceIndex(){
  const cards = Array.from(document.querySelectorAll('#main-calendar-grid .wine-box'));
  if(!cards.length) return { avg:null, n:0 };
  const nums=[]; for(const c of cards){ const idx=tierToIndex(c.dataset.priceTier || ""); if(idx!=null) nums.push(idx); }
  if(!nums.length) return { avg:null, n:0 };
  return { avg: nums.reduce((a,b)=>a+b,0)/nums.length, n:nums.length };
}
function deltaToAngle(delta){ const clamped=Math.max(-1, Math.min(1, delta)); return clamped * 90; }
function setGaugeAngle(deg){ GAUGE.angle=deg; GAUGE.dom.needle ??= document.getElementById("gauge-needle"); GAUGE.dom.needle?.setAttribute("transform", `rotate(${deg} 100 100)`); }
function setGaugeTexts({ delta, avg }){ const elDelta=document.getElementById("gauge-delta-text"); if(elDelta){ const dir = delta>0.025?"↑ Over": (delta<-0.025?"↓ Under":"◎ Balanced"); elDelta.textContent = `${dir} · Δ=${Math.abs(delta).toFixed(2)}`; }
  const elVal=document.getElementById("gauge-cpi-value"); if(elVal) elVal.textContent=(avg??0).toFixed(2); }
function setGaugeFill(fr){ const totalLen=165.645; const on=Math.max(0, Math.min(1, fr))*totalLen; const off=totalLen-on+46.412; GAUGE.dom.arc ??= document.getElementById("gauge-fill-arc"); GAUGE.dom.arc?.setAttribute("stroke-dasharray", `${on} ${off}`); }
function recalcAndUpdateGauge({ animate=true } = {}){
  const { avg, n } = computeCalendarPriceIndex();
  const base = getBaselineIndex();
  if (avg == null) { setGaugeTexts({ delta:0, avg:0 }); setGaugeFill(0.2); setGaugeAngle(0); return; }
  const delta = avg - base; const normDelta = Math.max(-1, Math.min(1, delta/0.5)); const target = deltaToAngle(normDelta);
  setGaugeTexts({ delta, avg }); const conf = Math.max(0.1, Math.min(1, n/20)); setGaugeFill(conf);
  GAUGE.targetAngle = target; if(!animate || !GAUGE.oscillate){ setGaugeAngle(target); }
}
function startGaugeOscillation(){ if(GAUGE.raf) cancelAnimationFrame(GAUGE.raf); GAUGE.oscillate=true; const start=performance.now();
  const tick=(ts)=>{ const t=(ts-start)/1000; const wobble=Math.sin(t*2.2)*6; const ease=GAUGE.angle + (GAUGE.targetAngle - GAUGE.angle)*0.06; setGaugeAngle(ease + wobble); GAUGE.raf=requestAnimationFrame(tick); };
  GAUGE.raf=requestAnimationFrame(tick);
}
function stopGaugeOscillation(){ GAUGE.oscillate=false; if(GAUGE.raf) cancelAnimationFrame(GAUGE.raf); GAUGE.raf=null;
  const settle=()=>{ const diff = GAUGE.targetAngle - GAUGE.angle; if(Math.abs(diff)<0.5){ setGaugeAngle(GAUGE.targetAngle); return; }
    setGaugeAngle(GAUGE.angle + diff*0.15); requestAnimationFrame(settle); }; requestAnimationFrame(settle);
}
window.recalcAndUpdateGauge = recalcAndUpdateGauge;

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

// --- Unified notebook runner wiring ---
async function runNotebook(notebook, year, week, filters = {}) {
  const resp = await fetch("/api/run-notebook", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ notebook, year, week, filters })
  }).then(r=>r.json());
  const job = resp?.job_id;
  if (!job) throw new Error("no job_id");

  // Poll until completed
  for (let i=0;i<60;i++){
    const st = await fetch(`/api/status?job_id=${encodeURIComponent(job)}`).then(r=>r.json());
    if (st?.state === "completed") return true;
    await new Promise(r=>setTimeout(r, 1000));
  }
  throw new Error("Notebook timeout");
}

// --- Button wiring ---
document.addEventListener("DOMContentLoaded", async () => {
  buildCalendarSkeleton();
  wireCalendarDelegation();

  const y = window.__avuState?.currentYear ?? isoNowEurope().year;
  const w = window.__avuState?.currentWeek ?? isoNowEurope().week;

  // Initial paint (even if empty, renderDefaultScheduleFromData will fallback)
  await handleWeekYearChange(y, w);

  // Start AVU Engine
  document.getElementById("startEngineBtn")?.addEventListener("click", async () => {
    const yr = window.__avuState?.currentYear ?? y;
    const wk = window.__avuState?.currentWeek ?? w;
    try {
      await runNotebook("AVU_ignition_1.ipynb", yr, wk, /* filters */ {});
      await handleWeekYearChange(yr, wk);
    } catch (e) { console.error(e); }
  });

  // Load new schedule
  document.getElementById("loadScheduleBtn")?.addEventListener("click", async () => {
    const yr = window.__avuState?.currentYear ?? y;
    const wk = window.__avuState?.currentWeek ?? w;
    const filters = window.__avuFilters?.collectFilters?.() || {};
    try {
      await runNotebook("AVU_schedule_only.ipynb", yr, wk, filters);
      await handleWeekYearChange(yr, wk);
    } catch (e) { console.error(e); }
  });
});

/* -------------------------------------------------------------------------- */
/* Quick Add (unchanged)                                                      */
/* -------------------------------------------------------------------------- */
function wireQuickAdd() {
  const qa = {
    overlay: $("#qa-overlay"),
    label: $("#qa-slot-label"),
    input: $("#qa-wine"),
    list: $("#qa-suggestions"),
    vintage: $("#qa-vintage"),
    lockBtn: $("#qa-add-lock"),
    unlockBtn: $("#qa-add-unlock"),
    closeBtn: $("#qa-close")
  };
  if (!qa.overlay) return;
  let qaCtx = { day:null, slot:null, catalogHit:null };

  window.openQuickAdd = (day, slot)=>{
    qaCtx = { day, slot, catalogHit:null };
    qa.label.textContent = `${day}, slot ${Number(slot)+1}`;
    qa.input.value = ""; qa.list.innerHTML = ""; qa.vintage.innerHTML = "";
    qa.overlay.classList.remove("hidden"); setTimeout(()=> qa.input?.focus(), 20);
  };
  const close = ()=> qa.overlay?.classList.add("hidden");
  qa.closeBtn?.addEventListener("click", close);

  qa.input?.addEventListener("input", ()=>{
    const q = qa.input.value.trim();
    if (!q) { qa.list.innerHTML=""; qa.vintage.innerHTML=""; return; }
    clearTimeout(qa.input._t);
    qa.input._t = setTimeout(async ()=>{
      const res = await fetch(`${URLS.catalog}?q=${encodeURIComponent(q)}&limit=15`, { cache: "no-store" }).catch(()=>null);
      const data = await res?.json()?.catch(()=>null);
      const items = data?.items || [];
      qa.list.innerHTML = items.map(it => `
        <li data-wine="${encodeURIComponent(it.wine)}"
            data-vintages='${JSON.stringify(it.vintages || [])}'
            data-ids='${JSON.stringify(it.ids_by_vintage || {})}'
            data-region="${encodeURIComponent(it.region_group || 'Unknown')}"
            data-type="${encodeURIComponent(it.full_type || 'Unknown')}">
            <strong>${it.wine}</strong>
            <small> – ${it.full_type || 'Unknown'} • ${it.region_group || 'Unknown'}</small>
            <div><small>Vintages: ${(it.vintages || ['NV']).join(', ')}</small></div>
        </li>
      `).join("");
    }, 180);
  });
  qa.list?.addEventListener("click", (e)=>{
    const li = e.target.closest("li"); if(!li) return;
    const wine = decodeURIComponent(li.dataset.wine);
    const vintages = JSON.parse(li.dataset.vintages || "[]");
    const ids = JSON.parse(li.dataset.ids || "{}");
    const full_type = decodeURIComponent(li.dataset.type || "Unknown");
    const region_group = decodeURIComponent(li.dataset.region || "Unknown");
    qaCtx.catalogHit = { wine, ids, full_type, region_group };
    qa.input.value = wine; qa.list.innerHTML = ""; qa.vintage.innerHTML = "";
    const vList = (vintages && vintages.length) ? vintages : ["NV"];
    for (const v of vList) { const opt=document.createElement("option"); opt.value=v; opt.textContent=v; qa.vintage.appendChild(opt); }
  });

  async function confirmPlacement(lockIt){
    const day = qaCtx.day, slot=qaCtx.slot;
    const wine = qa.input.value.trim();
    const vintage = (qa.vintage.value || "NV").trim();
    if (!day || slot==null || !wine) return;
    const found = (qaCtx.catalogHit && qaCtx.catalogHit.wine === wine) ? qaCtx.catalogHit : null;
    const id = found?.ids ? (found.ids[vintage] || null) : null;
    const cell = document.querySelector(`.fill-box[data-day="${day}"][data-slot="${slot}"]`);
    if (cell) {
      const prevAuto = cell.querySelector('.wine-box:not([data-locked="true"])');
      if (prevAuto) prevAuto.remove();
      renderWineIntoBox(cell, {
        id, wine, vintage, full_type: found?.full_type, region_group: found?.region_group,
        avg_cpi_score: 0, match_quality: lockIt ? "Locked" : "Auto", locked: lockIt
      }, { locked: lockIt });
    }
    await Calendar.persistLockedCalendarState();
    await Calendar.persistFullCalendarSnapshot();
    recalcAndUpdateGauge({ animate: true });
    await window.notifySelectedWine({ id, wine, vintage, day, slot }).catch(()=>{});
    close();
  }
  qa.lockBtn?.addEventListener("click", () => confirmPlacement(true));
  qa.unlockBtn?.addEventListener("click", () => confirmPlacement(false));
}

/* -------------------------------------------------------------------------- */
/* DEV bootstrap                                                              */
/* -------------------------------------------------------------------------- */
async function isoNow() {
  const d = new Date();
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(),0,4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay()+6)%7)) / 7);
  return { year: target.getUTCFullYear(), week };
}

async function devBootstrapFromSchedule() {
  try {
    const url = new URL(window.location.href);
    const forceDev = url.searchParams.get("dev") === "1";
    const alreadyHasCards = !!document.querySelector(".wine-box");
    if (!forceDev && alreadyHasCards) return;

    // skeleton + lanes
    Calendar.buildCalendarSkeleton();
    ensureLeadsLanes();
    Calendar.wireCalendarDelegation();

    const y = window.__avuState?.currentYear ?? (await isoNow()).year;
    const w = window.__avuState?.currentWeek ?? (await isoNow()).week;

    const resp = await fetch(`/api/schedule?year=${y}&week=${w}`, { cache: "no-store" }).then(r => r.json()).catch(() => null);
    const cal  = resp?.weekly_calendar || resp || {};

    try {
      const idx = await fetch("/api/campaign_index", { cache: "no-store" }).then(r=>r.json());
      window.__avuState.CAMPAIGN_INDEX = { by_id: idx?.by_id || {}, by_name: idx?.by_name || {} };
    } catch {}

    Calendar.clearCalendar();
    Calendar.buildCalendarSkeleton();
    ensureLeadsLanes();
    Calendar.wireCalendarDelegation();
    Calendar.renderDefaultScheduleFromData(cal);
    Calendar.fillEmptySlotsFromPool(cal);
    await Calendar.fetchAndRenderLeads();

    console.log("[dev] calendar hydrated from /api/schedule for", { y, w });
  } catch (e) {
    console.warn("[dev] bootstrap failed:", e);
  }
}

// ---- Legacy leads → lane chips bridge (stacked A/B/C; no overlap)
(function initLeadsLaneBridge(){
  const DAY_INDEX = { Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6, Sunday:7 };

  function ensureLanes() {
    const grid = document.getElementById('main-calendar-grid');
    if (!grid) return null;
    let lanes = grid.querySelector('.leads-lanes');
    if (!lanes) {
      lanes = document.createElement('div');
      lanes.className = 'leads-lanes';
      for (let i = 0; i < 3; i++) {
        const lane = document.createElement('div');
        lane.className = 'lead-lane';
        lane.dataset.lane = String(i);
        lanes.appendChild(lane);
      }
      grid.prepend(lanes);
    }
    return lanes;
  }

  function extractDay(el) {
    // Prefer data-day on .day-column, else read the name
    const col = el.closest('.day-column');
    const d = col?.dataset?.day ||
              col?.querySelector('.day-name')?.textContent?.trim();
    return DAY_INDEX[d] || 1;
  }

  function extractSpan(el) {
    // class like leads-span-2 or data-span
    const ds = parseInt(el.dataset?.span || 0, 10);
    if (ds > 0) return Math.min(7, Math.max(1, ds));
    const m = el.className.match(/\bleads-span-(\d)\b/);
    return m ? Math.min(7, Math.max(1, parseInt(m[1], 10))) : 1;
  }

  function buildChip({ start, span, title, meta, laneIdx }) {
    const chip = document.createElement('div');
    chip.className = 'lead-chip';
    chip.style.setProperty('--start', String(start));
    chip.style.setProperty('--span',  String(span));
    chip.innerHTML = `
      <span class="title">${title || 'Lead'}</span>
      ${meta ? `<span class="meta">${meta}</span>` : ''}
    `;
    const lanesRoot = ensureLanes();
    const lane = lanesRoot?.querySelector(`.lead-lane[data-lane="${laneIdx}"]`);
    (lane || lanesRoot)?.appendChild(chip);
  }

  function convertLegacyToChips() {
    const lanesRoot = ensureLanes();
    if (!lanesRoot) return;

    // Clear existing chips so we can re-render cleanly
    lanesRoot.querySelectorAll('.lead-chip').forEach(n => n.remove());

    // Collect any legacy elements calendar.js produced
    const legacy = [
      ...document.querySelectorAll('.leads-band'),
      ...document.querySelectorAll('.fill-box.leads-box'),
      ...document.querySelectorAll('.leads-drawer')
    ];

    if (!legacy.length) return;

    // Round-robin lanes A(0) → B(1) → C(2)
    let laneIdx = 0;

    legacy.forEach(el => {
      const start = extractDay(el);
      const span  = extractSpan(el);
      const title = el.querySelector('.leads-title')?.textContent?.trim()
                  || el.querySelector('.leads-label')?.textContent?.trim()
                  || el.getAttribute('data-title')
                  || el.textContent.trim();
      const meta  = el.querySelector('.leads-meta')?.textContent?.trim()
                  || el.getAttribute('data-meta')
                  || '';

      buildChip({ start, span, title, meta, laneIdx });
      laneIdx = (laneIdx + 1) % 3;

      // Remove legacy node to avoid duplicates
      el.remove();
    });
  }

  // Expose a hook so we can call after any render
  window.__renderLeadsChipsFromLegacy = convertLegacyToChips;
})();

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */
async function boot(){
  // config for gauge baselines
  window.APP_CFG = await fetch("/static/config/ui_config.json", { cache:"no-store" }).then(r=>r.ok?r.json():{}).catch(()=>({}));

  // init week
  const iso = isoNowEurope();
  window.__avuState.currentYear = parseInt(sessionStorage.getItem("selectedYear") || iso.year, 10);
  window.__avuState.currentWeek = parseInt(sessionStorage.getItem("selectedWeek") || iso.week, 10);

  // build UI
  Filters.ensureFiltersDock();
  window.setOfferButtonsEnabled(!!window.__avuState.selectedWineData);
  Calendar.clearCalendar();
  Calendar.buildCalendarSkeleton();
  ensureLeadsLanes();
  Calendar.wireCalendarDelegation();
  wireWeekSelector();      // <— make selector live immediately
  Calendar.fetchAndRenderLeads();

  // try snapshot first
  const snap = Calendar.loadFullCalendarSnapshot(window.__avuState.currentYear, window.__avuState.currentWeek);
  if (snap) Calendar.renderFullFromData(snap);
  else {
    const locked = await Calendar.fetchLockedForWeek(window.__avuState.currentWeek, window.__avuState.currentYear);
    if (locked && Object.keys(locked).length) Calendar.renderLockedOnlyFromData(locked);
  }

  // Filters wiring
  $("#loyalty-group")?.addEventListener("click", (e)=>{ const btn=e.target.closest("button"); if(!btn) return; $all("#loyalty-group button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#wine-type-group")?.addEventListener("click", (e)=>{ const btn=e.target.closest("button"); if(!btn) return; $all("#wine-type-group button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#bottle-size-slicer")?.addEventListener("change",(e)=>{ const v=e.target.value; const bigger=$("#bigger-size-selector"); if(v==="bigger"){ if(bigger && !bigger.options.length){ [3000,4500,6000,9000,12000].forEach(ml=>{ const o=document.createElement("option"); o.value=String(ml); o.textContent=`${(ml/1000).toFixed(1)}L`; bigger.appendChild(o); }); } bigger?.classList.remove("hidden"); } else { bigger?.classList.add("hidden"); } if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#bigger-size-selector")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#price-tier")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#last-stock-checkbox")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#seasonality-checkbox")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $all(".cruise-button-small").forEach((b)=> b.addEventListener("click", ()=>{ const isActive=b.classList.contains("active"); $all(".cruise-button-small").forEach(x=>x.classList.remove("active")); if(!isActive) b.classList.add("active"); if(window.__avuState.engineReady) Filters.markFiltersDirty(); }));

  // Week selector change (final safety)
  wireWeekSelector();

  // Buttons
  $("#startEngineBtn")?.addEventListener("click", startFullEngine);
  $("#loadScheduleBtn")?.addEventListener("click", loadNewSchedule);

  wireQuickAdd();
  recalcAndUpdateGauge({ animate:false });
  updateStartBtnState(); updateLoadBtnState();

  // dev bootstrap if grid is empty
  if (!document.querySelector(".wine-box")) {
    try { await devBootstrapFromSchedule(); } catch {}
  }
}

// Boot
(function ready(fn){
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
})(boot);

// optional: manual rescue from console
window.__avuBoot = boot;
window.__DEV_HYDRATE__ = devBootstrapFromSchedule;
