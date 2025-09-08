// static/js/calendar.js
// ------------------------------------------------------------
// SYNC:  buildCalendarSkeleton, wireCalendarDelegation,
//        renderDefaultScheduleFromData, renderFullFromData, handleWeekChange
// ASYNC: handleWeekYearChange, fetchAndRenderLeads (+ optional persistence)
// ------------------------------------------------------------

import {
  $, $all, CAL, URLS, NUM_SLOTS, DAYS,
  weekSnapKey, weekLockedKey, getJSON, postJSON
} from "./utils.js";
import { renderWineIntoBox, addDropZoneListeners } from "./cards.js";
import { filterCalendarByUIFilters, mapUIFiltersForBackend } from "./filters.js";

// Leads module (sync exports only; no dynamic import/await here)
import { ensureLeadsLanes, renderLeadsFromData, getLeadsForWeek } from "./leads.js";
export { ensureLeadsLanes, renderLeadsFromData, getLeadsForWeek }; // convenience re-export

/* -------------------- helpers -------------------- */

function isoWeek(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7; // Mon=0
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { year: dt.getUTCFullYear(), week };
}

function isCalendarLike(obj) {
  if (!obj || typeof obj !== "object") return false;
  return DAYS.every((d) => Array.isArray(obj[d]));
}

// Fallback demo data if API is empty or malformed
function demoCalendarData() {
  const mk = (name, vintage, opts={}) => ({
    id: `${name}-${Math.random().toString(36).slice(2)}`,
    wine: name,
    vintage: vintage || 'NV',
    priceTier: opts.priceTier || 'Mid-range',
    stock: opts.stock ?? 24,
    cpiScore: opts.cpiScore ?? 0.5,
    type: opts.type || 'red',
    locked: !!opts.locked,
    auto: !!opts.auto,
  });
  return {
    Monday:    [ mk('Nebbiolo','2019',{cpiScore:.66}), mk('Grüner','2021',{type:'white'}) ],
    Tuesday:   [ mk('Pinot Noir','2020',{locked:true}), mk('Champagne','NV',{type:'sparkling'}) ],
    Wednesday: [ mk('Barolo','2016',{priceTier:'Premium',auto:true}) ],
    Thursday:  [ mk('Syrah','2018'), mk('Sancerre','2022',{type:'white'}) ],
    Friday:    [ mk('Rioja','2017',{locked:true}), mk('Rosé','2023',{type:'rose'}) ],
    Saturday:  [ mk('Bordeaux','2015',{priceTier:'Luxury'}) ],
    Sunday:    [ mk('Amarone','2018') ],
  };
}

/* -------------------- week selector -------------------- */

function ensureWeekSelector() {
  const sel = document.getElementById("weekSelector");
  if (!sel) return;

  window.__avuState = window.__avuState || {};
  const { year, week } = isoWeek();

  if (!sel.options.length) {
    for (let w = 1; w <= 53; w++) {
      const opt = document.createElement("option");
      opt.value = String(w);
      opt.textContent = `Week ${w}`;
      if (w === week) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  sel.disabled = false;
  sel.classList.remove("opacity-50", "pointer-events-none");

  if (!sel.__avuWired) {
    sel.addEventListener("change", (e) => {
      const wk = parseInt(e.target.value || week, 10) || week;
      handleWeekYearChange(window.__avuState.currentYear || year, wk);
    });
    sel.__avuWired = true;
  }

  if (!window.__avuState.currentYear || !window.__avuState.currentWeek) {
    window.__avuState.currentYear = parseInt(sessionStorage.getItem("selectedYear") || year, 10);
    window.__avuState.currentWeek = parseInt(sessionStorage.getItem("selectedWeek") || week, 10);
    const opt = sel.querySelector(`option[value="${window.__avuState.currentWeek}"]`);
    if (opt) opt.selected = true;
  }
}

/* -------------------- calendar skeleton (SYNC) -------------------- */

export function clearCalendar() {
  $all(".fill-box").forEach((b) => {
    b.innerHTML = "";
    b.classList.remove("filled", "active", "over", "empty");
  });
  $all(".overflow-drawer, .leads-drawer").forEach((drawer) => {
    $all(".wine-box", drawer).forEach((c) => c.remove());
    drawer.classList.remove("active");
  });
  const lanes = document.querySelector(".leads-lanes");
  if (lanes) lanes.innerHTML = "";
}

export function buildCalendarSkeleton() {
  const grid = document.getElementById("main-calendar-grid");
  if (!grid) return;

  grid.innerHTML = "";

  // Row 1: leads lanes (3 lanes total)
  ensureLeadsLanes(grid, 3);

  // Row 2: day columns with NUM_SLOTS and an overflow drawer
  DAYS.forEach((day) => {
    const col = document.createElement("div");
    col.className = "day-column";
    col.innerHTML = `<div class="day-name">${day}</div>`;

    const body = document.createElement("div");
    body.className = "day-body";

    for (let i = 0; i < NUM_SLOTS; i++) {
      const box = document.createElement("div");
      box.className = "fill-box empty";
      box.dataset.day  = day;
      box.dataset.slot = String(i);
      box.addEventListener("click", () => window.openQuickAdd?.(day, i));
      box.addEventListener("contextmenu", (e) => e.preventDefault());
      body.appendChild(box);
    }

    const overflow = document.createElement("div");
    overflow.className = "overflow-drawer";
    overflow.dataset.day = day;

    col.appendChild(body);
    col.appendChild(overflow);
    grid.appendChild(col);
  });

  addDropZoneListeners?.();
  ensureWeekSelector();

  // Notify others the calendar DOM is ready
  window.dispatchEvent(new CustomEvent("calendar:ready", {
    detail: {
      year: window.__avuState?.currentYear,
      week: window.__avuState?.currentWeek
    }
  }));
}

export function wireCalendarDelegation() {
  const wrap = CAL();
  if (!wrap || wrap.__delegationWired) return;

  wrap.addEventListener("click", (e) => {
    const lockBtn = e.target.closest(".lock-icon");
    if (lockBtn) return;
    const card = e.target.closest(".wine-box");
    if (card) { e.stopPropagation(); window.__avuCards?.toggleSelectWine?.(card); }
  });

  wrap.addEventListener("contextmenu", (e) => {
    const card = e.target.closest(".wine-box");
    if (card) { e.preventDefault(); e.stopPropagation(); window.__avuCards?.showWineContextMenu?.(card, e.clientX, e.clientY); }
  });

  wrap.__delegationWired = true;
}

/* -------------------- renderers -------------------- */

export function renderDefaultScheduleFromData(calendarLike, maxSlotsPerDay = NUM_SLOTS) {
  const cal = calendarLike?.weekly_calendar || calendarLike;
  const data = isCalendarLike(cal) ? cal : demoCalendarData();

  let placed = false;
  Object.keys(data).forEach((day) => {
    const items = Array.isArray(data[day]) ? data[day] : [];
    items.forEach((it, idx) => {
      const target =
        (idx < maxSlotsPerDay && document.querySelector(`.fill-box[data-day="${day}"][data-slot="${idx}"]`)) ||
        document.querySelector(`.overflow-drawer[data-day="${day}"]`);
      if (!target) return;
      renderWineIntoBox(target, it, { locked: !!it.locked });
      target.classList.add("filled");
      placed = true;
    });
  });
  addDropZoneListeners?.();
  return placed;
}

export function renderFullFromData(calendar) {
  if (!isCalendarLike(calendar)) return false;
  clearCalendar();
  buildCalendarSkeleton();
  wireCalendarDelegation();

  let placed = false;
  DAYS.forEach((day) => {
    const arr = Array.isArray(calendar?.[day]) ? calendar[day] : [];
    arr.slice(0, NUM_SLOTS).forEach((it, idx) => {
      if (!it) return;
      const box = document.querySelector(`.fill-box[data-day="${day}"][data-slot="${idx}"]`);
      if (!box) return;
      renderWineIntoBox(box, it, { locked: !!it.locked });
      placed = true;
    });
  });

  window?.recalcAndUpdateGauge?.({ animate: false });
  return placed;
}

// --- calendar.js (add) ---
// Minimal load function so director_app.js can call it safely.
export function loadFullCalendarSnapshot(
  year = window.__avuState?.currentYear,
  week = window.__avuState?.currentWeek
) {
  try {
    const key = weekSnapKey(year, week);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // If you have renderFullFromData, use it; otherwise fall back:
    if (typeof renderFullFromData === "function") {
      renderFullFromData(snap);
    } else {
      renderDefaultScheduleFromData(snap);
    }
    return snap;
  } catch {
    return null;
  }
}
/* -------------------- week switching pipeline -------------------- */

// Guard optional helpers if they aren't defined/imported yet
const hasFn = (name) => typeof (/** @type {any} */(globalThis))[name] === 'function';

export async function handleWeekYearChange(newYear, newWeek) {
  window.__avuState = window.__avuState || {};
  if (window.__avuState.isWeekLoading) return;
  window.__avuState.isWeekLoading = true;

  const wrap = CAL();
  if (wrap) { wrap.setAttribute("aria-busy","true"); wrap.classList.add("is-busy"); }

  try {
    const prevY = window.__avuState.currentYear;
    const prevW = window.__avuState.currentWeek;

    if (prevY && prevW && (prevY !== newYear || prevW !== newWeek)) {
      if (hasFn('persistLockedCalendarState')) { try { await persistLockedCalendarState(prevY, prevW); } catch {} }
      if (hasFn('persistFullCalendarSnapshot')) { try { await persistFullCalendarSnapshot(prevY, prevW); } catch {} }
    }

    window.__avuState.currentYear = parseInt(newYear, 10);
    window.__avuState.currentWeek = parseInt(newWeek, 10);
    sessionStorage.setItem("selectedYear", String(window.__avuState.currentYear));
    sessionStorage.setItem("selectedWeek", String(window.__avuState.currentWeek));

    clearCalendar();
    buildCalendarSkeleton();
    wireCalendarDelegation();

    let locked=null, schedule=null, leads=null;
    try {
      const p1 = hasFn('fetchLockedForWeek')          ? fetchLockedForWeek(window.__avuState.currentWeek, window.__avuState.currentYear) : Promise.resolve(null);
      const p2 = hasFn('fetchDefaultScheduleForWeek') ? fetchDefaultScheduleForWeek(window.__avuState.currentWeek, window.__avuState.currentYear) : Promise.resolve(null);
      const p3 = getLeadsForWeek(window.__avuState.currentYear, window.__avuState.currentWeek);
      [locked, schedule, leads] = await Promise.all([p1, p2, p3]);
    } catch {}

    if (locked && Object.keys(locked).length && hasFn('renderLockedOnlyFromData')) {
      renderLockedOnlyFromData(locked);
    }

    const didPlace = renderDefaultScheduleFromData(schedule);
    if (!didPlace) console.warn("[calendar] server schedule not usable; rendered demo data");

    if (leads) {
      const payload = leads?.leads || leads;
      renderLeadsFromData(Array.isArray(payload) ? payload : []);
    }

    if (hasFn('persistLockedCalendarState')) { try { await persistLockedCalendarState(window.__avuState.currentYear, window.__avuState.currentWeek); } catch {} }
    if (hasFn('persistFullCalendarSnapshot')) { try { await persistFullCalendarSnapshot(window.__avuState.currentYear, window.__avuState.currentWeek); } catch {} }

    window.dispatchEvent(new CustomEvent("calendar:week-changed", {
      detail: { year: window.__avuState.currentYear, week: window.__avuState.currentWeek }
    }));

    window?.recalcAndUpdateGauge?.({ animate:false });
  } finally {
    if (wrap) { wrap.removeAttribute("aria-busy"); wrap.classList.remove("is-busy"); }
    window.__avuState.isWeekLoading = false;
  }
}

// Snap full calendar DOM → localStorage (fallback implementation)
export async function persistFullCalendarSnapshot(
  year = window.__avuState?.currentYear,
  week = window.__avuState?.currentWeek
) {
  try {
    const snap = typeof readDOMFullState === "function" ? readDOMFullState() : null;
    if (snap) localStorage.setItem(weekSnapKey(year, week), JSON.stringify(snap));
  } catch {}
}

// Snap locked state → localStorage (fallback implementation)
export async function persistLockedCalendarState(
  year = window.__avuState?.currentYear,
  week = window.__avuState?.currentWeek
) {
  try {
    const locked = typeof readDOMLockedState === "function" ? readDOMLockedState() : null;
    if (locked) localStorage.setItem(weekLockedKey(year, week), JSON.stringify(locked));
  } catch {}
}

// Convenience wrapper — call this from UI when only the week changes.
export function handleWeekChange(wk) {
  return handleWeekYearChange(window.__avuState?.currentYear, parseInt(wk, 10));
}

/* -------------------- optional convenience -------------------- */

export async function fetchAndRenderLeads(
  year = window.__avuState?.currentYear,
  week = window.__avuState?.currentWeek
) {
  if (!year || !week) return;
  const payload = await getLeadsForWeek(year, week).catch(() => null);
  if (!payload) return;
  renderLeadsFromData(payload);
}

/* -------------------- tiny API exposed to other modules -------------------- */

export const __api = {
  async fetchLockedForWeek(week, year) {
    if (hasFn('fetchLockedForWeek')) return fetchLockedForWeek(week, year);
    return null;
  },
  async saveLocked(year, week, payload) {
    return postJSON(URLS.locked, { year, week, locked_calendar: payload });
  },
  async loadCampaignIndex() { /* unchanged */ /* ... */ }
};

// --- No-op snapshot functions to avoid crashes ---
export async function loadFullCalendarSnapshot(year, week) {
  // return null to indicate "no snapshot" (avoid crashes)
  return null;
}

export async function persistFullCalendarSnapshot(year, week) {
  // no-op stub (keeps callers happy)
  return true;
}

export async function persistLockedCalendarState(year, week) {
  // no-op stub (keeps callers happy)
  return true;
}
