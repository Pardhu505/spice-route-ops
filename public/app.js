/* Spice Route Kitchens - Operations Pulse (client)
   Data arrives from /api/dashboard.js as window.__SPICE_DATA__ */
(function () {
"use strict";
const DATA = window.__SPICE_DATA__;
if (!DATA) {
  document.getElementById("strip").innerHTML =
    '<div class="pill bad"><b>!</b>Could not load dashboard data. '
    + 'Check the server logs, then reload.</div>';
  return;
}

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t);
  if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
const fmt = (v, d = 1) => v === null || v === undefined || isNaN(v) ? "–" : (+v).toFixed(d);
const pct = v => v === null || v === undefined || isNaN(v) ? "–" : (+v).toFixed(1) + "%";
const DAY = 864e5;

/* ---------- decode ---------- */
const START = new Date(DATA.meta.start + "T00:00:00");
const END = new Date(DATA.meta.end + "T00:00:00");
const NDAYS = DATA.meta.days, NWEEKS = DATA.meta.weeks;
const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dateOf = i => new Date(START.getTime() + i * DAY);
const shortDate = d => `${d.getDate()} ${MON[d.getMonth()]}`;
const idxOf = ts => Math.floor((new Date(ts.replace(" ", "T")) - START) / DAY);

const OUTLETS = DATA.outlets;
const O = {}; OUTLETS.forEach(o => O[o.id] = o);

const SUBS = DATA.submissions.map(r => ({
  id: r[0], oid: r[1], fid: r[2], ts: r[3], user: r[4], role: r[5],
  comp: r[6], thr: r[7], di: idxOf(r[3]),
  hour: +r[3].slice(11, 13) + (+r[3].slice(14, 16)) / 60
}));
const SUBX = {}; SUBS.forEach(s => SUBX[s.id] = s);

const TICKETS = DATA.tickets.map(r => ({
  id: r[0], oid: r[1], title: r[2], cat: r[3], status: r[4], prio: r[5],
  by: r[6], to: r[7], raised: r[8], due: r[9], closed: r[10], src: r[11],
  di: idxOf(r[8])
}));
const NOW = new Date(END.getTime() + DAY);           // end of the last data day
TICKETS.forEach(t => {
  t.open = t.status === "Open" || t.status === "Escalated";
  const raised = new Date(t.raised.replace(" ", "T"));
  const due = new Date(t.due.replace(" ", "T"));
  const closed = t.closed ? new Date(t.closed.replace(" ", "T")) : null;
  t.ageD = ((t.open ? NOW : closed) - raised) / DAY;
  t.overdue = t.open ? due < NOW : closed > due;
  t.overdueBy = (NOW - due) / DAY;
  t.resH = closed ? (closed - raised) / 36e5 : null;
});

/* issue reports live in form 105: qids 45 type, 46 severity, 47 text, 48 photo */
const ISSUES = SUBS.filter(s => s.fid === 105).map(s => {
  const a = DATA.answers[s.id] || [];
  const t = TICKETS.find(t => t.src === s.id);
  return { ...s, type: a[0], sev: a[1], text: a[2], photo: a[3],
           ticket: t ? t.id : null, tstatus: t ? t.status : null };
});

/* yes/no answer index for failure rates */
const QMETA = {};
Object.entries(DATA.forms).forEach(([fid, f]) =>
  f.questions.forEach((q, i) => QMETA[q.qid] = { ...q, fid: +fid, pos: i, form: f.name }));

/* ---------- state ---------- */
const RANGES = [["1", "Yesterday"], ["7", "7 days"], ["28", "28 days"], ["0", "Full quarter"]];
const state = { am: "all", state: "all", outlet: "all", range: "28",
                sort: "health", dir: -1 };

function rangeIdx() {
  const n = +state.range === 0 ? NDAYS : +state.range;
  return [Math.max(0, NDAYS - n), NDAYS - 1];
}
function prevRangeIdx() {
  const [a, b] = rangeIdx(), n = b - a + 1;
  return [Math.max(0, a - n), Math.max(0, a - 1)];
}
function visibleOutlets() {
  return OUTLETS.filter(o =>
    (state.am === "all" || o.am === state.am) &&
    (state.state === "all" || o.state === state.state) &&
    (state.outlet === "all" || o.id === +state.outlet));
}

/* ---------- aggregation ---------- */
function coverageCount(oid, key, a, b) {
  const s = DATA.coverage[oid][key];
  let done = 0, tot = 0;
  for (let i = a; i <= b; i++) { tot++; if (s[i] === "1") done++; }
  return [done, tot];
}
function auditCount(oid, a, b) {
  const s = DATA.coverage[oid].audit;
  const w0 = Math.floor(a / 7), w1 = Math.min(NWEEKS - 1, Math.floor(b / 7));
  let done = 0, tot = 0;
  for (let w = w0; w <= w1; w++) { tot++; if (s[w] === "1") done++; }
  return [done, tot];
}
function statsFor(list, a, b) {
  const ids = new Set(list.map(o => o.id));
  let done = 0, tot = 0, ad = 0, at = 0;
  list.forEach(o => {
    const [d1, t1] = coverageCount(o.id, "open", a, b);
    const [d2, t2] = coverageCount(o.id, "close", a, b);
    const [d3, t3] = auditCount(o.id, a, b);
    done += d1 + d2; tot += t1 + t2; ad += d3; at += t3;
  });
  const subs = SUBS.filter(s => ids.has(s.oid) && s.di >= a && s.di <= b);
  const scored = subs.filter(s => s.comp !== null);
  const tick = TICKETS.filter(t => ids.has(t.oid) && t.di >= a && t.di <= b);
  const openT = TICKETS.filter(t => ids.has(t.oid) && t.open);
  const iss = ISSUES.filter(s => ids.has(s.oid) && s.di >= a && s.di <= b);
  let ynTot = 0, ynFail = 0;
  subs.forEach(s => {
    const ans = DATA.answers[s.id]; if (!ans) return;
    DATA.forms[s.fid].questions.forEach((q, i) => {
      if (q.type !== "yes_no") return;
      if (ans[i] === "Yes") ynTot++; else if (ans[i] === "No") { ynTot++; ynFail++; }
    });
  });
  return {
    completion: tot ? done * 100 / tot : null, missed: tot - done,
    audit: at ? ad * 100 / at : null, auditMissed: at - ad,
    compliance: scored.length ? scored.reduce((x, s) => x + s.comp, 0) / scored.length : null,
    below: scored.filter(s => s.comp < s.thr).length,
    belowPct: scored.length ? scored.filter(s => s.comp < s.thr).length * 100 / scored.length : null,
    failPct: ynTot ? ynFail * 100 / ynTot : null,
    subs: subs.length, issues: iss.length,
    highIssues: iss.filter(i => i.sev === "High").length,
    issuesNoTicket: iss.filter(i => !i.ticket).length,
    tickets: tick.length, openTickets: openT.length,
    overdue: openT.filter(t => t.overdue).length,
    escalated: openT.filter(t => t.status === "Escalated").length,
    lateOpens: subs.filter(s => s.fid === 101 && s.hour >= 9).length
  };
}
function outletRow(o, a, b) {
  const st = statsFor([o], a, b);
  const health = Math.round((
    (st.completion || 0) / 100 * 35 + (st.audit || 0) / 100 * 15 +
    (st.compliance || 0) / 100 * 30 + (1 - (st.failPct || 0) / 100) * 20) * 10) / 10;
  return { ...o, ...st, health,
           band: health >= 85 ? "ok" : health >= 70 ? "warn" : "bad" };
}



/* ======================================================================
   Presentation layer
   ====================================================================== */
const C = { ok:"#12805A", warn:"#B4740A", bad:"#C0392B",
            c1:"#C4451C", c2:"#1F6FB4", c3:"#0E8A6B", c4:"#D89211",
            c5:"#6A4FA3", c6:"#2C97B4", c7:"#B03A5B",
            muted:"#748799", line:"#EBF0F4", grid:"#E4EAEF" };
const CAT = [C.c1, C.c2, C.c3, C.c4, C.c5, C.c6, C.c7];
const WORD = { ok:"Good", warn:"Watch", bad:"At risk" };
const iso = d => d.toISOString().slice(0, 10);

/* ---- custom date range replaces the preset-only range from core ---- */
state.from = NDAYS - 28; state.to = NDAYS - 1;
function rangeIdx() { return [state.from, state.to]; }
function prevRangeIdx() {
  const n = state.to - state.from + 1;
  return [Math.max(0, state.from - n), Math.max(0, state.from - 1)];
}

TICKETS.forEach(t => {
  t.dueDi = Math.floor((new Date(t.due.replace(" ", "T")) - START) / DAY);
  t.closedDi = t.closed ? Math.floor((new Date(t.closed.replace(" ", "T")) - START) / DAY) : null;
});

function series(list, a, b) {
  const ids = new Set(list.map(o => o.id));
  const comp = [], done = [];
  for (let i = a; i <= b; i++) {
    let dn = 0, tt = 0;
    list.forEach(o => { tt += 2;
      if (DATA.coverage[o.id].open[i] === "1") dn++;
      if (DATA.coverage[o.id].close[i] === "1") dn++; });
    done.push(tt ? dn * 100 / tt : null);
    const sc = SUBS.filter(s => ids.has(s.oid) && s.di === i && s.comp !== null);
    comp.push(sc.length ? sc.reduce((x, s) => x + s.comp, 0) / sc.length : null);
  }
  return { done, comp };
}

/* ================= chart helpers ================= */
let gid = 0;

function lineChart(sets, a, b, opts) {
  opts = opts || {};
  const W = 900, H = opts.h || 330, P = { t:16, r:16, b:34, l:46 };
  const n = sets[0].data.length;
  const X = i => P.l + i * (W - P.l - P.r) / Math.max(1, n - 1);
  const Y = v => P.t + (100 - Math.max(0, Math.min(100, v))) / 100 * (H - P.t - P.b);
  let g = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    style="width:100%;height:${H}px" role="img" aria-label="Operational trend">`;
  const base = "lg" + (++gid) + "_";
  g += `<defs>`;
  sets.forEach((s, k) => {
    g += `<linearGradient id="${base}${k}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color}" stop-opacity=".14"/>
      <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
  });
  g += `</defs>`;
  [0, 25, 50, 75, 100].forEach(v => {
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"
      stroke="${C.grid}" stroke-width="1" vector-effect="non-scaling-stroke"/>
      <text x="${P.l - 10}" y="${Y(v) + 5}" text-anchor="end" font-size="13"
      font-family="Calibri,Carlito,sans-serif" fill="${C.muted}">${v}%</text>`;
  });
  const path = arr => { let d = "", prev = null;
    arr.forEach((v, i) => { if (v === null) return;
      d += (prev === null ? "M" : "L") + X(i).toFixed(1) + "," + Y(v).toFixed(1) + " "; prev = i; });
    return d; };
  sets.forEach((s, k) => {
    const d = path(s.data); if (!d) return;
    const f = s.data.findIndex(v => v !== null); let l = 0;
    s.data.forEach((v, i) => { if (v !== null) l = i; });
    if (k === 0)
      g += `<path d="M${X(f).toFixed(1)},${H - P.b} ${d.replace(/^M/, "L")}L${X(l).toFixed(1)},${H - P.b} Z"
        fill="url(#${base}${k})"/>`;
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    g += `<circle cx="${X(l).toFixed(1)}" cy="${Y(s.data[l]).toFixed(1)}" r="4"
      fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
  });
  const ticks = Math.min(7, n);
  for (let k = 0; k < ticks; k++) {
    const i = Math.round(k * (n - 1) / Math.max(1, ticks - 1));
    g += `<text x="${X(i)}" y="${H - 10}" font-size="13" font-family="Calibri,Carlito,sans-serif"
      fill="${C.muted}" text-anchor="${k === 0 ? "start" : k === ticks - 1 ? "end" : "middle"}"
      >${shortDate(dateOf(a + i))}</text>`;
  }
  return g + `</svg>`;
}

function hbars(target, rows, opts) {
  opts = opts || {};
  const box = $(target); box.innerHTML = "";
  if (!rows.length) { box.innerHTML = `<div class="blank">Nothing to show here.</div>`; return; }
  const max = Math.max(...rows.map(r => r.value), 1);
  rows.forEach(r => {
    const n = el("div", "hb");
    if (opts.labelWidth) n.style.setProperty("--lw", opts.labelWidth);
    n.innerHTML = `<div class="l">${r.label}${r.sub ? `<em>${r.sub}</em>` : ""}</div>
      <div class="t"><i style="width:${Math.max(1.5, r.value / max * 100)}%;
        background:${r.color}"></i></div>
      <div class="v" style="color:${r.strong ? r.color : "var(--text)"}">${r.display ?? r.value}</div>`;
    if (r.onClick) { n.style.cursor = "pointer"; n.onclick = r.onClick; }
    box.appendChild(n);
  });
}

function donut(target, segs, centre, sub) {
  const R = 74, r = 47, cx = 100, cy = 100;
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  let ang = -Math.PI / 2, g = `<svg viewBox="0 0 320 200" style="width:100%;height:200px"
    role="img" aria-label="Ticket resolution">`;
  segs.forEach(s => {
    const sweep = s.value / total * Math.PI * 2;
    if (s.value > 0) {
      const a0 = ang, a1 = ang + sweep, big = sweep > Math.PI ? 1 : 0;
      const p = (rad, an) => [(cx + rad * Math.cos(an)).toFixed(2), (cy + rad * Math.sin(an)).toFixed(2)];
      const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
      g += `<path d="M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1}
        L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z" fill="${s.color}"/>`;
    }
    ang += sweep;
  });
  g += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="34" font-weight="700"
    font-family="Calibri,Carlito,sans-serif" fill="#16202B">${centre}</text>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="14"
    font-family="Calibri,Carlito,sans-serif" fill="${C.muted}">${sub}</text>`;
  segs.forEach((s, i) => {
    const y = 56 + i * 27;
    g += `<rect x="196" y="${y - 10}" width="12" height="12" rx="3" fill="${s.color}"/>
      <text x="216" y="${y}" font-size="15" font-family="Calibri,Carlito,sans-serif"
        fill="#43566A">${s.label}</text>
      <text x="316" y="${y}" font-size="15" font-weight="700" text-anchor="end"
        font-family="Calibri,Carlito,sans-serif" fill="#16202B">${s.value}</text>`;
  });
  $(target).innerHTML = g + `</svg>`;
}

/* ================= panels ================= */
function renderStrip(list, cur, a, b) {
  const rows = list.map(o => outletRow(o, a, b));
  const risky = rows.filter(r => r.band === "bad");
  const items = [
    { c:"bad", n:cur.missed, t:"checklists never filed" },
    { c:risky.length ? "bad" : "ok", n:risky.length, t:"stores at risk" },
    { c:"bad", n:cur.overdue, t:"tickets past deadline" },
    { c:"warn", n:cur.escalated, t:"tickets escalated" },
    { c:"warn", n:cur.highIssues, t:"high-severity issues" },
    { c:cur.issuesNoTicket ? "warn" : "ok", n:cur.issuesNoTicket, t:"issues with no ticket" },
    { c:"warn", n:cur.auditMissed, t:"store-weeks with no audit" }
  ];
  $("#strip").innerHTML = items.map(i =>
    `<div class="pill ${i.c}"><b>${i.n}</b>${i.t}</div>`).join("");
}

const KPI_DEFS = [
  { k:"completion", lab:"Daily checklist completion", pct:1, good:1, col:"var(--c1)",
    note:"Opening + closing vs expected" },
  { k:"audit", lab:"Weekly hygiene audit completion", pct:1, good:1, col:"var(--c3)",
    note:"Expected: 1 audit / outlet / week" },
  { k:"compliance", lab:"Average compliance score", pct:1, good:1, col:"var(--c2)",
    note:"Daily checklist + audit submissions" },
  { k:"overdue", lab:"Tickets past deadline", pct:0, good:-1, snap:1, col:"var(--bad)",
    note:c => `${c.openTickets} still open · ${c.escalated} escalated` },
  { k:"issues", lab:"Issues reported by staff", pct:0, good:0, col:"var(--c4)",
    note:c => `${c.highIssues} high severity · ${c.issuesNoTicket} never ticketed` }
];

function renderKPIs(cur, prev, showDelta) {
  const box = $("#kpis"); box.innerHTML = "";
  KPI_DEFS.forEach(dfn => {
    const v = cur[dfn.k], p = prev[dfn.k];
    const n = el("div", "kpi");
    n.style.setProperty("--kc", dfn.col);
    n.appendChild(el("div", "lab", dfn.lab));
    const val = el("div", "val");
    val.innerHTML = dfn.pct ? `${fmt(v, 0)}<small>%</small>` : `${v}`;
    if (!dfn.snap && showDelta && p !== null && p !== undefined && !isNaN(p) && dfn.good !== 0) {
      const diff = v - p, good = dfn.good > 0 ? diff > 0 : diff < 0;
      const cls = Math.abs(diff) < .5 ? "flat" : good ? "up" : "down";
      val.appendChild(el("span", "chip " + cls,
        (diff > 0 ? "↑" : diff < 0 ? "↓" : "±") + " " +
        (dfn.pct ? Math.abs(diff).toFixed(1) + "pt" : Math.abs(Math.round(diff)))));
    }
    n.appendChild(val);
    n.appendChild(el("div", "note",
      typeof dfn.note === "function" ? dfn.note(cur) : dfn.note));
    box.appendChild(n);
  });
}

function renderTrend(list, a, b) {
  const s = series(list, a, b);
  $("#trend").innerHTML = lineChart([
    { data:s.done, color:C.c1 }, { data:s.comp, color:C.c2 }], a, b, { h:330 });
  $("#trendMeta").innerHTML = `${b - a + 1} days · ${list.length} outlet${list.length > 1 ? "s" : ""}`;
}

function renderHotspots(list, a, b) {
  const ids = new Set(list.map(o => o.id));
  const t = TICKETS.filter(x => ids.has(x.oid) && x.di >= a && x.di <= b);
  const cats = {};
  t.forEach(x => cats[x.cat] = (cats[x.cat] || 0) + 1);
  const rows = Object.entries(cats).sort((x, y) => y[1] - x[1])
    .map(([k, v], i) => ({ label:k, value:v, color:CAT[i % CAT.length], strong:1 }));
  hbars("#hotspots", rows, { labelWidth:"128px" });
}

function renderRank(list, a, b) {
  const rows = list.map(o => outletRow(o, a, b))
    .sort((x, y) => (y.completion ?? 0) - (x.completion ?? 0));
  const W = 900, rowH = 26, P = { t:22, l:184, r:56, b:8 };
  const H = P.t + rows.length * rowH + P.b;
  const bw = W - P.l - P.r;
  let g = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px"
    role="img" aria-label="Checklist completion by outlet">`;
  [0, 25, 50, 75, 100].forEach(v => {
    const x = P.l + v / 100 * bw;
    g += `<line x1="${x}" x2="${x}" y1="${P.t - 6}" y2="${H - P.b}" stroke="${C.grid}"
      vector-effect="non-scaling-stroke"/>
      <text x="${x}" y="${P.t - 12}" text-anchor="middle" font-size="12.5"
      font-family="Calibri,Carlito,sans-serif" fill="${C.muted}">${v}%</text>`;
  });
  const tx = P.l + .85 * bw;
  g += `<line x1="${tx}" x2="${tx}" y1="${P.t - 6}" y2="${H - P.b}" stroke="#16202B"
    stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
  rows.forEach((r, i) => {
    const y = P.t + i * rowH, v = r.completion || 0;
    const col = r.band === "ok" ? C.ok : r.band === "warn" ? C.c4 : C.bad;
    g += `<text x="${P.l - 12}" y="${y + 15}" text-anchor="end" font-size="14"
      font-family="Calibri,Carlito,sans-serif" fill="#16202B">${r.name}</text>
      <rect x="${P.l}" y="${y + 4}" width="${bw}" height="15" rx="4" fill="#EBF0F4"/>
      <rect x="${P.l}" y="${y + 4}" width="${(v / 100 * bw).toFixed(1)}" height="15" rx="4"
        fill="${col}"><title>${r.name}: ${fmt(v)}% complete</title></rect>
      <text x="${W - P.r + 8}" y="${y + 16}" font-size="14" font-weight="700"
        font-family="Calibri,Carlito,sans-serif" fill="${col}">${fmt(v, 0)}%</text>`;
  });
  const holder = $("#rank"); holder.innerHTML = g + `</svg>`;
  holder.querySelectorAll("rect + text, rect").forEach(() => {});
  $("#rankMeta").innerHTML =
    `${rows.filter(r => (r.completion || 0) >= 85).length} of ${rows.length} at or above target`;
  // click-through on each bar row
  holder.querySelector("svg").addEventListener("click", ev => {
    const box = holder.getBoundingClientRect();
    const yRel = (ev.clientY - box.top) / box.height * H;
    const i = Math.floor((yRel - P.t) / rowH);
    if (i >= 0 && i < rows.length) openOutlet(rows[i].id);
  });
}

function renderDonut(list, a, b) {
  const ids = new Set(list.map(o => o.id));
  const t = TICKETS.filter(x => ids.has(x.oid) && x.di >= a && x.di <= b);
  const closed = t.filter(x => x.status === "Closed").length;
  const open = t.filter(x => x.status === "Open").length;
  const esc = t.filter(x => x.status === "Escalated").length;
  donut("#donut", [
    { label:"Closed", value:closed, color:C.ok },
    { label:"Open", value:open, color:C.c4 },
    { label:"Escalated", value:esc, color:C.bad }
  ], t.length ? Math.round(closed / t.length * 100) + "%" : "–", "closed");
  const prios = ["High", "Medium", "Low"];
  const cols = [C.bad, C.c4, C.c2];
  hbars("#prio", prios.map((p, i) => {
    const g = t.filter(x => x.prio === p);
    const late = g.filter(x => x.overdue).length;
    return { label:`${p} priority`, sub:`${late} of ${g.length} missed the deadline`,
             value:g.length, color:cols[i], display:g.length };
  }), { labelWidth:"150px" });
}

function renderTable(rows) {
  const head = $("#thead"); head.innerHTML = "";
  COLS.forEach(c => {
    const th = el("th", state.sort === c.k ? "on" : "",
      c.lab + (state.sort === c.k ? (state.dir < 0 ? " ↓" : " ↑") : ""));
    th.onclick = () => {
      if (state.sort === c.k) state.dir *= -1;
      else { state.sort = c.k; state.dir = c.k === "name" ? 1 : -1; }
      render();
    };
    head.appendChild(th);
  });
  const body = $("#tbody"); body.innerHTML = "";
  rows.forEach(r => {
    const tr = el("tr");
    tr.onclick = () => openOutlet(r.id);
    COLS.forEach(c => {
      const td = el("td"), v = r[c.k];
      if (c.t === "text") {
        td.innerHTML = `<span class="store">${r.name}</span>
          <span class="store-sub">${r.am} · ${r.sm}</span>`;
      } else if (c.t === "rating") {
        td.innerHTML = `<span class="rating"><span class="num">${fmt(v, 0)}</span>
          <span class="word ${r.band}">${WORD[r.band]}</span></span>`;
      } else if (c.t === "bar") {
        const col = v >= 90 ? C.ok : v >= 75 ? C.c4 : C.bad;
        td.innerHTML = `<span class="pctcell"><span class="n">${fmt(v)}%</span>
          <span class="t"><i style="width:${Math.max(2, v || 0)}%;background:${col}"></i></span></span>`;
      } else if (c.t === "pctbad") {
        const col = v >= 25 ? C.bad : v >= 15 ? C.c4 : "var(--text-2)";
        td.innerHTML = `<span class="n" style="color:${col};font-weight:700">${v === null ? "–" : fmt(v) + "%"}</span>`;
      } else if (c.t === "pct") {
        td.innerHTML = `<span class="n">${v === null ? '<span class="dim">–</span>' : fmt(v) + "%"}</span>`;
      } else {
        td.innerHTML = v ? `<span class="tag ${v >= 5 ? "bad" : "warn"}">${v}</span>`
                         : `<span class="n dim">0</span>`;
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}
const COLS = [
  { k:"name", lab:"Store", t:"text" },
  { k:"health", lab:"Ops rating", t:"rating" },
  { k:"completion", lab:"Checklists", t:"bar" },
  { k:"audit", lab:"Audits", t:"pct" },
  { k:"compliance", lab:"Avg score", t:"pct" },
  { k:"failPct", lab:"Checks failed", t:"pctbad" },
  { k:"overdue", lab:"Tickets late", t:"int" }
];
let ROWS = [];

function renderAttention(list, a, b) {
  const ids = new Set(list.map(o => o.id));
  const items = [];
  TICKETS.filter(t => ids.has(t.oid) && t.open && t.overdue)
    .sort((x, y) => y.overdueBy - x.overdueBy).slice(0, 8)
    .forEach(t => items.push({ sev:t.prio === "High" ? "bad" : "warn", oid:t.oid, t:t.title,
      m:`${O[t.oid].name} · ${t.prio} priority · ${t.id} · with ${t.to}`,
      r:`${Math.floor(t.overdueBy)}d late`, tab:"tickets" }));
  ISSUES.filter(i => ids.has(i.oid) && i.di >= a && i.di <= b && i.sev === "High" && !i.ticket)
    .sort((x, y) => y.di - x.di).slice(0, 6)
    .forEach(i => items.push({ sev:"bad", oid:i.oid, t:"High-severity issue, no ticket raised",
      m:`${O[i.oid].name} · ${i.text}`, r:shortDate(dateOf(i.di)), tab:"issues" }));
  list.forEach(o => {
    for (let i = NDAYS - 1; i > NDAYS - 4 && i >= a; i--)
      if (DATA.coverage[o.id].open[i] !== "1" && DATA.coverage[o.id].close[i] !== "1")
        items.push({ sev:"warn", oid:o.id, t:"No checklist filed at all",
          m:`${o.name} · ${o.sm}`, r:shortDate(dateOf(i)), tab:"subs" });
  });
  SUBS.filter(s => ids.has(s.oid) && s.di >= Math.max(a, NDAYS - 7) &&
                   s.comp !== null && s.comp < s.thr - 20)
    .sort((x, y) => x.comp - y.comp).slice(0, 5)
    .forEach(s => items.push({ sev:"warn", oid:s.oid,
      t:`${DATA.forms[s.fid].name} scored only ${fmt(s.comp, 0)}%`,
      m:`${O[s.oid].name} · filed by ${s.user}`, r:shortDate(dateOf(s.di)), tab:"subs", sub:s.id }));

  const box = $("#attn"); box.innerHTML = "";
  $("#attnCount").textContent = items.length ? `${items.length} items` : "";
  if (!items.length) { box.appendChild(el("div", "blank", "Nothing outstanding.")); return; }
  items.slice(0, 20).forEach(it => {
    const n = el("div", "item");
    n.appendChild(el("span", "dot " + it.sev));
    const mid = el("div");
    mid.appendChild(el("div", "t", it.t));
    mid.appendChild(el("div", "m", it.m));
    n.appendChild(mid);
    n.appendChild(el("div", "r", it.r));
    n.onclick = () => openOutlet(it.oid, it.tab, it.sub);
    box.appendChild(n);
  });
}

function renderFails(list, a, b) {
  const ids = new Set(list.map(o => o.id));
  const agg = {};
  SUBS.filter(s => ids.has(s.oid) && s.di >= a && s.di <= b).forEach(s => {
    const ans = DATA.answers[s.id]; if (!ans) return;
    DATA.forms[s.fid].questions.forEach((q, i) => {
      if (q.type !== "yes_no" || (ans[i] !== "Yes" && ans[i] !== "No")) return;
      agg[q.qid] = agg[q.qid] || { n:0, f:0, q };
      agg[q.qid].n++; if (ans[i] === "No") agg[q.qid].f++;
    });
  });
  const rows = Object.values(agg).filter(r => r.n >= 12)
    .map(r => ({ ...r, pc:r.f * 100 / r.n })).sort((x, y) => y.pc - x.pc).slice(0, 7);
  hbars("#failBars", rows.map(r => ({
    label:r.q.text.replace(/\?$/, ""), sub:`${QMETA[r.q.qid].form} · ${r.f} of ${r.n}`,
    value:r.pc, display:fmt(r.pc) + "%", strong:1,
    color:r.pc >= 25 ? C.bad : r.pc >= 15 ? C.c4 : C.c3
  })), { labelWidth:"240px" });
}

function renderAge(list) {
  const ids = new Set(list.map(o => o.id));
  const open = TICKETS.filter(t => ids.has(t.oid) && t.open);
  const B = [["0–3 days",0,3,C.c2],["4–7 days",3,7,C.c6],["1–2 weeks",7,14,C.c4],
             ["2–4 weeks",14,30,C.c1],["Over a month",30,1e9,C.bad]];
  hbars("#ageBars", B.map(([lab, lo, hi, col]) => {
    const g = open.filter(t => t.ageD > lo && t.ageD <= hi);
    return { label:lab, sub:`${g.filter(t => t.status === "Escalated").length} escalated`,
             value:g.length, color:col, strong:hi > 14 };
  }), { labelWidth:"120px" });
  $("#ageMeta").innerHTML = `${open.length} open · oldest ${
    open.length ? Math.round(Math.max(...open.map(t => t.ageD))) : 0} days`;
}

function renderMissed(list, a, b) {
  const from = Math.max(a, b - 13);
  const rows = [];
  list.forEach(o => {
    for (let i = from; i <= b; i++) {
      const miss = [];
      if (DATA.coverage[o.id].open[i] !== "1") miss.push("Opening Checklist");
      if (DATA.coverage[o.id].close[i] !== "1") miss.push("Closing Checklist");
      if (miss.length) rows.push({ i, o, what:miss, both:miss.length === 2 });
    }
    const w0 = Math.floor(from / 7), w1 = Math.min(NWEEKS - 1, Math.floor(b / 7));
    for (let w = w0; w <= w1; w++)
      if (DATA.coverage[o.id].audit[w] !== "1")
        rows.push({ i:w * 7, sortI:Math.min(b, w * 7 + 6), o,
                    what:["Hygiene & Food Safety Audit"], week:w, both:false });
  });
  rows.sort((x, y) => (y.sortI ?? y.i) - (x.sortI ?? x.i) || x.o.name.localeCompare(y.o.name));
  $("#missMeta").innerHTML = `${rows.length} in the last 14 days`;
  const body = $("#missBody"); body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4"><div class="blank">Nothing missed here.</div></td></tr>`;
    return;
  }
  rows.slice(0, 120).forEach(r => {
    const dt = dateOf(r.i), tr = el("tr");
    tr.onclick = () => openOutlet(r.o.id, r.week !== undefined ? "missed" : "subs",
                                 null, r.week !== undefined ? null : r.i);
    tr.innerHTML = `<td><span class="n">${r.week !== undefined ? "Week of " : ""}${
        dayName[dt.getDay()]} ${shortDate(dt)}</span></td>
      <td style="text-align:left"><span class="store">${r.o.name}</span>
        <span class="store-sub">${r.o.city}</span></td>
      <td style="text-align:left">${r.o.sm}</td>
      <td>${r.both ? `<span class="tag bad">Both checklists missed</span>`
        : r.what.map(w => `<span class="tag ${w.indexOf("Audit") >= 0 ? "warn" : "mute"}">${w}</span>`).join(" ")}</td>`;
    body.appendChild(tr);
  });
}

/* ---------- drawer ---------- */
let drawerOutlet = null, drawerTab = "subs", drawerDay = null;
function openOutlet(oid, tab, subId, dayIdx) {
  drawerOutlet = oid; drawerTab = tab || "subs"; drawerDay = dayIdx ?? null;
  $("#scrim").classList.add("on");
  $("#drawer").classList.add("on");
  $("#drawer").setAttribute("aria-hidden", "false");
  renderDrawer(subId);
}
function closeDrawer() {
  $("#scrim").classList.remove("on");
  $("#drawer").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true");
}
$("#scrim").onclick = closeDrawer;
$("#dClose").onclick = closeDrawer;
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

function renderDrawer(subId) {
  const o = O[drawerOutlet];
  const [a, b] = rangeIdx();
  const st = statsFor([o], a, b);
  const row = outletRow(o, a, b);
  $("#dTitle").textContent = o.name;
  $("#dSub").innerHTML = `${o.city}, ${o.state} &nbsp;·&nbsp; Store manager <b style="color:var(--text-2)">${o.sm}</b>
    &nbsp;·&nbsp; Area manager <b style="color:var(--text-2)">${o.am}</b>
    &nbsp;·&nbsp; ${shortDate(dateOf(a))} – ${shortDate(dateOf(b))}`;
  const body = $("#dBody"); body.innerHTML = "";

  const col = row.band === "ok" ? C.ok : row.band === "warn" ? C.warn : C.bad;
  const k = el("div", "dkpis");
  [["Ops health", `<span style="color:${col}">${fmt(row.health, 0)}</span>`],
   ["Checklist completion", pct(st.completion)],
   ["Avg compliance", pct(st.compliance)],
   ["Open tickets", `${st.openTickets}<span style="font-size:13px;color:var(--bad)"> · ${st.overdue} late</span>`]
  ].forEach(([l, v]) => {
    const d = el("div", "dkpi");
    d.appendChild(el("div", "lab", l));
    d.appendChild(el("div", "val", v));
    k.appendChild(d);
  });
  body.appendChild(k);

  const tabs = el("div", "tabs");
  [["subs", "Submissions"], ["missed", `Missed · ${st.missed}`],
   ["tickets", `Tickets · ${st.tickets}`], ["issues", `Issues · ${st.issues}`]]
    .forEach(([id, lab]) => {
      const btn = el("button", drawerTab === id ? "on" : "", lab);
      btn.onclick = () => { drawerTab = id; renderDrawer(); };
      tabs.appendChild(btn);
    });
  body.appendChild(tabs);
  const pane = el("div", "pane"); body.appendChild(pane);
  const scroll = el("div", "scroll"); pane.appendChild(scroll);

  if (drawerTab === "subs") {
    let list = SUBS.filter(s => s.oid === o.id && s.di >= a && s.di <= b);
    if (drawerDay !== null) list = list.filter(s => s.di === drawerDay);
    list.sort((x, y) => y.ts.localeCompare(x.ts));
    if (drawerDay !== null) {
      const bar = el("div", "", `<div style="padding:14px 22px;border-bottom:1px solid var(--line);
        font-size:13px;color:var(--text-2)">Showing
        <b style="color:var(--text)">${shortDate(dateOf(drawerDay))}</b> only.
        <button class="link" id="clearDay">Show the whole window</button></div>`);
      scroll.appendChild(bar);
      bar.querySelector("#clearDay").onclick = () => { drawerDay = null; renderDrawer(); };
    }
    scroll.appendChild(subTable(list));
    if (subId) showAnswers(subId, body);
  }

  if (drawerTab === "missed") {
    const rows = [];
    for (let i = a; i <= b; i++) {
      const dt = dateOf(i);
      if (DATA.coverage[o.id].open[i] !== "1") rows.push([dt, "Opening Checklist"]);
      if (DATA.coverage[o.id].close[i] !== "1") rows.push([dt, "Closing Checklist"]);
    }
    const w0 = Math.floor(a / 7), w1 = Math.min(NWEEKS - 1, Math.floor(b / 7));
    for (let w = w0; w <= w1; w++)
      if (DATA.coverage[o.id].audit[w] !== "1")
        rows.push([dateOf(w * 7), "Hygiene & Food Safety Audit — week of"]);
    rows.sort((x, y) => y[0] - x[0]);
    scroll.innerHTML = rows.length
      ? `<table><thead><tr><th>Date</th><th>Form not filed</th></tr></thead><tbody>
         ${rows.map(([dt, f]) => `<tr style="cursor:default"><td>${dayName[dt.getDay()]}
           ${shortDate(dt)}</td><td>${f}</td></tr>`).join("")}</tbody></table>`
      : `<div class="blank">Nothing missed in this window.</div>`;
  }

  if (drawerTab === "tickets") {
    const list = TICKETS.filter(t => t.oid === o.id)
      .sort((x, y) => (y.open - x.open) || y.raised.localeCompare(x.raised));
    scroll.innerHTML = list.length
      ? `<table><thead><tr><th>Ticket</th><th>Priority</th><th>Status</th><th>Age</th>
         <th>Owner</th><th>Source</th></tr></thead><tbody>
         ${list.map(t => `<tr style="cursor:default">
           <td><span class="store">${t.title}</span>
             <span class="store-sub">${t.id} · ${t.cat} · raised ${t.raised.slice(0, 10)}</span></td>
           <td><span class="tag ${t.prio === "High" ? "bad" : t.prio === "Medium" ? "warn" : "mute"}">${t.prio}</span></td>
           <td><span class="tag ${t.status === "Closed" ? "ok" : t.status === "Escalated" ? "bad" : "warn"}">${t.status}</span></td>
           <td class="n" ${t.overdue ? 'style="color:var(--bad)"' : ""}>${fmt(t.ageD, 0)}d${t.overdue ? " late" : ""}</td>
           <td>${t.to}</td>
           <td>${t.src ? `<button class="link" data-sub="${t.src}">View report</button>`
                       : `<span class="dim">Raised directly</span>`}</td></tr>`).join("")}
         </tbody></table>`
      : `<div class="blank">No tickets for this store.</div>`;
    scroll.querySelectorAll("[data-sub]").forEach(btn =>
      btn.onclick = e => { e.stopPropagation(); showAnswers(+btn.dataset.sub, body); });
  }

  if (drawerTab === "issues") {
    const list = ISSUES.filter(i => i.oid === o.id && i.di >= a && i.di <= b)
      .sort((x, y) => y.ts.localeCompare(x.ts));
    scroll.innerHTML = list.length
      ? `<table><thead><tr><th>Reported</th><th>Type</th><th>Severity</th><th>Ticket</th></tr></thead>
         <tbody>${list.map(i => `<tr data-sub="${i.id}">
           <td><span class="store">${i.text}</span>
             <span class="store-sub">${i.ts} · ${i.user}${i.photo === "No" ? " · no photo attached" : ""}</span></td>
           <td>${i.type}</td>
           <td><span class="tag ${i.sev === "High" ? "bad" : i.sev === "Medium" ? "warn" : "mute"}">${i.sev}</span></td>
           <td>${i.ticket ? `<span class="n">${i.ticket}</span><span class="store-sub">${i.tstatus}</span>`
                          : `<span class="tag bad">No ticket</span>`}</td></tr>`).join("")}
         </tbody></table>`
      : `<div class="blank">No issues reported in this window.</div>`;
    scroll.querySelectorAll("tr[data-sub]").forEach(tr =>
      tr.onclick = () => showAnswers(+tr.dataset.sub, body));
  }
}

function subTable(list) {
  if (!list.length) return el("div", "blank", "No submissions in this window.");
  const t = el("table");
  t.innerHTML = `<thead><tr><th>Filed</th><th>Form</th><th>By</th><th>Score</th>
    <th>Failed checks</th></tr></thead><tbody>
    ${list.map(s => {
      const ans = DATA.answers[s.id] || [];
      const qs = DATA.forms[s.fid].questions;
      const fails = qs.filter((q, i) => q.type === "yes_no" && ans[i] === "No").length;
      const under = s.comp !== null && s.comp < s.thr;
      const dt = dateOf(s.di);
      return `<tr data-sub="${s.id}">
        <td><span class="n">${dayName[dt.getDay()]} ${shortDate(dt)}</span>
          <span class="store-sub">${s.ts.slice(11)}</span></td>
        <td>${DATA.forms[s.fid].name}</td>
        <td>${s.user}<span class="store-sub">${s.role}</span></td>
        <td>${s.comp === null ? '<span class="n dim">n/a</span>'
          : `<span class="tag ${under ? "bad" : "ok"}">${fmt(s.comp, 0)}%</span>`}</td>
        <td class="n" ${fails ? 'style="color:var(--bad)"' : ""}>${fails || '<span class="dim">0</span>'}</td>
      </tr>`;
    }).join("")}</tbody>`;
  t.querySelectorAll("tr[data-sub]").forEach(tr =>
    tr.onclick = () => showAnswers(+tr.dataset.sub, $("#dBody")));
  return t;
}

function showAnswers(sid, container) {
  const s = SUBX[sid]; if (!s) return;
  const f = DATA.forms[s.fid], ans = DATA.answers[sid] || [];
  const old = container.querySelector(".ansbox"); if (old) old.remove();
  const box = el("div", "ansbox");
  const under = s.comp !== null && s.comp < s.thr;
  box.appendChild(el("h4", "", `${f.name}
    <span class="who">${s.ts} · filed by ${s.user}</span>
    ${s.comp === null ? "" : `<span class="tag ${under ? "bad" : "ok"}" style="margin-left:auto">
      ${fmt(s.comp, 0)}% vs ${fmt(s.thr, 0)}% threshold</span>`}`));
  const secs = {};
  f.questions.forEach((q, i) => { (secs[q.section] = secs[q.section] || []).push([q, ans[i]]); });
  Object.entries(secs).forEach(([name, rows]) => {
    const sec = el("div", "sec");
    sec.appendChild(el("div", "sname", name));
    rows.forEach(([q, v]) => {
      if (q.type === "open_text") {
        sec.appendChild(el("div", "q", q.text));
        sec.appendChild(el("div", "ftext", v || "No remarks"));
      } else {
        const r = el("div", "q" + (v === "No" ? " no" : ""));
        r.appendChild(el("span", "", q.text));
        r.appendChild(el("span", "a", v === null ? "–" : v));
        sec.appendChild(r);
      }
    });
    box.appendChild(sec);
  });
  container.appendChild(box);
  if (box.scrollIntoView) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}


/* ---------- filters ---------- */
function buildFilters() {
  const am = $("#fAM"), st = $("#fState"), ou = $("#fOutlet");
  const from = $("#fFrom"), to = $("#fTo");
  from.min = to.min = iso(START); from.max = to.max = iso(END);
  const ams = [...new Set(OUTLETS.map(o => o.am))].sort();
  const sts = [...new Set(OUTLETS.map(o => o.state))].sort();
  am.innerHTML = `<option value="all">All managers</option>` + ams.map(a => `<option>${a}</option>`).join("");
  st.innerHTML = `<option value="all">All states</option>` + sts.map(a => `<option>${a}</option>`).join("");
  const fill = () => {
    const opts = OUTLETS.filter(o => (state.am === "all" || o.am === state.am) &&
      (state.state === "all" || o.state === state.state));
    ou.innerHTML = `<option value="all">All outlets</option>` +
      opts.map(o => `<option value="${o.id}">${o.name}</option>`).join("");
  };
  fill();
  am.onchange = () => { state.am = am.value; state.outlet = "all"; fill(); render(); };
  st.onchange = () => { state.state = st.value; state.outlet = "all"; fill(); render(); };
  ou.onchange = () => { state.outlet = ou.value; render(); };
  const clampIdx = v => Math.max(0, Math.min(NDAYS - 1,
    Math.round((new Date(v + "T00:00:00") - START) / DAY)));
  from.onchange = () => { if (!from.value) return;
    state.from = Math.min(clampIdx(from.value), state.to); state.range = "custom"; render(); };
  to.onchange = () => { if (!to.value) return;
    state.to = Math.max(clampIdx(to.value), state.from); state.range = "custom"; render(); };
  const seg = $("#fRange"); seg.innerHTML = "";
  RANGES.forEach(([v, lab]) => {
    const b = el("button", state.range === v ? "on" : "", lab);
    b.onclick = () => { state.range = v;
      const n = +v === 0 ? NDAYS : +v;
      state.from = Math.max(0, NDAYS - n); state.to = NDAYS - 1; render(); };
    seg.appendChild(b);
  });
  $("#fReset").onclick = () => {
    Object.assign(state, { am:"all", state:"all", outlet:"all", range:"28",
                           from:NDAYS - 28, to:NDAYS - 1 });
    am.value = "all"; st.value = "all"; fill(); ou.value = "all"; render();
  };
}

/* ---------- render ---------- */
function render() {
  const [a, b] = rangeIdx(), [pa, pb] = prevRangeIdx();
  const list = visibleOutlets();
  const cur = statsFor(list, a, b), prev = statsFor(list, pa, pb);

  $("#coverage").innerHTML = `${iso(dateOf(a))} &rarr; ${iso(dateOf(b))}`;
  $("#fFrom").value = iso(dateOf(a));
  $("#fTo").value = iso(dateOf(b));
  $("#foot").textContent =
    `Linemate analytics · data through ${iso(END)} · built ${DATA.meta.generated}`;

  renderStrip(list, cur, a, b);
  renderKPIs(cur, prev, (pb - pa) === (b - a) && state.from > 0);
  renderTrend(list, a, b);
  renderHotspots(list, a, b);
  renderRank(list, a, b);
  renderDonut(list, a, b);
  ROWS = list.map(o => outletRow(o, a, b));
  ROWS.sort((x, y) => {
    const k = state.sort;
    const va = k === "name" ? x.name : (x[k] ?? -1);
    const vb = k === "name" ? y.name : (y[k] ?? -1);
    return (va > vb ? 1 : va < vb ? -1 : 0) * state.dir;
  });
  renderTable(ROWS);
  renderAttention(list, a, b);
  renderFails(list, a, b);
  renderAge(list);
  renderMissed(list, a, b);
  [...$("#fRange").children].forEach((btn, i) =>
    btn.className = RANGES[i][0] === state.range ? "on" : "");
}

buildFilters();
render();

})();
