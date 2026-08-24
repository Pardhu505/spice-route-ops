# Spice Route Kitchens · Operations Pulse

Area Manager dashboard and read-only API over the Linemate operational extract,
plus the monthly Operations Review for the VP.

Built for Linemate · Task 1, Senior Data & Insights Analyst.

---

## What's in here

```
spice-route-ops/
├── server.js              Express app — API + static host
├── package.json           deps: express, compression
├── render.yaml            Render blueprint (optional one-click deploy)
├── public/                the dashboard
│   ├── index.html         markup shell
│   ├── styles.css         all styling (Calibri, with Carlito fallback)
│   └── app.js             data model, aggregation, charts, drill-down
├── data/
│   ├── dashboard.json     compact extract the dashboard runs on (537 KB)
│   └── metrics.json       aggregates behind the monthly report
├── reports/
│   ├── ...Review-Aug-2026.pdf
│   └── ...Review-Aug-2026.docx
└── etl/                   regenerates everything from the raw CSVs
    ├── build.py           CSVs  → dashboard.json + metrics.json
    ├── charts.py          metrics → report chart PNGs
    ├── report.py          → the PDF
    ├── make_docx.js       → the Word version
    └── data/              the 6 source CSVs
```

**Where the work actually is:** all filtering and aggregation happens in
`public/app.js`, client-side. The server ships one cached payload rather than
running a query per filter change, so changing the date range or area manager is
instant and the free Render instance stays idle. `etl/build.py` documents every
modelling decision in its docstring.

---

## Run it locally

```bash
npm install
npm start
# http://localhost:3000
```

Node 18+ required (20.x recommended).

---

## Deploy to Render

### Option A — Blueprint (uses `render.yaml`)

1. Push this folder to a GitHub repo.
2. Render Dashboard → **New +** → **Blueprint**.
3. Pick the repo. Render reads `render.yaml` and creates the service.
4. **Apply**. First build takes about two minutes.

### Option B — Manual web service

1. Push to GitHub.
2. Render Dashboard → **New +** → **Web Service** → connect the repo.
3. Set:

   | Field | Value |
   |---|---|
   | Runtime | Node |
   | Region | Singapore |
   | Build command | `npm ci --omit=dev` |
   | Start command | `npm start` |
   | Health check path | `/api/health` |
   | Instance type | Free |

4. Add one environment variable: `NODE_VERSION` = `20.11.1`.
5. **Create Web Service**.

Do **not** set `PORT` yourself — Render injects it and `server.js` reads it.

### After it's live

Confirm the deploy:

```bash
curl https://<your-service>.onrender.com/api/health
```

Then update the dashboard link inside the monthly report so it points at the
live URL: edit `DASH` at the top of `etl/report.py`, then `npm run report`.

**Free tier note:** the instance sleeps after 15 minutes idle and takes ~30
seconds to wake. Fine for a review link; if area managers will open it daily,
the Starter plan removes the spin-down.

---

## API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | status, data window, row counts, uptime |
| `GET /api/dashboard.js` | the extract as `window.__SPICE_DATA__` (what the page loads) |
| `GET /api/dashboard` | the same payload as plain JSON |
| `GET /api/metrics` | aggregates behind the monthly report |
| `GET /api/outlets?am=&state=` | outlet directory, filterable |
| `GET /api/outlets/:id/scorecard` | one outlet's full-window scorecard |
| `GET /api/tickets?status=&priority=&outlet=&overdueOnly=true` | filtered tickets |
| `GET /api/report/pdf` · `/api/report/docx` | the latest monthly report |

Responses are gzipped — the 537 KB extract goes over the wire at about 65 KB.

Examples:

```bash
curl "https://<host>/api/tickets?priority=High&overdueOnly=true"
curl "https://<host>/api/outlets?am=Priya%20Nair"
curl "https://<host>/api/outlets/14/scorecard"
```

---

## Refreshing the data

The extract is a build artefact, not a live database connection. When new
Linemate CSVs arrive:

```bash
# 1. drop the 6 new CSVs into etl/data/
cd etl
python3 build.py                       # writes out/data.json + out/metrics.json
cp out/data.json ../data/dashboard.json
cp out/metrics.json ../data/

# 2. regenerate the monthly report
python3 charts.py && python3 report.py && node make_docx.js
cp out/Spice-Route-Monthly-Ops-Review-*.pdf  ../reports/
cp out/Spice-Route-Monthly-Ops-Review-*.docx ../reports/

# 3. ship it
cd .. && git add -A && git commit -m "data refresh" && git push
```

Render auto-deploys on push. Python needs `pandas`, `numpy`, `matplotlib`;
the Word step needs the `docx` npm package.

To automate the monthly cadence, add a Render Cron Job on `0 3 1 * *` running
the ETL and committing the result — the report is designed to be reproducible
without anyone editing prose.

---

## Notes

- Fonts load Calibri from the OS and fall back to Carlito (metric-compatible)
  via Google Fonts, so Mac and Linux render identically to Windows.
- The dashboard needs JavaScript. It shows an explicit message rather than a
  blank page if the data payload fails to load.
- No database and no credentials — the extract is a static artefact, so there is
  nothing to secure beyond the hosting itself. If this went past a pilot, the
  next step would be reading Linemate's API directly and adding auth in front of
  `/api`.
