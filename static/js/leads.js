// static/js/leads.js
import { URLS, DAYS } from "./utils.js";
import { renderWineIntoBox, addDropZoneListeners } from "./cards.js";


// Nine lanes, top → bottom
const LANE_CONFIG = [
  { key: 'vip-ch',     label: 'VIP · CH',                segment: 'CH'    }, // 0  (VIP tasting can live here)
  { key: 'vip-world',  label: 'VIP · World',             segment: 'World' }, // 1  (new lane “below VIP tasting / above autumn promo”)
  { key: 'key-ch',     label: 'Key Accounts · CH',       segment: 'CH'    }, // 2
  { key: 'key-world',  label: 'Key Accounts · World',    segment: 'World' }, // 3
  { key: 'marketing',  label: 'Marketing Push'                                  }, // 4 (Autumn promo can live around here)
  { key: 'retail',     label: 'Retail Activations'                              }, // 5
  { key: 'weekend-a',  label: 'Weekend A'                                       }, // 6 (above Sat/Sun)
  { key: 'weekend-b',  label: 'Weekend B'                                       }, // 7 (above Sat/Sun)
  { key: 'overflow',   label: 'Overflow / Experiments'                          }, // 8
];

/* ------------------------------- Lanes row -------------------------------- */

export function ensureLeadsLanes(
  root = document.getElementById("main-calendar-grid"),
  laneCount = LANE_CONFIG.length
) {
  if (!root) return null;
  let lanes = root.querySelector(".leads-lanes");
  if (!lanes) {
    lanes = document.createElement("div");
    lanes.className = "leads-lanes";
    root.prepend(lanes);
  }

  // Rebuild lanes if count changed
  const existing = lanes.querySelectorAll(".lead-lane");
  if (existing.length !== laneCount) {
    lanes.innerHTML = "";
    for (let i = 0; i < laneCount; i++) {
      const lane = document.createElement("div");
      lane.className = "lead-lane";
      lane.dataset.lane = String(i);

      // Optional on-lane label
      const label = document.createElement("div");
      label.className = "lane-label";
      label.textContent = (LANE_CONFIG[i]?.label) || `Lane ${i+1}`;
      lane.appendChild(label);

      lanes.appendChild(lane);
    }
  }
  return lanes;
}

/* ------------------------------ Normalization ----------------------------- */
const MERGED_DAY_KEYS = {
  MonTue: ["Monday", 2], TueWed: ["Tuesday", 2], WedThu: ["Wednesday", 2],
  ThuFri: ["Thursday", 2], FriSat: ["Friday", 2], SatSun: ["Saturday", 2],
  SunMon: ["Sunday", 2],
};

export function normalizeLeads(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.leads)) return payload.leads;
  if (Array.isArray(payload.items)) return payload.items;

  const toFlat = (obj) => Object.entries(obj).flatMap(([key, arr]) => {
    if (!Array.isArray(arr)) return [];
    if (DAYS.includes(key)) return arr.map(ch => ({ day: key, span: Number(ch.span) || 1, ...ch }));
    if (MERGED_DAY_KEYS[key]) {
      const [startDay, span] = MERGED_DAY_KEYS[key];
      return arr.map(ch => ({ day: startDay, span, ...ch }));
    }
    return [];
  });

  if (payload.leads && typeof payload.leads === "object" && !Array.isArray(payload.leads)) {
    return toFlat(payload.leads);
  }
  if (typeof payload === "object") {
    return toFlat(payload);
  }
  return [];
}

// Add default 3 buckets per lane: [Tue–Wed], [Thu–Fri], [Sat–Sun]
export function seedDefaultLeadBuckets(lanesRoot, laneCount = 3) {
  if (!lanesRoot) return;
  const PAIRS = [
    { day: "Tuesday",  span: 2, label: "Bucket 1" },
    { day: "Thursday", span: 2, label: "Bucket 2" },
    { day: "Saturday", span: 2, label: "Bucket 3" },
  ];
  for (let laneIdx = 0; laneIdx < laneCount; laneIdx++) {
    const lane = lanesRoot.querySelector(`.lead-lane[data-lane="${laneIdx}"]`);
    if (!lane) continue;
    // Only seed if this lane has no chips yet
    if (lane.querySelector(".lead-chip")) continue;

    PAIRS.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "lead-chip";
      chip.style.setProperty("--start", {Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6,Sunday:7}[p.day]);
      chip.style.setProperty("--span", p.span);
      chip.dataset.day = p.day;
      chip.innerHTML = `
        <div class="chip-header">
          <span class="title">${p.label}</span>
        </div>
        <div class="leads-drawer" data-day="${p.day}" data-lane="${laneIdx}"></div>
      `;
      lane.appendChild(chip);
    });
  }
}

/* --------------------------- Chip + bucket (lane) ------------------------- */
const DAY_NUM = { Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6, Sunday:7 };

function wireLeadsInteractivity(lanesRoot) {
  if (!lanesRoot) return;

  // Remember dragged wine if .dragging isn’t added by the source
  document.addEventListener("dragstart", (e) => {
    const wb = e.target?.closest?.(".wine-box");
    if (wb) window.__avuDraggingWine = wb;
  }, { capture: true });

  lanesRoot.querySelectorAll(".lead-chip").forEach((chip) => {
    if (chip.__wired) return;
    chip.__wired = true;

    const bucket = chip.querySelector(".leads-drawer");
    const day = chip.dataset.day;
    const highlight = (on) => chip.classList.toggle("over", !!on);

    chip.addEventListener("dragenter", (e) => { e.preventDefault(); highlight(true); });
    chip.addEventListener("dragover",  (e) => { e.preventDefault(); });
    chip.addEventListener("dragleave", ()  => { highlight(false); });
    chip.addEventListener("drop", async (e) => {
      e.preventDefault(); e.stopPropagation(); highlight(false);
      const dragged = document.querySelector(".wine-box.dragging") || window.__avuDraggingWine;
      if (!dragged || !bucket) return;

      const data = {
        id: dragged.dataset.id || null,
        wine: dragged.dataset.name || dragged.dataset.wine || dragged.textContent.trim() || "Unknown",
        vintage: dragged.dataset.vintage || "NV",
        full_type: dragged.dataset.type || "",
        region_group: dragged.dataset.region || "",
        stock: dragged.dataset.stock || "",
        price_tier: dragged.dataset.priceTier || "",
        match_quality: dragged.dataset.matchQuality || "",
        avg_cpi_score: dragged.dataset.cpiScore || "",
        last_campaign: dragged.dataset.lastCampaign || ""
      };

      renderWineIntoBox(bucket, data, { locked: false });
      if (dragged.isConnected) dragged.remove();

      addDropZoneListeners();

      try {
        const Cal = await import("./calendar.js");
        await Cal.persistFullCalendarSnapshot?.();
        await Cal.persistLockedCalendarState?.();
      } catch {}
      window?.recalcAndUpdateGauge?.({ animate: true });
    });

    chip.addEventListener("click", () => { if (day) window.openQuickAdd?.(day, 0); });
    chip.addEventListener("keydown", (e) => {
      if (day && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); window.openQuickAdd?.(day, 0); }
    });
  });

  addDropZoneListeners();
}

/* --------------------------------- Helper --------------------------------- */
function pickLaneIndex(it) {
  if (Number.isFinite(it.lane)) {
    return Math.max(0, Math.min(LANE_CONFIG.length - 1, it.lane));
  }

  const title = String(it.title || "").toLowerCase();
  const seg   = String(it.segment || it.market || "").toLowerCase();
  const day   = String(it.day || "");

  // Two lanes reserved for CH and two for World (0/2 and 1/3 respectively)
  if (seg.startsWith("ch")) {
    return title.includes("vip") ? 0 : 2;
  }
  if (seg.includes("world") || seg.includes("intl") || seg.includes("international")) {
    return title.includes("vip") ? 1 : 3;
  }

  // Weekend-oriented slots
  if (day === "Saturday" || day === "Sunday") return 6; // Weekend A by default

  // Mid-rail default (marketing/promo type)
  return 4;
}

/* --------------------------------- Render --------------------------------- */

export async function renderLeadsFromData(items = []) {
  items = normalizeLeads(items);

  const grid = document.getElementById("main-calendar-grid");
  const lanesRoot = ensureLeadsLanes(grid, 3);
  if (!lanesRoot) return false;

  // Clear existing chips only
  lanesRoot.querySelectorAll(".lead-chip").forEach((n) => n.remove());

  items.forEach((it) => {
    const laneIdx = pickLaneIndex(it);
    const lane = lanesRoot.querySelector(`.lead-lane[data-lane="${laneIdx}"]`);
    if (!lane) return;

    const chip = document.createElement("div");
    chip.className = "lead-chip" + (it.locked ? " is-locked" : "");
    chip.style.setProperty("--start", DAY_NUM[it.day] || 1);
    chip.style.setProperty("--span", Math.max(1, Math.min(2, Number(it.span) || 1)));
    chip.dataset.day = it.day || "";

    // inside renderLeadsFromData() when you create each chip
    chip.innerHTML = `
      <div class="chip-header">
        <span class="title">${it.title || "Lead"}</span>
        ${it.meta ? ` <span class="meta">· ${it.meta}</span>` : ""}
      </div>
      <div class="leads-drawer" data-day="${it.day}" data-lane="${laneIdx}"></div>
    `;


    lane.appendChild(chip);
  });

  wireLeadsInteractivity(lanesRoot);
  return true;
}

/* --------------------------------- Fetch ---------------------------------- */
export async function getLeadsForWeek(year, week) {
  try {
    const r = await fetch(`${URLS.leads}?year=${encodeURIComponent(year)}&week=${encodeURIComponent(week)}`, { cache: "no-store" });
    if (r.ok) return r.json();
  } catch {}
  try {
    const r2 = await fetch(`${URLS.leads}?week=${encodeURIComponent(week)}`, { cache: "no-store" });
    if (r2.ok) return r2.json();
  } catch {}
  return null;
}
