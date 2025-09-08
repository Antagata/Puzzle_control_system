// static/app.js  (tiny orchestrator)
import { $, $all, URLS, isoNowEurope, getJSON, postJSON } from "./js/utils.js";
import * as Filters from "./js/filters.js";
import * as Calendar from "./js/calendar.js";
import * as Cards from "./js/cards.js";


// ---- global state (shared across modules via window)
window.__avuState = {
  engineReady: false,            
  isWeekLoading: false,
  runInFlight: false,
  selectedWineEl: null,
  selectedWineData: (()=>{ try{return JSON.parse(sessionStorage.getItem("selectedWine"))}catch{return null} })(),
  currentYear: isoNowEurope().year,
  currentWeek: isoNowEurope().week,
  CAMPAIGN_INDEX: { by_id:{}, by_name:{} },
  isoNow: isoNowEurope
};

// expose a few hooks used by modules (keeps coupling low)
window.updateLoadBtnState = updateLoadBtnState;
window.setOfferButtonsEnabled = setOfferButtonsEnabled;
window.recalcAndUpdateGauge = recalcAndUpdateGauge;
window.notifySelectedWine = async (selection)=>{ try{ await postJSON(URLS.selectedWine, selection || {}); }catch{} };
window.__avuFilters = Filters;
window.__avuApi = Calendar.__api;
window.__avuCards = Cards;

// ===== Status panel & busy states (trimmed to essentials) =====
function showStatusPanel(){ const el=$("#status-panel"); if(!el) return; el.classList.remove("hidden"); el.style.display="flex"; setStatusBadge("running"); setCalendarInteractivity(false); }
function hideStatusPanel(){ const el=$("#status-panel"); if(!el) return; el.classList.add("hidden"); el.style.display="none"; setCalendarInteractivity(true); }
function setStatus({ message="", progress=0, state="" }) {
  $("#status-message").textContent = message || "";
  $("#progress-bar-fill").style.width = `${Math.max(0, Math.min(100, progress))}%`;
  $("#progress-percent").textContent = `${Math.round(progress)}%`;
  if (state) setStatusBadge(state);
}
function setStatusBadge(state) {
  const badge=$("#status-badge"); if(!badge) return;
  const s=String(state||"idle").toLowerCase();
  badge.textContent=s.charAt(0).toUpperCase()+s.slice(1);
  badge.className="badge";
  badge.classList.add(s==="running"?"badge-running": s==="completed"?"badge-completed": s==="error"?"badge-error":"badge-idle");
}
function setCalendarInteractivity(enabled){
  const cal = document.getElementById("main-calendar-grid")?.closest(".calendar-grid-container");
  if(!cal) return;
  cal.setAttribute("aria-busy", String(!enabled));
  cal.classList.toggle("is-busy", !enabled);
  try { if (!enabled) cal.setAttribute("inert", ""); else cal.removeAttribute("inert"); } catch {}
  const sel = $("#weekSelector"); if (sel) sel.disabled = !enabled;
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
        const s = await getJSON(URLS.status);
        setStatus({ message:s.message, progress:s.progress, state:s.state });
        const finished = (s.state==="completed") || (s.state==="error") || Number(s.progress)>=100;
        if(!finished) return;
        clearInterval(timer);
        setStatusBadge(s.state);
        if(s.state==="completed" && refreshSchedule){
          await Calendar.handleWeekYearChange(window.__avuState.currentYear, window.__avuState.currentWeek);
          hideStatusPanel();
        } else { setCalendarInteractivity(true); }
        stopGaugeOscillation();
        window.__avuState.runInFlight = false;
        updateStartBtnState(); updateLoadBtnState();
        recalcAndUpdateGauge({ animate:false });
        resolve(s);
      }catch(e){
        console.error("Polling error:", e);
        clearInterval(timer);
        setStatus({ message:"Polling failed", progress:0, state:"error" });
        stopGaugeOscillation();
        window.__avuState.runInFlight=false;
        setCalendarInteractivity(true);
        updateStartBtnState(); updateLoadBtnState();
        resolve({ state:"error", message:"Polling failed" });
      }
    }, 1200);
  });
}

// ===== Buttons enable/disable =====
function updateLoadBtnState(){
  const btn=$("#loadScheduleBtn"); if(!btn) return;
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
  const btn=$("#startEngineBtn"); if(!btn) return;
  const disable = window.__avuState.engineReady || window.__avuState.runInFlight;
  btn.disabled = disable;
  btn.classList.toggle("opacity-50", disable);
  btn.classList.toggle("pointer-events-none", disable);
  btn.setAttribute("aria-disabled", String(disable));
  btn.title = disable ? "Engine already initialized" : "Start AVU Engine";
}
function setOfferButtonsEnabled(enabled){
  ["#generateOfferBtn","#generateTailorMadeOfferBtn"].map((s)=>$(s)).forEach((b)=>{
    if(!b) return;
    b.disabled = !enabled;
    b.classList.toggle("opacity-50", !enabled);
    b.classList.toggle("pointer-events-none", !enabled);
    b.setAttribute("aria-disabled", String(!enabled));
  });
}

// ===== Gauge (same math; condensed) =====
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
window.recalcAndUpdateGauge = recalcAndUpdateGauge; // expose

// ===== Actions =====
async function startFullEngine(){
  if (window.__avuState.engineReady) { window.showToast?.("Engine already initialized."); return; }
  if (window.__avuState.runInFlight) return;
  showStatusPanel(); setStatus({ message:"Starting full engine…", progress:0, state:"running" }); setCalendarInteractivity(false);
  try {
    await postJSON(URLS.runFull, {});
    await pollStatusUntilDone({ });
    window.__avuState.engineReady = true;
    updateStartBtnState(); updateLoadBtnState(); Filters.setFiltersEnabled(true);
  } catch (e) {
    console.error(e); setStatus({ message:"Failed to start full engine", progress:0, state:"error" });
  } finally { setCalendarInteractivity(true); }
}

async function loadNewSchedule() {
  const week = parseInt(document.getElementById("weekSelector")?.value || window.__avuState.currentWeek, 10);
  const year = window.__avuState.currentYear;
  if (!window.__avuState.engineReady) { alert("Run Start AVU Engine first."); return; }
  if (window.__avuState.runInFlight) return;

  const btn = $("#loadScheduleBtn"); if (btn) btn.disabled = true;
  showStatusPanel(); setStatus({ message:`⏳ Building schedule for ${year}-W${week}...`, progress:0, state:"running" });
  $("#status-notebook").textContent = "AVU_schedule_only.ipynb";
  setCalendarInteractivity(false);

  try {
    await postJSON(URLS.runNotebook, {
      mode: "partial",
      calendar_year: year,
      week_number: week,
      filters: Filters.mapUIFiltersForBackend(),
      locked_calendar: Calendar.readDOMLockedState(),
      ui_selection: window.__avuState.selectedWineData || null
    });
    await pollStatusUntilDone({});
  } catch(e){
    console.error(e); setStatus({ message:`Failed to start schedule-only run: ${e.message}`, progress:0, state:"error" });
  } finally {
    setCalendarInteractivity(true); updateLoadBtnState();
  }
}

// ===== Quick Add (kept simple; uses existing markup) =====
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
      Cards.renderWineIntoBox(cell, {
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

// ===== Boot =====
async function boot(){
  // expose some config for gauge baselines (optional file)
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
  Calendar.wireCalendarDelegation();
  Calendar.fetchAndRenderLeads();

  // try snapshot first
  const snap = Calendar.loadFullCalendarSnapshot(window.__avuState.currentYear, window.__avuState.currentWeek);
  if (snap) Calendar.renderFullFromData(snap);
  else {
    const locked = await Calendar.fetchLockedForWeek(window.__avuState.currentWeek, window.__avuState.currentYear);
    if (locked && Object.keys(locked).length) Calendar.renderLockedOnlyFromData(locked);
  }

  // Wire filters
  $("#loyalty-group")?.addEventListener("click", (e)=>{ const btn=e.target.closest("button"); if(!btn) return; $all("#loyalty-group button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#wine-type-group")?.addEventListener("click", (e)=>{ const btn=e.target.closest("button"); if(!btn) return; $all("#wine-type-group button").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#bottle-size-slicer")?.addEventListener("change",(e)=>{ const v=e.target.value; const bigger=$("#bigger-size-selector"); if(v==="bigger"){ if(bigger && !bigger.options.length){ [3000,4500,6000,9000,12000].forEach(ml=>{ const o=document.createElement("option"); o.value=String(ml); o.textContent=`${(ml/1000).toFixed(1)}L`; bigger.appendChild(o); }); } bigger?.classList.remove("hidden"); } else { bigger?.classList.add("hidden"); } if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#bigger-size-selector")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#price-tier")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#last-stock-checkbox")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $("#seasonality-checkbox")?.addEventListener("change", ()=>{ if(window.__avuState.engineReady) Filters.markFiltersDirty(); });
  $all(".cruise-button-small").forEach((b)=> b.addEventListener("click", ()=>{
    const isActive=b.classList.contains("active"); $all(".cruise-button-small").forEach(x=>x.classList.remove("active")); if(!isActive) b.classList.add("active");
    if(window.__avuState.engineReady) Filters.markFiltersDirty();
  }));

  // Week selector change
  $("#weekSelector")?.addEventListener("change",(e)=>{ const wk=String(e.target.value); sessionStorage.setItem("selectedWeek", wk); Filters.resetFiltersToDefault(); Calendar.handleWeekChange(wk); });

  // Buttons
  $("#startEngineBtn")?.addEventListener("click", startFullEngine);
  $("#loadScheduleBtn")?.addEventListener("click", loadNewSchedule);

  wireQuickAdd();
  recalcAndUpdateGauge({ animate:false });
  updateStartBtnState(); updateLoadBtnState();
}

// new
(function ready(fn){
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
})(boot);

// optional: manual rescue from console
window.__avuBoot = boot;

