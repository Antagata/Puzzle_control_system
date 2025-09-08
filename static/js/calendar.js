// static/js/calendar.js
import * as U from "./utils.js";
const { CAL, URLS, NUM_SLOTS, DAYS, weekSnapKey, weekLockedKey } = U;
import { renderWineIntoBox, addDropZoneListeners } from "./cards.js";

/* ---------- Day color presets (includes gold) ---------- */
const BOX_COLORS = {
  gold: "#D4AF37",
  blue: "#DBEAFE",
  green: "#DCFCE7",
  rose: "#FFE4E6",
};

/* ---------- LocalStorage helpers ---------- */
function loadFullCalendarSnapshot(year, week) {
  try {
    const raw = localStorage.getItem(U.weekSnapKey(year, week));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveFullCalendarSnapshot(year, week, data) {
  try { localStorage.setItem(U.weekSnapKey(year, week), JSON.stringify(data)); } catch {}
}
function loadLockedForWeek(year, week) {
  try {
    const raw = localStorage.getItem(U.weekLockedKey(year, week));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveLockedForWeek(year, week, locked) {
  try { localStorage.setItem(U.weekLockedKey(year, week), JSON.stringify(locked)); } catch {}
}

/* ---------- Day color persistence ---------- */
function dayColorKey(year, week) { return `calColors:${year}:${week}`; }
function getDayColors(year, week) {
  try {
    const raw = localStorage.getItem(dayColorKey(year, week));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function setDayColor(year, week, day, color) {
  const map = getDayColors(year, week);
  if (color) map[day] = color; else delete map[day];
  try { localStorage.setItem(dayColorKey(year, week), JSON.stringify(map)); } catch {}
}
function applyDayColor(day, color) {
  const body = U.$(`[data-day="${day}"] [data-day-body]`);
  if (!body) return;
  body.style.background = color || "";
}
function applyAllDayColors(year, week) {
  const map = getDayColors(year, week);
  for (const d of U.DAYS) applyDayColor(d, map[d]);
}

/* ---------- Merge schedule with locked items ---------- */
function mergeScheduleWithLocks(schedule, locked, numSlots = U.NUM_SLOTS) {
  const days = Object.keys(schedule || {});
  const out = {};
  for (const d of days) {
    const lockedBySlot = (locked?.[d] || []).reduce((acc, card) => {
      if (Number.isInteger(card.slot)) acc[card.slot] = card;
      return acc;
    }, {});
    const pool = (schedule[d] || []).filter(x => !x.locked);
    const merged = [];
    for (let s = 0; s < numSlots; s++) {
      if (lockedBySlot[s]) merged.push({ ...lockedBySlot[s], locked: true });
      else if (pool.length) merged.push(pool.shift());
    }
    // Overflow drawer stays after slots
    const overflow = pool;
    out[d] = [...merged, ...overflow.map(c => ({ ...c, overflow: true }))];
  }
  return out;
}

function buildCalendarSkeleton(rootSel = "#calendar-grid") {
  const root = U.$(rootSel);
  if (!root) return;
  root.innerHTML = "";
  for (const day of U.DAYS) {
    const col = document.createElement("div");
    col.className = "day-col flex flex-col gap-2";
    col.dataset.day = day;
    col.innerHTML = `
      <div class="day-header flex items-center justify-between">
        <div class="font-semibold">${day}</div>
        <div class="flex flex-col items-end gap-1">
          <div class="relative">
            <button class="text-xs px-2 py-1 rounded border" data-btn="palette" title="Color day box">🎨 Color</button>
            <div class="palette-dropdown hidden absolute right-0 mt-1 p-2 bg-white shadow-xl rounded-xl z-10">
              <div class="grid grid-cols-5 gap-2">
                ${Object.entries(BOX_COLORS).map(([name, color]) => `
                  <button class="w-6 h-6 rounded-md ring-1 ring-black/10" data-swatch data-color="${color}" title="${name}" style="background:${color}"></button>
                `).join("")}
                <button class="text-xs px-2 py-1 border rounded" data-swatch data-color="" title="Clear">Clear</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="day-body rounded-xl ring-1 ring-black/5 p-2 transition-colors" data-day-body>
        <div class="day-cards grid gap-2"></div>
      </div>
    `;
    root.appendChild(col);
  }
  wireDayPaletteControls(root);
}

function wireDayPaletteControls(root = document) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-btn="palette"]');
    if (btn) {
      const dd = btn.parentElement.querySelector(".palette-dropdown");
      if (dd) dd.classList.toggle("hidden");
      // close others
      U.$all(".palette-dropdown").forEach(x => { if (x !== dd) x.classList.add("hidden"); });
    }
    const swatch = e.target.closest("[data-swatch]");
    if (swatch) {
      const dayEl = e.target.closest("[data-day]");
      const day = dayEl?.dataset.day;
      const color = swatch.dataset.color || "";
      if (day && U.CAL?.year && U.CAL?.week) {
        setDayColor(U.CAL.year, U.CAL.week, day, color);
        applyDayColor(day, color);
      }
      // hide palette
      const dd = dayEl?.querySelector(".palette-dropdown");
      if (dd) dd.classList.add("hidden");
    }
  });
  // click outside closes all
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".palette-dropdown") && !e.target.closest('[data-btn="palette"]')) {
      U.$all(".palette-dropdown").forEach(x => x.classList.add("hidden"));
    }
  });
}

async function renderDefaultScheduleFromData(resp, { year, week } = {}) {
  const data = resp?.weekly_calendar || resp?.data || null;
  const grid = U.$("#calendar-grid");
  if (!grid) return;
  const weekly = data && typeof data === "object" ? data : {
    Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: []
  };
  const locked = (year && week) ? loadLockedForWeek(year, week) : {};
  const merged = mergeScheduleWithLocks(weekly, locked, U.NUM_SLOTS);
  for (const day of U.DAYS) {
    const box = grid.querySelector(`[data-day="${day}"] .day-cards`);
    if (!box) continue;
    box.innerHTML = "";
    for (const card of (merged[day] || [])) {
      renderWineIntoBox(box, card);
    }
  }
  if (year && week) saveFullCalendarSnapshot(year, week, merged);
  if (year && week) applyAllDayColors(year, week);
}

let handleWeekYearChange;
handleWeekYearChange = async function handleWeekYearChange(year, week) {
  const url = `${U.URLS.schedule}?year=${year}&week=${week}`;
  const resp = await U.getJSON(url);
  await renderDefaultScheduleFromData(resp, { year, week });
  applyAllDayColors(year, week);
};

export {
  buildCalendarSkeleton,
  renderDefaultScheduleFromData,
  handleWeekYearChange,
  loadFullCalendarSnapshot,
  saveFullCalendarSnapshot,
  loadLockedForWeek,
  saveLockedForWeek,
  mergeScheduleWithLocks,
  applyAllDayColors,
  setDayColor,
};
