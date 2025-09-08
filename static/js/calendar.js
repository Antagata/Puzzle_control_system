// static/js/calendar.js
import {
  $, $all, CAL, URLS, NUM_SLOTS, DAYS,
  weekSnapKey, weekLockedKey, getJSON, postJSON
} from "./utils.js";
import {
  renderWineIntoBox,
  attachWineBoxDragHandlers,
  addDropZoneListeners
} from "./cards.js";
import {
  filterCalendarByUIFilters,
  mapUIFiltersForBackend
} from "./filters.js";


function isCalendarLike(obj) {
  if (!obj || typeof obj !== "object") return false;
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  return days.every(d => Array.isArray(obj?.[d]));
}

/* -------------------- calendar skeleton -------------------- */

export function clearCalendar() {
  $all(".fill-box").forEach((b) => {
    b.innerHTML = "";
    b.classList.remove("filled", "active", "over", "empty");
  });
  $all(".overflow-drawer, .leads-drawer").forEach((drawer) => {
    $all(".wine-box", drawer).forEach((c) => c.remove());
    drawer.classList.remove("active");
  });
}

export function buildCalendarSkeleton() {
  const grid = $("#main-calendar-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const mkLeadsBox = (label, gridCol) => {
    const box = document.createElement("div");
    box.className = "fill-box leads-box";
    box.dataset.day = label;
    box.dataset.slot = "0";
    box.style.gridColumn = gridCol;
    box.style.gridRow = "1";
    box.innerHTML = `<div class="leads-label"><i class="fa-solid fa-bullhorn"></i> ${label}</div>`;
    box.addEventListener("click", () => window.openQuickAdd?.(label, 0));
    box.addEventListener("contextmenu", (e) => { e.preventDefault(); });
    return box;
  };

  grid.appendChild(mkLeadsBox("Leads (Tuesday–Wednesday)", "2 / span 2"));
  grid.appendChild(mkLeadsBox("Leads (Thursday–Friday)", "4 / span 2"));

  DAYS.forEach((day) => {
    const col = document.createElement("div");
    col.className = "day-column";
    col.innerHTML = `<div class="day-name">${day}</div>`;

    const body = document.createElement("div");
    body.className = "day-body";
    for (let i = 0; i < NUM_SLOTS; i++) {
      const box = document.createElement("div");
      box.className = "fill-box empty";
      box.dataset.day = day;
      box.dataset.slot = String(i);
      box.addEventListener("click", () => window.openQuickAdd?.(day, i));
      box.addEventListener("contextmenu", (e) => { e.preventDefault(); });
      body.appendChild(box);
    }

    const overflow = document.createElement("div");
    overflow.className = "overflow-drawer";
    overflow.dataset.day = day;
    overflow.textContent = "Overflow:";

    col.appendChild(body);
    col.appendChild(overflow);
    grid.appendChild(col);
  });

  addDropZoneListeners();
}

export function wireCalendarDelegation() {
  const wrap = CAL();
  if (!wrap || wrap.__delegationWired) return;

  wrap.addEventListener("click", (e) => {
    const lockBtn = e.target.closest(".lock-icon");
    if (lockBtn) return;
    const card = e.target.closest(".wine-box");
    if (card) { e.stopPropagation(); window.__avuCards.toggleSelectWine(card); }
  });

  wrap.addEventListener("contextmenu", (e) => {
    const card = e.target.closest(".wine-box");
    if (card) { e.preventDefault(); e.stopPropagation(); window.__avuCards.showWineContextMenu(card, e.clientX, e.clientY); }
  });

  wrap.__delegationWired = true;
}

/* -------------------- persistence (DOM ⇄ storage ⇄ server) -------------------- */

export function readDOMFullState() {
  const out = {};
  DAYS.forEach((day) => {
    const slots = [];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const box = document.querySelector(`.fill-box[data-day="${day}"][data-slot="${i}"]`);
      const card = box?.querySelector(".wine-box");
      if (!card) { slots.push(null); continue; }
      slots.push({
        id: card.dataset.id || null,
        wine: card.dataset.name || "",
        vintage: card.dataset.vintage || "",
        full_type: card.dataset.type || undefined,
        region_group: card.dataset.region || undefined,
        stock: card.dataset.stock ? Number(card.dataset.stock) : undefined,
        price_tier: card.dataset.priceTier || undefined,
        match_quality: card.dataset.matchQuality || undefined,
        avg_cpi_score: card.dataset.cpiScore || undefined,
        last_campaign: card.dataset.lastCampaign || undefined,
        locked: card.dataset.locked === "true"
      });
    }
    out[day] = slots;
  });
  return out;
}

export async function persistFullCalendarSnapshot(
  year = window.__avuState.currentYear,
  week = window.__avuState.currentWeek
) {
  const snap = readDOMFullState();
  try { sessionStorage.setItem(weekSnapKey(year, week), JSON.stringify(snap)); } catch {}
}

export function loadFullCalendarSnapshot(year, week) {
  try {
    const raw = sessionStorage.getItem(weekSnapKey(year, week));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function readDOMLockedState() {
  const out = {};
  document.querySelectorAll(".day-column").forEach((col) => {
    const day = col.querySelector(".day-name")?.textContent?.trim();
    if (!day) return;
    const slots = [];
    col.querySelectorAll(".fill-box").forEach((box, idx) => {
      const card = box.querySelector(".wine-box[data-locked='true']");
      if (!card) { slots.push(null); return; }
      slots.push({
        id: card.dataset.id || null,
        wine: card.dataset.name || "",
        vintage: card.dataset.vintage || "",
        full_type: card.dataset.type || undefined,
        region_group: card.dataset.region || undefined,
        stock: Number(card.dataset.stock || 0),
        price_tier: card.dataset.priceTier || undefined,
        last_campaign: card.dataset.lastCampaign || undefined,
        locked: true,
        slot: idx
      });
    });
    out[day] = slots;
  });
  return out;
}

export async function persistLockedCalendarState(
  year = window.__avuState.currentYear,
  week = window.__avuState.currentWeek
) {
  const payload = readDOMLockedState();
  try { await postJSON(URLS.locked, { year, week, locked_calendar: payload }); }
  catch (e) { console.error("Failed to persist locked calendar:", e); }
  finally { try { sessionStorage.setItem(weekLockedKey(year, week), JSON.stringify(payload)); } catch {} }
}

export async function fetchLockedForWeek(week, year = window.__avuState.currentYear) {
  const key = weekLockedKey(year, week);
  // server year+week
  try {
    const j = await getJSON(`${URLS.locked}?year=${encodeURIComponent(year)}&week=${encodeURIComponent(week)}`);
    const data = j.locked_calendar || {};
    if (data && Object.keys(data).length) {
      try { sessionStorage.setItem(key, JSON.stringify(data)); } catch {}
      return data;
    }
  } catch {}
  // server week-only (back-compat)
  try {
    const j = await getJSON(`${URLS.locked}?week=${encodeURIComponent(week)}`);
    const data = j.locked_calendar || {};
    if (data && Object.keys(data).length) {
      try { sessionStorage.setItem(key, JSON.stringify(data)); } catch {}
      return data;
    }
  } catch {}
  // local
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export async function fetchDefaultScheduleForWeek(week, year = window.__avuState.currentYear) {
  try {
    const res = await fetch(`${URLS.schedule}?year=${encodeURIComponent(year)}&week=${encodeURIComponent(week)}`, { cache: "no-store" });
    if (res.ok) { const data = await res.json(); return data.weekly_calendar || data; }
  } catch {}
  try {
    const res = await fetch(`${URLS.schedule}?week=${encodeURIComponent(week)}`, { cache: "no-store" });
    if (res.ok) { const data = await res.json(); return data.weekly_calendar || data; }
  } catch {}
  return null;
}

export async function getLeadsForWeek(week, year = window.__avuState.currentYear) {
  try {
    const res = await fetch(`${URLS.leads}?year=${encodeURIComponent(year)}&week=${encodeURIComponent(week)}`, { cache: "no-store" });
    if (res.ok) return res.json();
  } catch {}
  try {
    const res = await fetch(`${URLS.leads}?week=${encodeURIComponent(week)}`, { cache: "no-store" });
    if (res.ok) return res.json();
  } catch {}
  return null;
}

/* -------------------- renderers -------------------- */

export function renderLeadsFromData(leads) {
  if (!leads) return;
  const leadsKeys = {
    "Leads (Tuesday–Wednesday)": "TueWed",
    "Leads (Thursday–Friday)": "ThuFri"
  };
  for (const label in leadsKeys) {
    const dayKey = leadsKeys[label];
    const items = leads[dayKey] || [];
    const box = document.querySelector(`[data-day="${label}"]`);
    if (!box) continue;

    const overflow = box;
    overflow.innerHTML = `<div class="leads-label"><i class="fa-solid fa-bullhorn"></i> ${label}</div>`;

    items.forEach(item => {
      if (!item) return;
      const el = renderWineIntoBox(overflow, item, { locked: !!item.locked });
      if (el) attachWineBoxDragHandlers(el);
    });
    if (items.length > 0) overflow.classList.add("active", "filled");
    else overflow.classList.remove("active", "filled");
  }
}

export function collectCurrentKeys() {
  const keys = new Set();
  document.querySelectorAll(".wine-box").forEach((el) => {
    keys.add(`${(el.dataset.id || el.dataset.name || "").toLowerCase().trim()}::${(el.dataset.vintage || "NV").toLowerCase().trim()}`);
  });
  return keys;
}

export function renderLockedOnlyFromData(locks) {
  let placed = false;
  const keys = collectCurrentKeys();

  DAYS.forEach((day) => {
    const arr = Array.isArray(locks?.[day]) ? locks[day] : [];
    arr.slice(0, NUM_SLOTS).forEach((it, idx) => {
      if (!it) return;
      const k = `${(it.id || it.wine || "").toLowerCase().trim()}::${(it.vintage || "NV").toLowerCase().trim()}`;
      if (keys.has(k)) return;

      const box = document.querySelector(`.fill-box[data-day="${day}"][data-slot="${idx}"]`);
      if (!box) return;

      // Normalize + include last_campaign so the card can display it
      renderWineIntoBox(box, {
        id: it.id ?? it.wine_id ?? "",
        wine: it.wine ?? it.name ?? "Unknown",
        vintage: it.vintage ?? "NV",
        locked: true,
        full_type: it.full_type,
        region_group: it.region_group,
        stock: it.stock ?? it.stock_count,
        price_tier: it.price_tier ?? it.tier,
        match_quality: it.match_quality,
        avg_cpi_score: it.avg_cpi_score,
        last_campaign: it.last_campaign_date || it.last_campaign || it.lastCampaign || ""
      }, { locked: true });

      keys.add(k);
      placed = true;
    });
  });

  window?.recalcAndUpdateGauge?.({ animate: false });
  return placed;
}

export function renderDefaultScheduleFromData(calendar) {
  if (!calendar) return false;
  const uiFilters = mapUIFiltersForBackend();
  const filteredCal = filterCalendarByUIFilters(calendar, uiFilters);

  let placed = false;
  const keys = collectCurrentKeys();

  DAYS.forEach((day) => {
    const arr = Array.isArray(filteredCal?.[day]) ? filteredCal[day] : [];
    arr.slice(0, NUM_SLOTS).forEach((it, idx) => {
      if (!it) return;
      const k = `${(it.id || it.wine || it.name || "").toLowerCase().trim()}::${(it.vintage || "NV").toLowerCase().trim()}`;
      if (keys.has(k)) return;

      const box = document.querySelector(`.fill-box[data-day="${day}"][data-slot="${idx}"]`);
      if (!box) return;

      // do not overwrite locked cards
      if (box.querySelector('.wine-box[data-locked="true"]')) return;

      // remove any previous auto card
      const prevAuto = box.querySelector('.wine-box:not([data-locked="true"])');
      if (prevAuto) prevAuto.remove();

      // Normalize + include last_campaign for display
      renderWineIntoBox(box, {
        id: it.id ?? it.wine_id ?? "",
        wine: it.name ?? it.wine ?? "Unknown",
        vintage: it.vintage ?? "NV",
        locked: !!it.locked,
        full_type: it.full_type,
        region_group: it.region_group,
        stock: it.stock ?? it.stock_count,
        price_tier: (it.price_tier_bucket || it.price_bucket || it.price_category || it.price_tier || it.priceTier || it.tier || ""),
        match_quality: it.match_quality,
        avg_cpi_score: it.avg_cpi_score,
        last_campaign: it.last_campaign_date || it.last_campaign || it.lastCampaign || ""
      }, { locked: !!it.locked });

      keys.add(k);
      placed = true;
    });
  });

  window?.recalcAndUpdateGauge?.({ animate: true });
  return placed;
}

export function fillEmptySlotsFromPool(calendar) {
  if (!calendar) return;

  const uiFilters = mapUIFiltersForBackend();
  const filteredCal = filterCalendarByUIFilters(calendar, uiFilters);

  const used = collectCurrentKeys();
  const pool = [];

  DAYS.forEach((day) => {
    const arr = Array.isArray(filteredCal?.[day]) ? filteredCal[day] : [];
    arr.forEach((it) => {
      if (!it) return;
      const k = `${(it.id || it.wine || it.name || "").toLowerCase().trim()}::${(it.vintage || "NV").toLowerCase().trim()}`;
      if (!used.has(k)) pool.push(it);
    });
  });

  if (!pool.length) return;

  const boxes = $all(".fill-box");
  for (const box of boxes) {
    if (box.querySelector(".wine-box")) continue;
    const next = pool.shift();
    if (!next) break;

    renderWineIntoBox(box, {
      id: next.id ?? next.wine_id ?? "",
      wine: next.name ?? next.wine ?? "Unknown",
      vintage: next.vintage ?? "NV",
      locked: !!next.locked,
      full_type: next.full_type,
      region_group: next.region_group,
      stock: next.stock ?? next.stock_count,
      price_tier: (next.price_tier_bucket || next.price_bucket || next.price_category || next.price_tier || next.priceTier || next.tier || ""),
      match_quality: next.match_quality,
      avg_cpi_score: next.avg_cpi_score,
      last_campaign: next.last_campaign_date || next.last_campaign || next.lastCampaign || ""
    }, { locked: !!next.locked });
  }

  window?.recalcAndUpdateGauge?.({ animate: false });
}

/* -------------------- week switching pipeline -------------------- */

export async function handleWeekYearChange(newYear, newWeek) {
  if (window.__avuState.isWeekLoading) return;
  window.__avuState.isWeekLoading = true;

  const cal = CAL();
  if (cal) { cal.setAttribute("aria-busy", "true"); cal.classList.add("is-busy"); }

  const prevYear = window.__avuState.currentYear;
  const prevWeek = window.__avuState.currentWeek;

  if (prevYear && prevWeek && (newYear !== prevYear || newWeek !== prevWeek)) {
    await persistLockedCalendarState(prevYear, prevWeek);
    await persistFullCalendarSnapshot(prevYear, prevWeek);
  }

  window.__avuState.currentYear = parseInt(newYear, 10);
  window.__avuState.currentWeek = parseInt(newWeek, 10);
  sessionStorage.setItem("selectedYear", String(window.__avuState.currentYear));
  sessionStorage.setItem("selectedWeek", String(window.__avuState.currentWeek));

  clearCalendar();
  buildCalendarSkeleton();
  wireCalendarDelegation();

  // ensure index is present for last_campaign fallback
  await window.__avuApi.loadCampaignIndex().catch(() => {});

  const snap = loadFullCalendarSnapshot(window.__avuState.currentYear, window.__avuState.currentWeek);
  if (isCalendarLike(snap)) {
    renderFullFromData(snap);
  } else {
    const [locked, calendar, leads] = await Promise.all([
      fetchLockedForWeek(window.__avuState.currentWeek, window.__avuState.currentYear),
      fetchDefaultScheduleForWeek(window.__avuState.currentWeek, window.__avuState.currentYear),
      getLeadsForWeek(window.__avuState.currentWeek, window.__avuState.currentYear)
    ]);

    if (locked && Object.keys(locked).length) renderLockedOnlyFromData(locked);
    if (calendar) { renderDefaultScheduleFromData(calendar); fillEmptySlotsFromPool(calendar); }
    if (leads) renderLeadsFromData(leads);

    await persistLockedCalendarState(window.__avuState.currentYear, window.__avuState.currentWeek);
    await persistFullCalendarSnapshot(window.__avuState.currentYear, window.__avuState.currentWeek);
  }

  window?.recalcAndUpdateGauge?.({ animate: false });
  if (cal) { cal.removeAttribute("aria-busy"); cal.classList.remove("is-busy"); }
  window.__avuState.isWeekLoading = false;
}

export function renderFullFromData(calendar) {
  if (!isCalendarLike(calendar)) return false;
  clearCalendar();
  buildCalendarSkeleton();
  fetchAndRenderLeads();
  wireCalendarDelegation();

  if (!calendar) return false;

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

export function handleWeekChange(wk) {
  return handleWeekYearChange(window.__avuState.currentYear, parseInt(wk, 10));
}

export async function fetchAndRenderLeads(
  week = window.__avuState.currentWeek,
  year = window.__avuState.currentYear
) {
  try {
    const leads = await getLeadsForWeek(week, year);
    renderLeadsFromData(leads);
  } catch (e) {
    console.error("Leads error:", e);
  }
}

/* -------------------- small API exposed to other modules -------------------- */

export const __api = {
  async fetchLockedForWeek(week, year) { return fetchLockedForWeek(week, year); },
  async saveLocked(year, week, payload) { return postJSON(URLS.locked, { year, week, locked_calendar: payload }); },
  async loadCampaignIndex() {
    try {
      const r = await fetch(URLS.campaignIndex, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const by_id = j.by_id || j.ids || j.index || {};
      const by_name = j.by_name || j.names || {};
      window.__avuState.CAMPAIGN_INDEX = { by_id, by_name };
    } catch {
      window.__avuState.CAMPAIGN_INDEX = { by_id: {}, by_name: {} };
    }
  }
};
