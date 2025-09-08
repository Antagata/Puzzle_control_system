// static/js/utils.js
export const NUM_SLOTS = 5;
export const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

export const URLS = {
  status: "/status",
  runFull: "/run_full_engine",
  runNotebook: "/run_notebook",
  schedule: "/api/schedule",
  leads: "/api/leads",
  locked: "/api/locked",
  selectedWine: "/api/selected_wine",
  catalog: "/api/catalog",
  engineReady: "/engine_ready",
  campaignIndex: "/api/campaign_index"
};

// tiny DOM helpers
export const $ = (sel, root=document) => root.querySelector(sel);
export const $all = (sel, root=document) => Array.from(root.querySelectorAll(sel));
export const CAL = () => $("#main-calendar-grid")?.closest(".calendar-grid-container");

// misc utils
export const norm = (s) => String(s ?? "").trim().toLowerCase();
export const safeParse = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
export const makeKey = (id, vintage, name) => `${norm(id || name)}::${norm(vintage || "NV")}`;

export const weekSnapKey   = (yr, wk) => `calendarSnapshot:${yr}-${wk}`;
export const weekLockedKey = (yr, wk) => `lockedCalendar:${yr}-${wk}`;

// ISO week in Europe
export function isoNowEurope() {
  const now = new Date();
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: target.getUTCFullYear(), week: Math.max(1, Math.min(53, week)) };
}
export const getWeekFromUI = () => $("#weekSelector")?.value ?? String(isoNowEurope().week);

// HTTP
export async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
export async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// touch helper
export function addLongPress(el, handler, ms=450) {
  let t=null;
  el.addEventListener("touchstart", (e)=>{ t=setTimeout(()=>handler(e.touches[0]), ms); }, {passive:true});
  el.addEventListener("touchmove", ()=>{ if(t){clearTimeout(t); t=null;} }, {passive:true});
  el.addEventListener("touchend",  ()=>{ if(t){clearTimeout(t); t=null;} }, {passive:true});
}
