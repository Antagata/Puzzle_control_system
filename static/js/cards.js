// static/js/cards.js
import { $, $all, CAL, DAYS, NUM_SLOTS, makeKey, addLongPress } from "./utils.js";

/* -------------------------------------------------------------------------- */
/*                              Module-level state                             */
/* -------------------------------------------------------------------------- */
let draggedItem = null;
let ctxMenuEl = null;
let tooltipEl = null;

/* --------------------------- Safe state helpers --------------------------- */
function _state() {
  return (typeof window !== "undefined" && window.__avuState)
    ? window.__avuState
    : { CAMPAIGN_INDEX: { by_id: {}, by_name: {} }, isoNow: () => ({}) };
}
function _campaignIndex() {
  const ci = _state().CAMPAIGN_INDEX || {};
  return { by_id: ci.by_id || {}, by_name: ci.by_name || {} };
}
const _normName = (s) => String(s || "").trim().toLowerCase();
const _normVintage = (v) => String(v ?? "NV").trim().toLowerCase();

/** Resolve last-campaign date */
function lastCampaignFromIndex(id, name, vintage, item) {
  const direct = item?.last_campaign_date || item?.last_campaign || item?.lastCampaign;
  if (direct) return String(direct);

  const { by_id, by_name } = _campaignIndex();
  if (id && by_id[id]) {
    const v = by_id[id];
    return typeof v === "string" ? v : (v?.last_campaign ?? "");
  }
  const k = `${_normName(name)}::${_normVintage(vintage)}`;
  const v = by_name[k] || by_name[_normName(name)];
  return v ? (typeof v === "string" ? v : (v?.last_campaign ?? "")) : "";
}

/* ------------------------------ Drag & drop ------------------------------- */
export function attachWineBoxDragHandlers(el) {
  el.setAttribute("draggable", "true");
  el.addEventListener("dragstart", (e) => {
    draggedItem = el;
    el.classList.add("dragging");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    draggedItem = null;
  });
}
function getDragAfterElement(container, y) {
  const items = Array.from(container.querySelectorAll(".wine-box:not(.dragging)"));
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
  }
  return closest.element;
}
export function addDropZoneListeners() {
  $all(".fill-box, .overflow-drawer, .leads-drawer").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", async (e) => {
      zone.classList.remove("over");
      if (!draggedItem) return;
      const targetBox = e.currentTarget;
      const oldParent = draggedItem.parentNode;

      if (oldParent !== targetBox) {
        if (oldParent?.classList.contains("filled") && oldParent.children.length === 1) {
          oldParent.classList.remove("filled");
        }
        if ((oldParent?.classList.contains("overflow-drawer") || oldParent?.classList.contains("leads-drawer")) &&
            oldParent.children.length === 1) {
          oldParent.classList.remove("active");
        }

        const afterEl = getDragAfterElement(targetBox, e.clientY);
        if (afterEl == null) targetBox.appendChild(draggedItem);
        else targetBox.insertBefore(draggedItem, afterEl);

        if (targetBox.classList.contains("fill-box")) targetBox.classList.add("filled");
        else if (targetBox.classList.contains("overflow-drawer") || targetBox.classList.contains("leads-drawer")) targetBox.classList.add("active");

        draggedItem.dataset.day = targetBox.dataset.day || draggedItem.dataset.day;
        await persistLockedCalendarState().catch(console.warn);
        await persistFullCalendarSnapshot().catch(console.warn);
        window?.recalcAndUpdateGauge?.({ animate: true });
      }
      draggedItem = null;
    });
  });
}

/* ------------------------------ Leads helpers ----------------------------- */
export function firstAvailableBoxForDay(day) {
  const cols = document.querySelectorAll(".day-column");
  let dayCol = null;
  for (const col of cols) {
    const name = col.querySelector(".day-name")?.textContent?.trim();
    if (name === day) { dayCol = col; break; }
  }
  if (!dayCol) return null;

  // 1) First empty slot
  const boxes = dayCol.querySelectorAll(`.fill-box[data-day="${day}"]`);
  for (const box of boxes) {
    if (!box.querySelector(".wine-box")) return box;
  }
  // 2) Overflow drawer
  const overflow = dayCol.querySelector(`.overflow-drawer[data-day="${day}"]`);
  if (overflow) return overflow;
  // 3) Day body fallback
  return dayCol.querySelector(".day-body") || dayCol;
}

export function placeWineIntoDay(day, wineData, draggedEl = null, opts = {}) {
  const target = firstAvailableBoxForDay(day);
  if (!target) return false;
  try {
    renderWineIntoBox(target, wineData, opts);
    if (draggedEl?.isConnected) draggedEl.remove();
    window?.recalcAndUpdateGauge?.({ animate: true });
    return true;
  } catch (e) {
    console.error("[placeWineIntoDay] failed", e);
    return false;
  }
}

export function nextEmptySlotIndex(day) {
  const boxes = document.querySelectorAll(`.fill-box[data-day="${day}"]`);
  for (const box of boxes) {
    if (!box.querySelector(".wine-box")) return parseInt(box.dataset.slot, 10) || 0;
  }
  return 0;
}

/* ------------------------------- Data utils ------------------------------- */
export function extractWineData(el) {
  return {
    id: el.dataset.id || null,
    name: el.dataset.name || "",
    wine: el.dataset.name || "",
    vintage: el.dataset.vintage || "",
    full_type: el.dataset.type || "",
    type: el.dataset.type || "",
    stock: el.dataset.stock || "",
    price_tier: el.dataset.priceTier || "",
    loyalty_level: el.dataset.loyalty || "",
    region_group: el.dataset.region || "",
    match_quality: el.dataset.matchQuality || "",
    avg_cpi_score: el.dataset.cpiScore || "",
    day: el.dataset.day || "",
    locked: el.dataset.locked === "true",
    last_campaign: el.dataset.lastCampaign || ""
  };
}

/* ------------------------------- Selection -------------------------------- */
export function toggleSelectWine(el) {
  if (_state().selectedWineEl === el) {
    el.classList.remove("selected");
    _state().selectedWineEl = null;
    _state().selectedWineData = null;
    sessionStorage.removeItem("selectedWine");
    window?.setOfferButtonsEnabled?.(false);
    window?.notifySelectedWine?.(null);
  } else {
    if (_state().selectedWineEl) _state().selectedWineEl.classList.remove("selected");
    el.classList.add("selected");
    _state().selectedWineEl = el;
    _state().selectedWineData = extractWineData(el);
    sessionStorage.setItem("selectedWine", JSON.stringify(_state().selectedWineData));
    window?.setOfferButtonsEnabled?.(true);
    window?.notifySelectedWine?.(_state().selectedWineData);
  }
}

export function toggleCardLock(card) {
  const nowLocked = !(card.dataset.locked === "true");
  card.dataset.locked = nowLocked ? "true" : "false";
  const badge = card.querySelector(".badge");
  if (badge) badge.textContent = nowLocked ? "Locked" : "Auto";
  const icon = card.querySelector(".lock-icon i");
  if (icon) {
    icon.classList.toggle("fa-lock", nowLocked);
    icon.classList.toggle("fa-lock-open", !nowLocked);
    card.querySelector(".lock-icon")?.setAttribute("title", nowLocked ? "Unlock" : "Lock");
    card.querySelector(".lock-icon")?.setAttribute("aria-pressed", String(nowLocked));
  }
  persistLockedCalendarState().catch(console.warn);
  persistFullCalendarSnapshot().catch(console.warn);
  window?.recalcAndUpdateGauge?.({ animate: true });
}

export function deleteCardFromCalendar(cardEl, { silent = false } = {}) {
  const parentBox = cardEl.closest(".fill-box");
  cardEl.remove();
  if (parentBox && !parentBox.querySelector(".wine-box")) {
    parentBox.classList.remove("filled");
    parentBox.classList.add("empty");
  }
  if (_state().selectedWineEl === cardEl) {
    _state().selectedWineEl = null;
    _state().selectedWineData = null;
    sessionStorage.removeItem("selectedWine");
    window?.setOfferButtonsEnabled?.(false);
    window?.notifySelectedWine?.(null);
  }
  if (!silent) {
    persistLockedCalendarState().catch(console.warn);
    persistFullCalendarSnapshot().catch(console.warn);
    window?.recalcAndUpdateGauge?.({ animate: true });
  }
}

/* -------------------------------- Tooltip --------------------------------- */
export function showWineTooltip(el) {
  hideWineTooltip();
  tooltipEl = document.createElement("div");
  tooltipEl.className = "wine-tooltip";
  const d = extractWineData(el);
  tooltipEl.innerHTML = `
    <div><strong>${d.name}</strong> (${d.vintage})</div>
    <div>${d.full_type || "Type?"} • ${d.region_group || "Region?"}</div>
    <div>Price: ${d.price_tier || "-"} • Stock: ${d.stock || "-"}</div>
    <div>Match: ${d.match_quality || "-"} • CPI: ${d.avg_cpi_score || "-"}</div>
    <div>ID: ${d.id || "-"}</div>
    <div>Last campaign: ${d.last_campaign || "-"}</div>
  `;
  document.body.appendChild(tooltipEl);
  const r = el.getBoundingClientRect();
  let x = r.right + 8, y = r.top;
  const w = tooltipEl.offsetWidth || 220, h = tooltipEl.offsetHeight || 120;
  if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 8);
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
  Object.assign(tooltipEl.style, { left: `${x}px`, top: `${y}px`, position: "fixed" });
}
export function hideWineTooltip() {
  if (tooltipEl?.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);
  tooltipEl = null;
}

// --- cards.js (add) ---
function wireCardInteractions(cardEl, {
  onLockToggle = () => {},
  onAutoToggle = () => {},
  onDelete = () => {},
} = {}) {
  const lockBtn = cardEl.querySelector('[data-btn="lock"]');
  const autoBtn = cardEl.querySelector('[data-btn="auto"]');
  if (lockBtn) {
    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowLocked = !cardEl.classList.contains("is-locked");
      cardEl.classList.toggle("is-locked", nowLocked);
      onLockToggle(nowLocked, cardEl);
    });
  }
  if (autoBtn) {
    autoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cardEl.classList.toggle("is-auto");
      onAutoToggle(cardEl.classList.contains("is-auto"), cardEl);
    });
  }
  // Right-click to delete (only if not locked)
  cardEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (cardEl.classList.contains("is-locked")) return;
    onDelete(cardEl);
    cardEl.remove();
  });
}

export function renderWineIntoBox(containerEl, cardData) {
  const el = document.createElement("div");
  el.className = "wine-card group relative rounded-xl shadow ring-1 ring-black/5 p-2 bg-white";
  el.dataset.id = cardData?.id || crypto.randomUUID();

  el.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="text-sm font-semibold">${cardData?.name ?? "Unnamed Wine"}</div>
        <div class="text-xs opacity-70">${cardData?.vintage ?? "NV"} • ${cardData?.size ?? ""}</div>
      </div>
      <div class="flex items-center gap-2">
        <button class="text-xs px-2 py-1 rounded border" data-btn="auto">Auto</button>
        <button class="text-xs px-2 py-1 rounded border" data-btn="lock">Lock</button>
      </div>
    </div>
  `;
  wireCardInteractions(el, {
    onLockToggle: () => {},
    onAutoToggle: () => {},
    onDelete: () => {},
  });
  containerEl.appendChild(el);
}

// small helpers
function typeClass(t){ return t ? `wine-type-${String(t).toLowerCase()}` : ''; }
function matchClass(m){
  const s = String(m).toLowerCase();
  if (s.includes('perfect')) return 'badge-perfect';
  if (s.includes('strong'))  return 'badge-strong';
  if (s.includes('moderate'))return 'badge-moderate';
  return 'badge-low';
}
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&lt;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }


/* ---------------------------- Context menu UI ----------------------------- */
function destroyContextMenu() {
  if (ctxMenuEl?.parentNode) ctxMenuEl.parentNode.removeChild(ctxMenuEl);
  ctxMenuEl = null;
}
export function showWineContextMenu(cardEl, x, y) {
  destroyContextMenu();
  const doc = cardEl.ownerDocument || document;
  const win = doc.defaultView || window;
  ctxMenuEl = doc.createElement("div");
  ctxMenuEl.className = "context-menu";
  ctxMenuEl.innerHTML = `
    <ul role="menu" aria-label="Wine actions">
      <li role="menuitem" data-act="move">Move to week…</li>
      <li role="menuitem" data-act="delete" class="danger">Remove from this week</li>
    </ul>
  `;
  doc.body.appendChild(ctxMenuEl);
  const vw = win.innerWidth, vh = win.innerHeight;
  const r = ctxMenuEl.getBoundingClientRect();
  const left = Math.min(Math.max(6, x), vw - r.width - 6);
  const top  = Math.min(Math.max(6, y), vh - r.height - 6);
  Object.assign(ctxMenuEl.style, { left: `${left}px`, top: `${top}px`, position: "fixed" });

  ctxMenuEl.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-act]");
    if (!li) return;
    const act = li.dataset.act;
    destroyContextMenu();
    if (act === "delete") deleteCardFromCalendar(cardEl);
    if (act === "move") openMoveWeekModal(cardEl);
  });

  setTimeout(() => {
    const off = (e) => { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) destroyContextMenu(); };
    doc.addEventListener("click", off, { once:true });
    win.addEventListener("scroll", destroyContextMenu, { once:true });
    win.addEventListener("resize", destroyContextMenu, { once:true });
    doc.addEventListener("keydown", (e)=>{ if(e.key==="Escape") destroyContextMenu(); }, { once:true });
  }, 0);
}

/* --------------------------- Move to week modal --------------------------- */
export function openMoveWeekModal(cardEl) {
  const d = extractWineData(cardEl);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const iso = _state().isoNow();
  const curY = _state().currentYear;

  overlay.innerHTML = `
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="mv-title">
      <h3 id="mv-title">Move to ISO week</h3>
      <p class="mb-3">Wine: <strong>${d.name}</strong> (${d.vintage})</p>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="mv-year">Select year</label>
          <select id="mv-year" class="w-full p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-500" aria-label="Select ISO year">
            ${[curY - 1, curY, curY + 1].map(y => `<option value="${y}" ${y === curY ? "selected" : ""}>${y}</option>`).join("")}
          </select>
        </div>
        <div>
          <label for="mv-week">Select week</label>
          <select id="mv-week" class="w-full p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-500" aria-label="Select ISO week">
            ${Array.from({ length: 53 }, (_, i) => i + 1).map(w => `<option value="${w}" ${w === iso.week ? "selected" : ""}>Week ${w}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="modal-buttons" style="margin-top:1rem">
        <button id="mv-confirm" class="confirm-btn" type="button">Move & lock</button>
        <button id="mv-cancel" class="cancel-btn" type="button">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#mv-cancel")?.addEventListener("click", close);
  overlay.addEventListener("click",(e)=>{ if(e.target === overlay) close(); });
  document.addEventListener("keydown", function esc(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown", esc); } });

  overlay.querySelector("#mv-confirm")?.addEventListener("click", async () => {
    const wk = parseInt(overlay.querySelector("#mv-week").value, 10);
    const yr = parseInt(overlay.querySelector("#mv-year").value, 10);
    await moveCardToWeek(cardEl, yr, wk);
    close();
  });
}

/* --------------------------------- Move ----------------------------------- */
export function normalizeLocked(locks) {
  const out = {};
  DAYS.forEach((d) => {
    const arr = Array.isArray(locks?.[d]) ? locks[d].slice(0, NUM_SLOTS) : [];
    while (arr.length < NUM_SLOTS) arr.push(null);
    out[d] = arr.map((x) => (x && typeof x === "object" ? x : null));
  });
  return out;
}
export async function moveCardToWeek(cardEl, year, week) {
  const d = extractWineData(cardEl);
  if (!Number.isFinite(week) || week < 1 || week > 53) return;
  if (!Number.isFinite(year)) return;

  const existing = await window.__avuApi.fetchLockedForWeek(week, year);
  const existsAlready = Object.values(existing || {}).some(arr =>
    (arr || []).some(x => x && makeKey(x.id || x.wine, x.vintage, x.wine) === makeKey(d.id || d.name, d.vintage, d.name))
  );
  if (existsAlready) { alert(`That wine (${d.name} ${d.vintage}) already exists in ${year}-W${week}.`); return; }

  const targetDay = d.day || "Monday";
  try {
    const normLocks = normalizeLocked(existing);
    const slots = normLocks[targetDay] || Array(NUM_SLOTS).fill(null);
    let placed = false;
    for (let i = 0; i < NUM_SLOTS; i++) {
      if (slots[i] == null) {
        slots[i] = { id: d.id || null, wine: d.name || d.wine || "", vintage: d.vintage || "", locked: true, slot: i };
        placed = true;
        break;
      }
    }
    if (!placed) { alert(`No free slots on ${targetDay} (${year}-W${week}). Try another day.`); return; }
    const payload = { ...normLocks, [targetDay]: slots };
    await window.__avuApi.saveLocked(year, week, payload);

    deleteCardFromCalendar(cardEl, { silent: true });
    await persistLockedCalendarState();
    await persistFullCalendarSnapshot();
    window?.recalcAndUpdateGauge?.({ animate: true });
    alert(`Moved to ${year}-W${week}, ${targetDay} (locked).`);
  } catch (e) {
    console.error(e);
    alert("Move failed (see console).");
    window?.recalcAndUpdateGauge?.({ animate: true });
  }
}

/* ------------------------------ Debug surface ----------------------------- */
if (typeof window !== "undefined") {
  window.__avuCards = {
    attachWineBoxDragHandlers,
    addDropZoneListeners,
    renderWineIntoBox,
    toggleSelectWine,
    showWineContextMenu,
    extractWineData,
    firstAvailableBoxForDay,
    placeWineIntoDay,
    nextEmptySlotIndex,
    deleteCardFromCalendar,
  };
}
