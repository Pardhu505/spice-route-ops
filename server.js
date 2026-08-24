/**
 * Spice Route Kitchens · Operations Pulse — API + static host
 * ----------------------------------------------------------
 * Serves the Area Manager dashboard and a small read-only API over the
 * pre-aggregated Linemate extract in ./data.
 *
 * The dashboard does its own slicing client-side, so the hot path is one
 * cached payload rather than a query per filter change. The /api/outlets and
 * /api/tickets endpoints exist for anything else that needs the same numbers
 * (Slack digests, the monthly report job, a mobile client).
 */
"use strict";

const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const REPORT_DIR = path.join(__dirname, "reports");
const PUBLIC_DIR = path.join(__dirname, "public");

/* ------------------------------------------------------------------ load --
   Both files are read once at boot. The extract is ~550 KB and immutable
   between ETL runs, so holding it in memory beats re-reading per request.  */
function loadJSON(file) {
  const full = path.join(DATA_DIR, file);
  if (!fs.existsSync(full)) {
    console.error(`[fatal] missing ${full} — run the ETL (see etl/build.py)`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

const DASHBOARD = loadJSON("dashboard.json");
const METRICS = loadJSON("metrics.json");

// pre-serialise so we are not stringifying 550 KB on every request
const DASHBOARD_JSON = JSON.stringify(DASHBOARD);
const DASHBOARD_JS = `window.__SPICE_DATA__=${DASHBOARD_JSON};`;
const BUILD_TAG = String(DASHBOARD.meta.generated || Date.now())
  .replace(/\D/g, "");

/* ---------------------------------------------------------------- lookups */
const OUTLET_BY_ID = new Map(DASHBOARD.outlets.map(o => [o.id, o]));
const USER_OUTLET = OUTLET_BY_ID; // alias for readability below

/* ------------------------------------------------------------ middleware */
app.disable("x-powered-by");
app.use(compression());              // 550 KB payload -> ~90 KB over the wire
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

// allow other internal tools to read the API
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const cache = seconds => (req, res, next) => {
  res.setHeader("Cache-Control", `public, max-age=${seconds}`);
  next();
};

/* ----------------------------------------------------------------- routes */

// Render pings this to decide whether the instance is alive.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "spice-route-ops",
    dataWindow: { from: DASHBOARD.meta.start, to: DASHBOARD.meta.end,
                  days: DASHBOARD.meta.days },
    counts: {
      outlets: DASHBOARD.outlets.length,
      submissions: DASHBOARD.submissions.length,
      tickets: DASHBOARD.tickets.length
    },
    extractBuiltAt: DASHBOARD.meta.generated,
    uptimeSeconds: Math.round(process.uptime())
  });
});

// The dashboard bootstraps from this — a script rather than a fetch so the
// payload is in place before app.js executes, with no loading flash.
app.get("/api/dashboard.js", cache(300), (req, res) => {
  res.type("application/javascript").send(DASHBOARD_JS);
});

// Same payload as plain JSON for any other consumer.
app.get("/api/dashboard", cache(300), (req, res) => {
  res.type("application/json").send(DASHBOARD_JSON);
});

// Aggregates behind the monthly VP report.
app.get("/api/metrics", cache(300), (req, res) => res.json(METRICS));

// Outlet directory, optionally filtered by area manager or state.
app.get("/api/outlets", cache(300), (req, res) => {
  const { am, state } = req.query;
  let rows = DASHBOARD.outlets;
  if (am) rows = rows.filter(o => o.am.toLowerCase() === String(am).toLowerCase());
  if (state) rows = rows.filter(o => o.state.toLowerCase() === String(state).toLowerCase());
  res.json({ count: rows.length, outlets: rows });
});

// Per-outlet scorecard for the full extract window.
app.get("/api/outlets/:id/scorecard", cache(300), (req, res) => {
  const id = Number(req.params.id);
  const outlet = OUTLET_BY_ID.get(id);
  if (!outlet) return res.status(404).json({ error: "unknown outlet id" });
  const row = (METRICS.scorecard || []).find(r => r.outlet_id === id);
  if (!row) return res.status(404).json({ error: "no scorecard row for that outlet" });
  res.json(row);
});

// Tickets, filterable — used by the escalation digest.
app.get("/api/tickets", cache(120), (req, res) => {
  const { status, priority, outlet, overdueOnly } = req.query;
  const now = new Date(DASHBOARD.meta.end + "T23:59:59");
  let rows = DASHBOARD.tickets.map(t => ({
    ticket_id: t[0], outlet_id: t[1], outlet: (OUTLET_BY_ID.get(t[1]) || {}).name,
    title: t[2], category: t[3], status: t[4], priority: t[5],
    raised_by: t[6], assigned_to: t[7], raised_on: t[8], due_date: t[9],
    closed_at: t[10], source_submission_id: t[11]
  }));
  if (status) rows = rows.filter(r => r.status.toLowerCase() === String(status).toLowerCase());
  if (priority) rows = rows.filter(r => r.priority.toLowerCase() === String(priority).toLowerCase());
  if (outlet) rows = rows.filter(r => r.outlet_id === Number(outlet));
  if (overdueOnly === "true") {
    rows = rows.filter(r => {
      const open = r.status === "Open" || r.status === "Escalated";
      const due = new Date(r.due_date.replace(" ", "T"));
      return open ? due < now : new Date(r.closed_at.replace(" ", "T")) > due;
    });
  }
  res.json({ count: rows.length, tickets: rows });
});

// Latest monthly report, both formats.
const REPORT_BASE = "Spice-Route-Monthly-Ops-Review-Aug-2026";
["pdf", "docx"].forEach(ext => {
  app.get(`/api/report/${ext}`, (req, res) => {
    const file = path.join(REPORT_DIR, `${REPORT_BASE}.${ext}`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: "report not generated yet" });
    res.download(file);
  });
});

/* ------------------------------------------------------------ static site */
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "unknown endpoint" });
  res.status(404).sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "internal error" });
});

app.listen(PORT, () => {
  console.log(`spice-route-ops listening on :${PORT}`);
  console.log(`  data window ${DASHBOARD.meta.start} → ${DASHBOARD.meta.end}`);
  console.log(`  ${DASHBOARD.outlets.length} outlets · ` +
              `${DASHBOARD.submissions.length} submissions · ` +
              `${DASHBOARD.tickets.length} tickets · build ${BUILD_TAG}`);
});
