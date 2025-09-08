// static/director_app.js
// Cache-buster beacon: confirm you're seeing this exact line on reload.
console.log("[AVU] director_app sweep v3 +v20250908c");

// ---------- Canonical imports (ESM only; no globals) ----------
import * as U from "./js/utils.js?v=20250908c";
import {
  buildCalendarSkeleton,
  clearCalendar,
  handleWeekYearChange,
  renderDefaultScheduleFromData,
  loadFullCalendarSnapshot,
  wireCalendarDelegation,
} from "./js/calendar.js?v=20250908c";
import {
  renderWineIntoBox,
  addDropZoneListeners,
  wireCardInteractions,
} from "./js/cards.js?v=20250908c";
import { ensureLeadsLanes } from "./js/leads.js?v=20250908c";
// Remove all global Calendar.*, Cards.*, Filters.* usage; use direct imports above

// Always use namespaced utils: U.$, U.$all, U.getJSON, etc.
const { URLS, isoNowEurope } = U;

// ---------- Module-local state (single source of truth) ----------
const App = {
  year: null,
  week: null,
  setYearWeek(y, w) {
    this.year = +y;
    this.week = +w;
    // Legacy compatibility (read-only) — keep if other modules read window.CAL
    window.CAL = { year: this.year, week: this.week };
  },
  getYearWeek() {
    if (!this.year || !this.week) {
      const iso = isoNowEurope("Europe/Zurich");
      this.setYearWeek(iso.year, iso.week);
    }
    return { year: this.year, week: this.week };
  },
};

// ---------- Optional: Filters toggle kept minimal & safe ----------
const FILTERS_VISIBLE_KEY = "ui:filters:visible";

function findFiltersPanel() {
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

  // Layout widening (if you have these IDs)
  const layout = U.$("#appLayout") || U.$('[data-role="layout"]') || U.$(".app-layout");
  const calendarArea = U.$("#calendar-area") || U.$("#calendar-grid")?.parentElement;

  document.body.classList.toggle("filters-on", visible);
  document.body.classList.toggle("filters-off", !visible);

  if (layout) {
    layout.classList.add("grid");
    layout.classList.toggle("grid-cols-1", !visible);
    layout.classList.toggle("grid-cols-[320px_1fr]", visible);
  }
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
    btn.querySelector('[data-role="knob"]')?.classList.toggle("translate-x-5", visible);
  }
}
function ensureFiltersToggle() {
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
    host.prepend(btn);
    btn.addEventListener("click", () => {
      const next = !loadFiltersVisible();
      setFiltersVisible(next);
    });
  }
  // Always hide filters on app start
  setFiltersVisible(false);
}

// ---------- UI wiring ----------
function wireWeekSelector() {
  const sel = U.$("#weekSelector");
  if (!sel) {
    console.warn("[weekSelector] #weekSelector not found in DOM");
    return;
  }

  // Populate week options for current year
  const { year: currentYear, week: currentWeek } = App.getYearWeek();
  const weeksInYear = 53; // ISO weeks can go up to 53
  let options = "";
  for (let y = currentYear - 1; y <= currentYear + 1; ++y) {
    for (let w = 1; w <= weeksInYear; ++w) {
      const label = `${y} - Week ${w}`;
      const value = `${y}-W${w.toString().padStart(2, "0")}`;
      const selected = (y === currentYear && w === currentWeek) ? "selected" : "";
      options += `<option value="${value}" ${selected}>${label}</option>`;
    }
  }
  sel.innerHTML = options;
  sel.disabled = false;
  console.log("[weekSelector] Populated weekSelector with options", sel.options.length);

  sel.addEventListener("change", async (e) => {
    const val = String(e.target.value);
    const m = val.match(/(\d{4})-W?(\d{1,2})/);
    let { year, week } = App.getYearWeek();
    if (m) { year = +m[1]; week = +m[2]; }
    else if (!Number.isNaN(+val)) { week = +val; }

    App.setYearWeek(year, week);
    clearCalendar();
    buildCalendarSkeleton();
    // (DnD listeners are added inside buildCalendarSkeleton, but if you
    // rebuild elsewhere, make sure to call it before painting.)
    await handleWeekYearChange(year, week);
  });
}

function wireStartButton() {
  const btn = U.$("#startEngineBtn");
  if (!btn) return;

  btn.disabled = false;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const runUrl = URLS.runFull || "/run_full_engine";
      await fetch(runUrl, { method: "POST" });
      await pollStatusUntilDone(120_000);
      const { year, week } = App.getYearWeek();
  clearCalendar();
  buildCalendarSkeleton();
  // (DnD listeners are added inside buildCalendarSkeleton, but if you
  // rebuild elsewhere, make sure to call it before painting.)
      await handleWeekYearChange(year, week);
    } catch (e) {
      console.error("[engine] start failed", e);
    } finally {
      btn.disabled = false;
    }
  });
}

async function pollStatusUntilDone(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const st = await U.getJSON(URLS.status || "/api/status");
      if (st?.done) return;
    } catch (e) {
      console.warn("[status] poll failed", e);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.warn("[status] poll timed out");
}

// ---------- Single boot sequence (one and only DOMContentLoaded) ----------
async function boot() {
  console.log("[boot] starting…");
  // 1) initialize year/week
  const iso = isoNowEurope("Europe/Zurich");
  App.setYearWeek(iso.year, iso.week);

  // 2) ensure light UI scaffolding
  ensureFiltersToggle();
  try { ensureLeadsLanes(document); } catch { /* optional */ }

  // 3) wire delegates & controls
  wireCalendarDelegation(document);
  wireWeekSelector();
  wireStartButton();

  // 4) build skeleton
  buildCalendarSkeleton();
  // (DnD listeners are added inside buildCalendarSkeleton, but if you
  // rebuild elsewhere, make sure to call it before painting.)

  // 5) instant paint from snapshot (if any)
  const { year, week } = App.getYearWeek();
  const snap = loadFullCalendarSnapshot(year, week);
  if (snap) {
    await renderDefaultScheduleFromData({ weekly_calendar: snap }, { year, week });
  }

  // 6) fetch fresh & paint (await to avoid races)
  try {
    await handleWeekYearChange(year, week);
  } catch (e) {
    console.warn("[boot] schedule fetch failed", e);
  }

  console.log("[boot] ready.");
}

document.addEventListener("DOMContentLoaded", () => {
  const debugDiv = document.createElement('div');
  debugDiv.id = 'avu-debug-overlay';
  debugDiv.style = 'position:fixed;top:0;left:0;z-index:9999;background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;font-size:14px;font-family:monospace;max-width:100vw;white-space:pre;pointer-events:none;';
  debugDiv.textContent = '[AVU] Booting...';
  document.body.appendChild(debugDiv);
  boot().then(() => {
    debugDiv.textContent = '[AVU] Boot complete.';
    setTimeout(() => debugDiv.remove(), 2000);
  }).catch(e => {
    debugDiv.textContent = '[boot] crashed: ' + (e && e.stack ? e.stack : e);
    console.error("[boot] crashed", e);
  });
});

// ---------- OPTIONAL legacy hooks (kept in one documented place) ----------
/* If you need console access during debugging, expose a tiny, read-only surface.
   Remove this block once you’re done debugging. */
Object.defineProperty(window, "AVU", {
  value: {
    getState: () => ({ ...App }),
    rebuild: async () => {
      const { year, week } = App.getYearWeek();
  clearCalendar();
  buildCalendarSkeleton();
  // (DnD listeners are added inside buildCalendarSkeleton, but if you
  // rebuild elsewhere, make sure to call it before painting.)
      await handleWeekYearChange(year, week);
    },
  },
  configurable: true,
});
