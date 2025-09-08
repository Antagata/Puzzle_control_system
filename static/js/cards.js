// static/js/cards.js
import { $, $all, CAL, DAYS, NUM_SLOTS, makeKey, addLongPress } from "./utils.js";
import { persistLockedCalendarState, persistFullCalendarSnapshot } from "./calendar.js";

// NOTE: this module calls a few orchestrator hooks exposed on window:
//   - window.recalcAndUpdateGauge({ animate: boolean })
//   - window.notifySelectedWine(data)
//   - window.setOfferButtonsEnabled(boolean)

let draggedItem = null;
let ctxMenuEl = null;
let tooltipEl = null;

/* ---------------------------- Safe state helpers --------------------------- */

function _state() {
  if (typeof window !== "undefined" && window.__avuState) return window.__avuState;
  // minimal safe shape so we never crash
  return {
    CAMPAIGN_INDEX: { by_id: {}, by_name: {} },
    isoNow: () => ({})
  };
}
function _campaignIndex() {
  const ci = _state().CAMPAIGN_INDEX || {};
  return {
    by_id: ci.by_id || {},
    by_name: ci.by_name || {}
  };
}

/**
 * Robust last-campaign resolver.
 * - Prefers explicit fields on the item
 * - Falls back to campaign index by id
 * - Then by (name :: vintage) in by_name
 * - Accepts both string and { last_campaign } object shapes
 */
function lastCampaignFromIndex(item) {
  if (!item) return "";
  // item-first
  const direct =
    item.last_campaign_date ||
    item.last_campaign ||
    item.lastCampaign;
  if (direct) return String(direct);

  const { by_id, by_name } = _campaignIndex();
  const id = item.id ?? item.wine_id ?? null;
  const name = item.name ?? item.wine ?? null;
  const vintage = item.vintage ?? "NV";

  if (id && by_id[id]) {
    const v = by_id[id];
    return typeof v === "string" ? v : (v?.last_campaign ?? "");
  }
  if (name) {
    // support either "name" or "name::vintage" keying
    const k1 = String(name).trim().toLowerCase();
    const k2 = `${k1}::${String(vintage).trim().toLowerCase()}`;
    const v = by_name[k2] ?? by_name[k1];
    if (v) return typeof v === "string" ? v : (v?.last_campaign ?? "");
  }
  return "";
}

/* ------------------------------ Drag handlers ----------------------------- */

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
        if (oldParent && oldParent.classList.contains("filled") && oldParent.children.length === 1) {
          oldParent.classList.remove("filled");
        }
        if (
          oldParent &&
          (oldParent.classList.contains("overflow-drawer") || oldParent.classList.contains("leads-drawer")) &&
          oldParent.children.length === 1
        ) {
          oldParent.classList.remove("active");
        }
        const afterElement = getDragAfterElement(targetBox, e.clientY);
        if (afterElement == null) targetBox.appendChild(draggedItem);
        else targetBox.insertBefore(draggedItem, afterElement);

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

/* ----------------------------- Card data utils ---------------------------- */

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

/* ------------------------------ Selections -------------------------------- */

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

/* ------------------------------ Tooltip ----------------------------------- */

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

/* --------------------------- Render a single card -------------------------- */

export function renderWineIntoBox(box, item, { locked = false } = {}) {
  const id =
    item.id ||
    `${(item.wine || item.name || "Wine").replace(/\s/g, "")}_${item.vintage || "NV"}_${box.dataset.day}_${box.dataset.slot}`;

  const el = document.createElement("div");
  el.className = "wine-box";
  el.id = `wine_${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // --- safe accessors
  function _state() {
    return (typeof window !== "undefined" && window.__avuState)
      ? window.__avuState
      : { CAMPAIGN_INDEX: { by_id:{}, by_name:{} } };
  }
  function _campaignIndex() {
    const ci = _state().CAMPAIGN_INDEX || {};
    return { by_id: ci.by_id || {}, by_name: ci.by_name || {} };
  }
  function lastCampaignFromIndex(id, name, vintage) {
    const { by_id, by_name } = _campaignIndex();
    if (id && by_id[id]) return by_id[id];
    const key = `${String(name || "").trim().toLowerCase()}::${String(vintage || "NV").trim().toLowerCase()}`;
    return by_name[key] || "";
  }

  // dataset (normalize to consistent keys/values)
  el.dataset.id = item.id || "";
  el.dataset.day = box.dataset.day;
  el.dataset.name = item.wine || item.name || "Unknown";
  el.dataset.vintage = item.vintage || "NV"; // use "NV" to match index keys
  el.dataset.locked = locked ? "true" : String(!!item.locked);
  el.dataset.type = item.full_type || item.type || "";
  el.dataset.stock = (item.stock ?? item.stock_count ?? "").toString();
  el.dataset.priceTier = (item.price_tier || item.tier || item.priceTier || "").toString();
  el.dataset.loyalty = item.loyalty_level || "";
  el.dataset.region = item.region_group || item.region || "";
  el.dataset.matchQuality = item.match_quality || "";
  el.dataset.cpiScore = item.avg_cpi_score ?? item.cpi_score ?? "";

  // resolve last campaign BEFORE building HTML
  const fromItem =
    item.last_campaign_date || item.last_campaign || item.lastCampaign || "";
  const lc = lastCampaignFromIndex(
    item.id || "", 
    item.wine || item.name || "", 
    item.vintage || "NV"
  );

  const lastCampaign =
    item.last_campaign_date || item.last_campaign || item.lastCampaign || lc || "";
  el.dataset.lastCampaign = String(lastCampaign);


  const isLocked = el.dataset.locked === "true";
  const lockIcon = isLocked ? "fa-lock" : "fa-lock-open";
  const badgeText = isLocked ? "Locked" : "Auto";
  const priceText = el.dataset.priceTier ? `Price: ${el.dataset.priceTier}` : "";
  const stockText = el.dataset.stock ? `Stock: ${el.dataset.stock}` : "";
  const details = [priceText, stockText].filter(Boolean).join(" • ");

  el.innerHTML = `
    <div class="wine-header">
      <strong class="wine-name">${el.dataset.name}</strong>
      <span class="muted">(${el.dataset.vintage})</span>
      <span class="badge">${badgeText}</span>
      <button class="lock-icon" title="${isLocked ? "Unlock" : "Lock"}" aria-label="Toggle lock" aria-pressed="${isLocked}" type="button">
        <i class="fas ${lockIcon}"></i>
      </button>
    </div>
    <div class="wine-details">${details || "&nbsp;"}</div>
    <div class="wine-submeta"><div>Last campaign: ${lastCampaign || "-"}</div></div>
  `;

  // visual type hinting
  const ft = (el.dataset.type || "").toLowerCase();
  const nameLc = (el.dataset.name || "").toLowerCase();
  const typeClass = (() => {
    if (ft.includes("spark") || ft.includes("champ") || ft.includes("spumante") || ft.includes("cava") || ft.includes("prosecco")) return "wine-type-sparkling";
    if (ft.includes("rose") || ft.includes("rosé")) return "wine-type-rose";
    if (ft.includes("dessert") || ft.includes("sweet") || ft.includes("sauternes") || ft.includes("port") || ft.includes("sherry") || nameLc.includes("late harvest")) return "wine-type-dessert";
    if (ft.includes("white") || ft.includes("blanc")) return "wine-type-white";
    if (ft.includes("red") || ft.includes("rouge") || nameLc.includes("bordeaux")) return "wine-type-red";
    return "";
  })();
  if (typeClass) el.classList.add(typeClass);

  // a11y + interactions (unchanged)
  // ... (your existing listeners: keydown/click/contextmenu/long-press/tooltip/drag)
  // make sure toggleSelectWine, showWineContextMenu, addLongPress are in scope

  attachWineBoxDragHandlers(el);
  box.appendChild(el);
  box.classList.add("filled");
  box.classList.remove("empty");

  // restore selection
  const sel = _state().selectedWineData;
  if (sel && sel.id && sel.id === el.dataset.id) {
    el.classList.add("selected");
    _state().selectedWineEl = el;
    window?.setOfferButtonsEnabled?.(true);
  }

  window?.recalcAndUpdateGauge?.({ animate: false });
  return el;
}


/* ---------------------------- Context menu UI ------------------------------ */

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
      <li role="separator" style="border-top:1px solid #eee;margin:4px 0"></li>
      <li style="display:flex;gap:10px;justify-content:center;padding:8px 0;">
        <button data-act="color-green" title="Green" style="width:28px;height:28px;border-radius:50%;border:2px solid #27ae60;background:#27ae60;cursor:pointer;"></button>
        <button data-act="color-gold" title="Gold" style="width:28px;height:28px;border-radius:50%;border:2px solid #ffd700;background:#ffd700;cursor:pointer;"></button>
        <button data-act="color-white" title="White" style="width:28px;height:28px;border-radius:50%;border:2px solid #ccc;background:#fff;cursor:pointer;"></button>
        <button data-act="color-black" title="Black" style="width:28px;height:28px;border-radius:50%;border:2px solid #222;background:#222;cursor:pointer;"></button>
      </li>
    </ul>
  `;
  doc.body.appendChild(ctxMenuEl);
  const vw = win.innerWidth, vh = win.innerHeight;
  const r = ctxMenuEl.getBoundingClientRect();
  const left = Math.min(Math.max(6, x), vw - r.width - 6);
  const top  = Math.min(Math.max(6, y), vh - r.height - 6);
  Object.assign(ctxMenuEl.style, { left: `${left}px`, top: `${top}px`, position: "fixed" });

  ctxMenuEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]") || e.target.closest("li[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    destroyContextMenu();
    if (act === "delete") deleteCardFromCalendar(cardEl);
    if (act === "move") openMoveWeekModal(cardEl);
    if (act && act.startsWith("color-")) {
      let color = "";
      if (act === "color-green") color = "#27ae60";
      if (act === "color-gold") color = "#ffd700";
      if (act === "color-white") color = "#fff";
      if (act === "color-black") color = "#222";
      // Set background color of the card's parent container (slot/fill-box)
      const parent = cardEl.closest('.slot, .fill-box, .overflow-drawer, .leads-drawer');
      if (parent) {
        parent.style.background = color;
        parent.dataset.bgcolor = color;
      }
    }
  });

  setTimeout(() => {
    const off = (e) => { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) destroyContextMenu(); };
    doc.addEventListener("click", off, { once:true });
    win.addEventListener("scroll", destroyContextMenu, { once:true });
    win.addEventListener("resize", destroyContextMenu, { once:true });
    doc.addEventListener("keydown", (e)=>{ if(e.key==="Escape") destroyContextMenu(); }, { once:true });
  }, 0);
}

/* --------------------------- Move to week modal ---------------------------- */

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
  overlay.addEventListener("click",(e)=>{ if(e.target===overlay) close(); });
  document.addEventListener("keydown", function esc(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown", esc); } });

  overlay.querySelector("#mv-confirm")?.addEventListener("click", async () => {
    const wk = parseInt(overlay.querySelector("#mv-week").value, 10);
    const yr = parseInt(overlay.querySelector("#mv-year").value, 10);
    await moveCardToWeek(cardEl, yr, wk);
    close();
  });
}

/* ------------------------------ Move logic -------------------------------- */

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

  // de-dupe target
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
