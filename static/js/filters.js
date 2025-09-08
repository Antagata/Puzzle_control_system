// static/js/filters.js
import { $, $all } from "./utils.js";

export function mapUIFiltersForBackend() {
  const loyaltyActive = document.querySelector('#loyalty-group button.active');
  const loyalty = (loyaltyActive?.dataset?.value || loyaltyActive?.textContent || "all").trim().toLowerCase();
  const typeActive = document.querySelector('#wine-type-group button.active');
  const wt = (typeActive?.dataset?.value || typeActive?.textContent || "All").trim();
  const wine_type = (/^all$/i.test(wt)) ? null : wt;
  const baseVal = $("#bottle-size-slicer")?.value || "750";
  const biggerSel = $("#bigger-size-selector");
  const bottle_size = (baseVal === "bigger" && biggerSel && !biggerSel.classList.contains("hidden")) ?
    parseInt(biggerSel.value || "3000", 10) : parseInt(baseVal, 10);
  const priceTierSel = $("#price-tier");
  const price_tier_bucket = (priceTierSel?.value || "").trim();
  const last_stock = !!$("#last-stock-checkbox")?.checked;
  const last_stock_threshold = last_stock ? 10 : null;
  const seasonality_boost = !!$("#seasonality-checkbox")?.checked;
  const styleActive = document.querySelector('.cruise-button-small.active');
  const style = (styleActive?.dataset?.style || "default").toLowerCase();
  const calendar_day = (window.__avuSelectedCellDay || (window.__avuState.selectedWineData?.day ?? null)) || null;
  return { loyalty, wine_type, bottle_size, price_tier_bucket, last_stock, last_stock_threshold, seasonality_boost, style, calendar_day };
}
// shim if compact toggle was removed from the UI
export function injectFiltersCompactToggle() { /* no-op */ }


export function markFiltersDirty() {
  window.__avuState.filtersDirty = true;
  window?.setOfferButtonsEnabled?.(false);
  const btn = document.getElementById("loadScheduleBtn");
  if (btn) {
    if (window.__avuState.engineReady) btn.disabled = false;
    btn.classList.toggle("opacity-50", !window.__avuState.engineReady);
    btn.classList.toggle("pointer-events-none", !window.__avuState.engineReady);
    btn.textContent = "🔄 Apply filters & reload";
    btn.setAttribute("aria-disabled", String(!window.__avuState.engineReady));
    btn.setAttribute("title", window.__avuState.engineReady ? "Apply filters & rebuild the calendar" : "Run Start AVU Engine first");
  }
  window?.recalcAndUpdateGauge?.({ animate: true });
}

export function clearFiltersDirty() {
  window.__avuState.filtersDirty = false;
  const btn = document.getElementById("loadScheduleBtn");
  if (btn) { btn.textContent = "🔄 Load new schedule"; window?.updateLoadBtnState?.(); }
  window?.setOfferButtonsEnabled?.(!!window.__avuState.selectedWineData);
}

export function resetFiltersToDefault() {
  $all("#loyalty-group button").forEach(b => b.classList.remove("active"));
  const lAll = document.querySelector('#loyalty-group button:nth-child(1)'); if (lAll) lAll.classList.add("active");
  $all("#wine-type-group button").forEach(b => b.classList.remove("active"));
  const tAll = document.querySelector('#wine-type-group button:nth-child(1)'); if (tAll) tAll.classList.add("active");
  const bs = document.getElementById("bottle-size-slicer"); if (bs) bs.value = "750";
  const bigger = document.getElementById("bigger-size-selector"); bigger?.classList.add("hidden");
  const pt = document.getElementById("price-tier"); if (pt) pt.value = "";
  const ls = document.getElementById("last-stock-checkbox"); if (ls) ls.checked = false;
  const se = document.getElementById("seasonality-checkbox"); if (se) se.checked = false;
  $all(".cruise-button-small").forEach(b => b.classList.remove("active"));
  clearFiltersDirty();
}

export function setFiltersEnabled(enabled) {
  const toggle = (el) => {
    if (!el) return;
    if ("disabled" in el) el.disabled = !enabled;
    el.classList.toggle("opacity-50", !enabled);
    el.classList.toggle("pointer-events-none", !enabled);
    if (!enabled) el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
  };
  $all("#loyalty-group button").forEach(toggle);
  $all("#wine-type-group button").forEach(toggle);
  $all(".cruise-button-small").forEach(toggle);
  ["#price-tier","#bottle-size-slicer","#bigger-size-selector","#last-stock-checkbox","#seasonality-checkbox","#pb-size-filter"]
    .forEach(sel => toggle(document.querySelector(sel)));
  window?.updateLoadBtnState?.();
}

export function ensureFiltersDock() {
  let dock = document.getElementById("filters-panel") || document.getElementById("filters-dock");
  if (!dock) {
    const calWrap = document.getElementById("calendar-container") || document.getElementById("main-calendar-grid")?.parentElement;
    if (!calWrap) return;
    dock = document.createElement("section");
    dock.id = "filters-dock";
    calWrap.parentNode?.insertBefore(dock, calWrap);
  }
  const groups = [
    "#loyalty-group",
    "#price-tier",
    "#wine-type-group",
    "#last-stock-checkbox",
    "#seasonality-checkbox",
    "#bottle-size-slicer, #bigger-size-selector",
    "#pb-size-filter"
  ];
  groups.forEach(selGroup => {
    const candidates = selGroup.split(",").map(s => s.trim());
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && !dock.contains(el)) {
        const wrap = document.createElement("div");
        wrap.className = "fd-item";
        const label = el.previousElementSibling;
        if (label && label.tagName === "LABEL" && !wrap.contains(label)) wrap.appendChild(label);
        wrap.appendChild(el);
        dock.appendChild(wrap);
        break;
      }
    }
  });
  
}

// filtering logic for a calendar blob
function _tierOf(it){ return (it?.price_tier_bucket ?? it?.price_bucket ?? it?.price_category ?? it?.price_tier ?? it?.priceTier ?? it?.tier ?? ""); }
function _stockOf(it){ const v = Number(it?.stock ?? it?.stock_count ?? it?.Stock ?? it?.qty ?? it?.quantity ?? NaN); return Number.isFinite(v) ? v : NaN; }
function _fullTypeOf(it){ const s = String(it?.full_type ?? it?.type ?? "").toLowerCase(); const name = String(it?.wine ?? it?.name ?? "").toLowerCase(); return { s, name }; }

export function itemMatchesFilters(it, f) {
  if (!f) return true;
  if (f.last_stock) {
    const st = _stockOf(it);
    const thr = Number.isFinite(f.last_stock_threshold) ? f.last_stock_threshold : 10;
    if (!Number.isFinite(st) || !(st < thr)) return false;
  }
  if (f.price_tier_bucket && _tierOf(it) !== f.price_tier_bucket) return false;
  if (f.wine_type) {
    const { s, name } = _fullTypeOf(it); const want = String(f.wine_type).toLowerCase();
    const matched =
      s.includes(want) ||
      (want === "rosé" && (s.includes("rose") || s.includes("rosé"))) ||
      (want === "rose" && (s.includes("rosé") || s.includes("rose"))) ||
      (want === "red" && (s.includes("red") || name.includes("bordeaux"))) ||
      (want === "sparkling" && (s.includes("spark") || s.includes("champ") || s.includes("cava") || s.includes("prosecco")));
    if (!matched) return false;
  }
  return true;
}

export function filterCalendarByUIFilters(calendar, f) {
  if (!calendar || !f) return calendar;
  const out = {};
  for (const day of ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]) {
    const arr = Array.isArray(calendar?.[day]) ? calendar[day] : [];
    out[day] = arr.filter(it => itemMatchesFilters(it, f)).slice(0, 5);
  }
  return out;
}
