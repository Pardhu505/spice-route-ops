"""
Spice Route Kitchens x Linemate  --  analytics build
====================================================
Reads the 6 raw CSVs and produces:
  out/data.json        compact dataset powering the Area Manager dashboard
  out/metrics.json     aggregated metrics powering the VP monthly report
  out/*.csv            tidy analytical tables (audit trail / re-use)

Modelling decisions (documented, not hidden):
  * Outlet is only on users.csv -> every fact is attributed to an outlet by
    joining through the user who created it (submitter for submissions,
    raiser for tickets; `assigned_to` is unusable for this because Area
    Managers hold tickets and have no outlet).
  * Window = first to last submission in the data: 2026-05-19 .. 2026-08-17
    = 91 days = exactly 13 weeks. All 20 outlets are active for the whole
    window (verified), so expectations apply uniformly.
  * Expected volumes:  Opening 1/outlet/day, Closing 1/outlet/day,
    Hygiene audit 1/outlet/week. Kitchen Equipment Audit and Store Issue
    Report are ad hoc -> never counted as "missed".
  * Periods: three comparable 28-day blocks ending on the last data day,
    so the "monthly" report always compares like with like.
"""

import json
import os
from datetime import timedelta

import numpy as np
import pandas as pd

SRC = "data"
OUT = "out"
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- load ----
outlets = pd.read_csv(f"{SRC}/outlets.csv")
users = pd.read_csv(f"{SRC}/users.csv")
form = pd.read_csv(f"{SRC}/form.csv")
subs = pd.read_csv(f"{SRC}/form_submissions.csv")
details = pd.read_csv(f"{SRC}/form_details.csv")
tickets = pd.read_csv(f"{SRC}/tickets.csv")

subs["submitted_at"] = pd.to_datetime(subs["submitted_at"])
for c in ["raised_on", "due_date", "closed_at"]:
    tickets[c] = pd.to_datetime(tickets[c])

# ------------------------------------------------------- org hierarchy ----
# Store Managers report to Area Managers -> that is how an outlet gets an
# Area Manager. Area Managers themselves carry no outlet_id.
sm = users[(users.role == "Store Manager") & users.outlet_id.notna()]
outlet_am = (
    sm[["outlet_id", "reporting_manager_id", "user_id", "name"]]
    .rename(columns={"reporting_manager_id": "am_id",
                     "user_id": "sm_id", "name": "store_manager"})
)
am_names = users.set_index("user_id")["name"]
outlet_am["area_manager"] = outlet_am.am_id.map(am_names)
outlet_am["outlet_id"] = outlet_am.outlet_id.astype(int)

outlets = outlets.merge(outlet_am, on="outlet_id", how="left")

user_outlet = users.set_index("user_id")["outlet_id"]
user_name = users.set_index("user_id")["name"]
user_role = users.set_index("user_id")["role"]

# ------------------------------------------------------------- window ----
START = subs.submitted_at.min().normalize()
END = subs.submitted_at.max().normalize()
DAYS = (END - START).days + 1                     # 91
WEEKS = DAYS // 7                                 # 13
calendar = pd.date_range(START, END, freq="D")

# three comparable 28-day periods, most recent last
P_LEN = 28
periods = []
for i in range(3):
    p_end = END - timedelta(days=P_LEN * i)
    p_start = p_end - timedelta(days=P_LEN - 1)
    periods.append((p_start, p_end))
periods = periods[::-1]                            # oldest -> newest
PERIOD_LABELS = [f"{s:%d %b} – {e:%d %b}" for s, e in periods]

FORM_META = {
    101: ("Opening Checklist", "daily_checklist", "daily"),
    102: ("Closing Checklist", "daily_checklist", "daily"),
    103: ("Hygiene & Food Safety Audit", "audit_checklist", "weekly"),
    104: ("Kitchen Equipment Audit", "audit_checklist", "adhoc"),
    105: ("Store Issue Report", "issue_reporting", "adhoc"),
}

# ------------------------------------------------- submission fact table --
s = subs.copy()
s["outlet_id"] = s.user_id.map(user_outlet)
assert s.outlet_id.notna().all(), "every submission must resolve to an outlet"
s["outlet_id"] = s.outlet_id.astype(int)
s["date"] = s.submitted_at.dt.normalize()
s["hour"] = s.submitted_at.dt.hour + s.submitted_at.dt.minute / 60
s["dow"] = s.submitted_at.dt.dayofweek
s["week"] = ((s.date - START).dt.days // 7).astype(int)
s["submitter"] = s.user_id.map(user_name)
s["submitter_role"] = s.user_id.map(user_role)
s["form_name"] = s.form_id.map(lambda f: FORM_META[f][0])
s["form_type"] = s.form_id.map(lambda f: FORM_META[f][1])
s = s.merge(outlets[["outlet_id", "outlet_name", "city", "state",
                     "area_manager", "store_manager"]], on="outlet_id")
s["scored"] = s.compliance_pct.notna()
s["below_threshold"] = np.where(
    s.scored, s.compliance_pct < s.compliance_threshold, np.nan)

# late-open flag: opening checklist filed after 09:00
s["late_open"] = np.where((s.form_id == 101) & (s.hour >= 9), 1, 0)

# ------------------------------------------------ expected vs. actual -----
# daily forms
grid_daily = pd.MultiIndex.from_product(
    [outlets.outlet_id, calendar, [101, 102]],
    names=["outlet_id", "date", "form_id"]).to_frame(index=False)
actual_daily = (s[s.form_id.isin([101, 102])]
                .groupby(["outlet_id", "date", "form_id"])
                .size().rename("n").reset_index())
cov_daily = grid_daily.merge(actual_daily, how="left").fillna({"n": 0})
cov_daily["done"] = (cov_daily.n > 0).astype(int)

# weekly audit
grid_week = pd.MultiIndex.from_product(
    [outlets.outlet_id, range(WEEKS)],
    names=["outlet_id", "week"]).to_frame(index=False)
actual_week = (s[s.form_id == 103].groupby(["outlet_id", "week"])
               .size().rename("n").reset_index())
cov_week = grid_week.merge(actual_week, how="left").fillna({"n": 0})
cov_week["done"] = (cov_week.n > 0).astype(int)

# ----------------------------------------------------- tickets fact -------
t = tickets.copy()
t["outlet_id"] = t.raised_by.map(user_outlet).astype(int)
t = t.merge(outlets[["outlet_id", "outlet_name", "city", "state",
                     "area_manager"]], on="outlet_id")
t["raised_by_name"] = t.raised_by.map(user_name)
t["assigned_to_name"] = t.assigned_to.map(user_name)
t["assigned_role"] = t.assigned_to.map(user_role)
t["date"] = t.raised_on.dt.normalize()
t["sla_hours"] = (t.due_date - t.raised_on).dt.total_seconds() / 3600
t["resolution_hours"] = (t.closed_at - t.raised_on).dt.total_seconds() / 3600
t["is_open"] = t.status.isin(["Open", "Escalated"])
AS_OF = END + timedelta(days=1)                    # end of last data day
t["age_hours"] = np.where(
    t.is_open, (AS_OF - t.raised_on).dt.total_seconds() / 3600,
    t.resolution_hours)
t["age_days"] = t.age_hours / 24
t["breached"] = np.where(
    t.is_open, t.due_date < AS_OF, t.closed_at > t.due_date)
t["from_submission"] = t.source_submission_id.notna()

# ------------------------------------------------- answer-level facts -----
d = details.merge(form, on="question_id", how="left")
d = d.merge(s[["submission_id", "outlet_id", "date", "week"]],
            on="submission_id", how="left")
yn = d[d.question_type == "yes_no"].copy()
yn["failed"] = (yn.answer == "No").astype(int)

q_fail = (yn.groupby(["form_id", "form_name", "section_name",
                      "question_id", "question_text"])
          .agg(asked=("failed", "size"), failed=("failed", "sum"))
          .reset_index())
q_fail["fail_pct"] = (q_fail.failed / q_fail.asked * 100).round(1)
q_fail = q_fail.sort_values("fail_pct", ascending=False)

# issue reports (form 105) pivoted to one row per submission
issue_q = {45: "issue_type", 46: "severity", 47: "description",
           48: "photo_attached"}
iss = (d[d.question_id.isin(issue_q)]
       .assign(k=lambda x: x.question_id.map(issue_q))
       .pivot_table(index="submission_id", columns="k", values="answer",
                    aggfunc="first").reset_index())
iss = iss.merge(s[["submission_id", "outlet_id", "outlet_name", "city",
                   "area_manager", "date", "submitted_at", "submitter"]],
                on="submission_id")
tick_by_sub = (t[t.source_submission_id.notna()]
               .drop_duplicates("source_submission_id")
               .set_index("source_submission_id"))
iss["ticket_id"] = iss.submission_id.map(tick_by_sub["ticket_id"])
iss["ticket_status"] = iss.submission_id.map(tick_by_sub["status"])
iss["has_ticket"] = iss.ticket_id.notna()

# ratings
rat = d[d.question_type == "rating"].copy()
rat["rating"] = pd.to_numeric(rat.answer, errors="coerce")

# ------------------------------------------------------ helper: slice -----
def window_mask(frame, col, start, end):
    return (frame[col] >= start) & (frame[col] <= end)


def outlet_scorecard(start, end):
    """Full per-outlet scorecard for an arbitrary date window."""
    ss = s[window_mask(s, "date", start, end)]
    cd = cov_daily[window_mask(cov_daily, "date", start, end)]
    wk_lo = int((start - START).days // 7)
    wk_hi = int((end - START).days // 7)
    cw = cov_week[(cov_week.week >= wk_lo) & (cov_week.week <= wk_hi)]
    tt = t[window_mask(t, "date", start, end)]

    rows = []
    for _, o in outlets.iterrows():
        oid = o.outlet_id
        so = ss[ss.outlet_id == oid]
        cdo = cd[cd.outlet_id == oid]
        cwo = cw[cw.outlet_id == oid]
        to = tt[tt.outlet_id == oid]
        scored = so[so.scored]
        opening = cdo[cdo.form_id == 101]
        closing = cdo[cdo.form_id == 102]
        yno = yn[(yn.outlet_id == oid) & window_mask(yn, "date", start, end)]
        rows.append(dict(
            outlet_id=int(oid), outlet=o.outlet_name, city=o.city,
            state=o.state, area_manager=o.area_manager,
            store_manager=o.store_manager,
            expected=int(len(cdo)), submitted=int(cdo.done.sum()),
            completion=round(cdo.done.mean() * 100, 1) if len(cdo) else None,
            opening_pct=round(opening.done.mean() * 100, 1) if len(opening) else None,
            closing_pct=round(closing.done.mean() * 100, 1) if len(closing) else None,
            audit_expected=int(len(cwo)), audit_done=int(cwo.done.sum()),
            audit_pct=round(cwo.done.mean() * 100, 1) if len(cwo) else None,
            compliance=round(scored.compliance_pct.mean(), 1) if len(scored) else None,
            below_thresh=int(scored.below_threshold.sum()) if len(scored) else 0,
            below_thresh_pct=round(scored.below_threshold.mean() * 100, 1) if len(scored) else None,
            fail_pct=round(yno.failed.mean() * 100, 1) if len(yno) else None,
            late_opens=int(so.late_open.sum()),
            issues=int((so.form_id == 105).sum()),
            tickets=int(len(to)),
            open_tickets=int(to.is_open.sum()),
            overdue=int((to.is_open & to.breached).sum()),
            escalated=int((to.status == "Escalated").sum()),
            breach_closed=int((~to.is_open & to.breached).sum()),
            median_res_h=round(to.loc[~to.is_open, "resolution_hours"].median(), 1)
            if (~to.is_open).sum() else None,
        ))
    return pd.DataFrame(rows)


full_card = outlet_scorecard(START, END)
period_cards = {lbl: outlet_scorecard(a, b)
                for lbl, (a, b) in zip(PERIOD_LABELS, periods)}

# ------------------------------------------------------- risk scoring -----
# A single, explainable 0-100 "Ops Health" score covering what the STORE
# controls: did the routine happen (50) and was it done properly (50).
# The ticket backlog is deliberately excluded -- 79 of 83 open tickets are
# already overdue chain-wide, so it is an area-manager/process problem and
# folding it in would only blur the store-to-store signal. It is shown as
# its own column instead.
def health(df):
    comp = df.completion.fillna(0) / 100
    aud = df.audit_pct.fillna(0) / 100
    quality = df.compliance.fillna(0) / 100
    fails = 1 - (df.fail_pct.fillna(0) / 100)
    return (comp * 35 + aud * 15 + quality * 30 + fails * 20).round(1)


full_card["health"] = health(full_card)
full_card["rank"] = full_card.health.rank(ascending=False, method="min").astype(int)
full_card["band"] = pd.cut(full_card.health, [-1, 70, 85, 101],
                           labels=["At risk", "Watch", "Healthy"])

# ---------------------------------------------------------- trends --------
def daily_trend():
    cd = cov_daily.groupby("date").done.mean().mul(100).round(1)
    sc = s[s.scored].groupby("date").compliance_pct.mean().round(1)
    tk = t.groupby("date").size()
    iss_d = s[s.form_id == 105].groupby("date").size()
    out = pd.DataFrame({"completion": cd, "compliance": sc,
                        "tickets": tk, "issues": iss_d}).reindex(calendar)
    out["tickets"] = out.tickets.fillna(0)
    out["issues"] = out.issues.fillna(0)
    return out.reset_index().rename(columns={"index": "date"})


trend = daily_trend()
trend["compliance_ma7"] = trend.compliance.rolling(7, min_periods=3).mean().round(1)
trend["completion_ma7"] = trend.completion.rolling(7, min_periods=3).mean().round(1)

weekly = pd.DataFrame({
    "week": range(WEEKS),
    "completion": [round(cov_daily[cov_daily.date.between(
        START + timedelta(days=7 * w), START + timedelta(days=7 * w + 6))]
        .done.mean() * 100, 1) for w in range(WEEKS)],
    "audit": [round(cov_week[cov_week.week == w].done.mean() * 100, 1)
              for w in range(WEEKS)],
    "compliance": [round(s[(s.scored) & (s.week == w)].compliance_pct.mean(), 1)
                   for w in range(WEEKS)],
    "tickets": [int((t.date.between(START + timedelta(days=7 * w),
                                    START + timedelta(days=7 * w + 6))).sum())
                for w in range(WEEKS)],
})
weekly["label"] = [f"{(START + timedelta(days=7*w)):%d %b}" for w in range(WEEKS)]

# ------------------------------------------------ question trend by period-
def q_fail_by_period(qids=None):
    rows = []
    for lbl, (a, b) in zip(PERIOD_LABELS, periods):
        w = yn[window_mask(yn, "date", a, b)]
        g = w.groupby(["question_id", "question_text", "form_name"]).failed.agg(
            ["size", "sum"])
        g["pct"] = (g["sum"] / g["size"] * 100).round(1)
        for (qid, qt, fn), r in g.iterrows():
            rows.append(dict(period=lbl, question_id=qid, question=qt,
                             form=fn, asked=int(r["size"]),
                             failed=int(r["sum"]), pct=r["pct"]))
    return pd.DataFrame(rows)


q_period = q_fail_by_period()

# ------------------------------------------------------------ exports -----
full_card.to_csv(f"{OUT}/outlet_scorecard_full.csv", index=False)
q_fail.to_csv(f"{OUT}/question_failure_rates.csv", index=False)
q_period.to_csv(f"{OUT}/question_failure_by_period.csv", index=False)
trend.to_csv(f"{OUT}/daily_trend.csv", index=False)
weekly.to_csv(f"{OUT}/weekly_trend.csv", index=False)
iss.to_csv(f"{OUT}/issue_reports.csv", index=False)
t.to_csv(f"{OUT}/tickets_enriched.csv", index=False)
s.to_csv(f"{OUT}/submissions_enriched.csv", index=False)
cov_daily.to_csv(f"{OUT}/coverage_daily.csv", index=False)

print("window:", START.date(), "->", END.date(), DAYS, "days /", WEEKS, "weeks")
print("periods:", PERIOD_LABELS)
print("\nchain completion daily forms: %.1f%%" % (cov_daily.done.mean() * 100))
print("chain audit completion: %.1f%%" % (cov_week.done.mean() * 100))
print("\ntop / bottom outlets by health:")
print(full_card.sort_values("health", ascending=False)
      [["outlet", "area_manager", "completion", "audit_pct", "compliance",
        "fail_pct", "overdue", "health", "band"]].to_string(index=False))


# ==========================================================================
#  EXPORT 1 — compact JSON for the Area Manager dashboard
#  The dashboard re-aggregates client-side so every filter/date range is live
#  rather than pre-baked.
# ==========================================================================
q_by_form = {}
for fid, grp in form.groupby("form_id"):
    q_by_form[int(fid)] = [
        dict(qid=int(r.question_id), section=r.section_name,
             text=r.question_text, type=r.question_type)
        for r in grp.sort_values("question_id").itertuples()
    ]

qorder = {fid: [q["qid"] for q in qs] for fid, qs in q_by_form.items()}

# answers packed in question order per submission
det = details.copy()
ans_by_sub = {}
sub_form = subs.set_index("submission_id")["form_id"].to_dict()
for sid, grp in det.groupby("submission_id"):
    fid = sub_form.get(sid)
    if fid is None:
        continue
    lookup = dict(zip(grp.question_id, grp.answer))
    ans_by_sub[int(sid)] = [
        (None if pd.isna(lookup.get(q)) else str(lookup.get(q)))
        for q in qorder[fid]
    ]

day_index = {d: i for i, d in enumerate(calendar)}


def bitstring(oid, fid):
    row = cov_daily[(cov_daily.outlet_id == oid) & (cov_daily.form_id == fid)]
    row = row.set_index("date").done.reindex(calendar).fillna(0).astype(int)
    return "".join(map(str, row.tolist()))


coverage = {}
for oid in outlets.outlet_id:
    wk = cov_week[cov_week.outlet_id == oid].set_index("week").done
    coverage[int(oid)] = {
        "open": bitstring(oid, 101),
        "close": bitstring(oid, 102),
        "audit": "".join(str(int(wk.get(w, 0))) for w in range(WEEKS)),
    }

dash = {
    "meta": {
        "client": "Spice Route Kitchens",
        "start": START.strftime("%Y-%m-%d"),
        "end": END.strftime("%Y-%m-%d"),
        "days": int(DAYS),
        "weeks": int(WEEKS),
        "generated": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M"),
    },
    "outlets": [
        dict(id=int(r.outlet_id), name=r.outlet_name, city=r.city,
             state=r.state, am=r.area_manager, sm=r.store_manager)
        for r in outlets.itertuples()
    ],
    "forms": {
        str(fid): dict(name=FORM_META[fid][0], type=FORM_META[fid][1],
                       cadence=FORM_META[fid][2], questions=q_by_form[fid])
        for fid in sorted(q_by_form)
    },
    "submissions": [
        [int(r.submission_id), int(r.outlet_id), int(r.form_id),
         r.submitted_at.strftime("%Y-%m-%d %H:%M"),
         r.submitter, r.submitter_role,
         (None if pd.isna(r.compliance_pct) else float(r.compliance_pct)),
         (None if pd.isna(r.compliance_threshold) else float(r.compliance_threshold))]
        for r in s.sort_values("submission_id").itertuples()
    ],
    "answers": ans_by_sub,
    "coverage": coverage,
    "tickets": [
        [r.ticket_id, int(r.outlet_id), r.title, r.category, r.status,
         r.priority, r.raised_by_name, r.assigned_to_name,
         r.raised_on.strftime("%Y-%m-%d %H:%M"),
         r.due_date.strftime("%Y-%m-%d %H:%M"),
         (None if pd.isna(r.closed_at) else r.closed_at.strftime("%Y-%m-%d %H:%M")),
         (None if pd.isna(r.source_submission_id) else int(r.source_submission_id))]
        for r in t.sort_values("ticket_id").itertuples()
    ],
}

with open(f"{OUT}/data.json", "w") as fh:
    json.dump(dash, fh, separators=(",", ":"))
print("data.json  %.1f MB" % (os.path.getsize(f"{OUT}/data.json") / 1e6))


# ==========================================================================
#  EXPORT 2 — aggregated metrics for the VP monthly report
# ==========================================================================
def period_metrics(a, b):
    ss = s[window_mask(s, "date", a, b)]
    cd = cov_daily[window_mask(cov_daily, "date", a, b)]
    wk_lo, wk_hi = int((a - START).days // 7), int((b - START).days // 7)
    cw = cov_week[(cov_week.week >= wk_lo) & (cov_week.week <= wk_hi)]
    tt = t[window_mask(t, "date", a, b)]
    ynp = yn[window_mask(yn, "date", a, b)]
    ip = iss[window_mask(iss, "date", a, b)]
    scored = ss[ss.scored]
    closed = tt[~tt.is_open]
    return dict(
        start=a.strftime("%d %b"), end=b.strftime("%d %b %Y"),
        completion=round(cd.done.mean() * 100, 1),
        opening=round(cd[cd.form_id == 101].done.mean() * 100, 1),
        closing=round(cd[cd.form_id == 102].done.mean() * 100, 1),
        missed=int((1 - cd.done).sum()),
        audit=round(cw.done.mean() * 100, 1),
        audit_missed=int((1 - cw.done).sum()),
        compliance=round(scored.compliance_pct.mean(), 1),
        below=round(scored.below_threshold.mean() * 100, 1),
        fail_rate=round(ynp.failed.mean() * 100, 1),
        submissions=int(len(ss)),
        issues=int(len(ip)),
        issue_no_ticket=int((~ip.has_ticket).sum()),
        high_issues=int((ip.severity == "High").sum()),
        tickets=int(len(tt)),
        closed=int(len(closed)),
        breach=round(tt.breached.mean() * 100, 1),
        high_breach=round(tt[tt.priority == "High"].breached.mean() * 100, 1)
        if (tt.priority == "High").any() else None,
        med_res=round(closed.resolution_hours.median(), 1) if len(closed) else None,
        escalated=int((tt.status == "Escalated").sum()),
        late_opens=int(ss.late_open.sum()),
    )


pm = [period_metrics(a, b) for a, b in periods]

# backlog snapshot at the end of the window
openq = t[t.is_open]
backlog = dict(
    total=int(len(openq)),
    overdue=int((openq.breached).sum()),
    escalated=int((openq.status == "Escalated").sum()),
    over_30d=int((openq.age_days > 30).sum()),
    median_age=round(openq.age_days.median(), 1),
    oldest=round(openq.age_days.max(), 1),
    by_bucket={
        "0-3 days": int(((openq.age_days <= 3)).sum()),
        "4-7 days": int(((openq.age_days > 3) & (openq.age_days <= 7)).sum()),
        "8-14 days": int(((openq.age_days > 7) & (openq.age_days <= 14)).sum()),
        "15-30 days": int(((openq.age_days > 14) & (openq.age_days <= 30)).sum()),
        "30+ days": int((openq.age_days > 30).sum()),
    },
    by_category=openq.category.value_counts().to_dict(),
)

sla = (t.groupby("priority")
       .agg(n=("ticket_id", "size"), sla_h=("sla_hours", "first"),
            med_res=("resolution_hours", "median"),
            breach=("breached", "mean"))
       .assign(breach=lambda x: (x.breach * 100).round(1),
               med_res=lambda x: x.med_res.round(1))
       .reset_index().to_dict("records"))

# recurring faults: same free-text issue, same outlet, reported again after
# the previous ticket had already been closed
iss_sorted = iss.sort_values(["outlet_id", "description", "submitted_at"])
tk_idx = t.set_index("ticket_id")
recur = []
for (oname, desc), g in iss_sorted.groupby(["outlet_name", "description"]):
    if len(g) < 2:
        continue
    g = g.sort_values("submitted_at")
    prev = None
    for _, r in g.iterrows():
        if prev is not None:
            closed_before = False
            if pd.notna(prev.ticket_id) and prev.ticket_id in tk_idx.index:
                ct = tk_idx.loc[prev.ticket_id, "closed_at"]
                closed_before = pd.notna(ct) and ct <= r.submitted_at
            recur.append(dict(outlet=oname, issue=desc,
                              gap_days=int((r.date - prev.date).days),
                              after_close=bool(closed_before)))
        prev = r
recur = pd.DataFrame(recur)

metrics = dict(
    window=dict(start=START.strftime("%d %b %Y"), end=END.strftime("%d %b %Y"),
                days=int(DAYS), weeks=int(WEEKS), outlets=int(len(outlets))),
    periods=pm,
    period_labels=PERIOD_LABELS,
    scorecard=full_card.replace({np.nan: None}).to_dict("records"),
    period_cards={k: v.replace({np.nan: None}).to_dict("records")
                  for k, v in period_cards.items()},
    weekly=weekly.replace({np.nan: None}).to_dict("records"),
    q_fail=q_fail.head(12).to_dict("records"),
    q_period=q_period.to_dict("records"),
    sla=sla,
    backlog=backlog,
    issues=dict(
        total=int(len(iss)),
        converted=int(iss.has_ticket.sum()),
        conversion=round(iss.has_ticket.mean() * 100, 1),
        high_no_ticket=int(((iss.severity == "High") & (~iss.has_ticket)).sum()),
        no_photo=round((iss.photo_attached == "No").mean() * 100, 1),
        by_type=iss.issue_type.value_counts().to_dict(),
        by_severity=iss.severity.value_counts().to_dict(),
        top_text=iss.description.value_counts().head(10).to_dict(),
    ),
    recurrence=dict(
        events=int(len(recur)),
        after_close=int(recur.after_close.sum()),
        outlets=int(recur.outlet.nunique()),
        median_gap=float(recur.gap_days.median()),
        top=recur.groupby(["outlet", "issue"]).size()
             .sort_values(ascending=False).head(8)
             .reset_index().rename(columns={0: "times"}).to_dict("records"),
    ),
    value=dict(
        submissions=int(len(s)),
        answers=int(len(details)),
        issues_surfaced=int(len(iss)),
        tickets=int(len(t)),
        tickets_closed=int((~t.is_open).sum()),
        checks_failed=int(yn.failed.sum()),
        high_sev_caught=int((iss.severity == "High").sum()),
        audit_hours_saved=None,
    ),
)


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return o.strftime("%Y-%m-%d")
    if o is pd.NaT:
        return None
    return o


with open(f"{OUT}/metrics.json", "w") as fh:
    json.dump(clean(metrics), fh, indent=1)
print("metrics.json written")
print("\nperiod-over-period:")
print(pd.DataFrame(pm)[["start", "end", "completion", "audit", "compliance",
                        "fail_rate", "tickets", "breach", "escalated",
                        "issue_no_ticket"]].to_string(index=False))
print("\nbacklog:", backlog["total"], "open,", backlog["overdue"], "overdue,",
      backlog["over_30d"], ">30d, median age", backlog["median_age"], "d")
print("recurrence:", recur.after_close.sum(), "of", len(recur),
      "repeats came back after the prior ticket was closed")
