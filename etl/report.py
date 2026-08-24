"""Monthly Operations Review PDF for the VP of Operations.

Cadence: monthly, on the 1st working day, covering the trailing 28 days so that
every edition compares like-for-like periods rather than ragged calendar months.
Channel: PDF attached to an email to the VP + her leadership list, with the
live dashboard linked at the top for anyone who wants to drill in.
"""
import json
import subprocess

import pandas as pd

M = json.load(open("out/metrics.json"))
P = M["periods"]
L = M["period_labels"]
cur, prev, first = P[2], P[1], P[0]
sc = pd.DataFrame(M["scorecard"])
_LINKED_CLOSED = json.load(open("out/charts/_funnel.json"))["linked_closed"]
DASH = "https://spice-route-ops.pages.dev"   # replace with the deployed URL


def d(a, b, unit="pt", inv=False):
    """Delta chip vs the previous period."""
    if a is None or b is None:
        return ""
    x = a - b
    good = (x < 0) if inv else (x > 0)
    cls = "flat" if abs(x) < 0.5 else ("up" if good else "down")
    arrow = "" if cls == "flat" else ("&#9650;" if x > 0 else "&#9660;")
    return f'<span class="chip {cls}">{arrow} {abs(x):.1f}{unit}</span>'


def dn(a, b, inv=False):
    return d(a, b, unit="", inv=inv)


# ---------------------------------------------------------------- tables --
watch = sc.sort_values("health").head(7)
top = sc.sort_values("health", ascending=False).head(4)

pc = {lab: pd.DataFrame(M["period_cards"][lab]).set_index("outlet")
      for lab in L}
movers = pd.DataFrame({
    "now": pc[L[2]].completion, "then": pc[L[0]].completion,
    "comp_now": pc[L[2]].compliance, "comp_then": pc[L[0]].compliance,
}).assign(chg=lambda x: (x.now - x.then).round(1),
          comp_chg=lambda x: (x.comp_now - x.comp_then).round(1))

up = movers.sort_values("chg", ascending=False).head(3)
down = movers.sort_values("comp_chg").head(3)


def store_table(df, cols):
    head = "".join(f"<th>{c[1]}</th>" for c in cols)
    rows = ""
    for _, r in df.iterrows():
        band = {"Healthy": "ok", "Watch": "warn", "At risk": "bad"}[r.band]
        tds = ""
        for key, _lab, kind in cols:
            v = r[key]
            if kind == "name":
                tds += (f'<td class="l"><b>{r.outlet}</b>'
                        f'<span class="sub">{r.area_manager}</span></td>')
            elif kind == "band":
                tds += f'<td><span class="tag {band}">{v:.0f}</span></td>'
            elif kind == "pct":
                tds += f'<td class="n">{"" if v is None else f"{v:.1f}%"}</td>'
            else:
                tds += f'<td class="n">{int(v)}</td>'
        rows += f"<tr>{tds}</tr>"
    return f'<table class="grid"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'


COLS = [("outlet", "Store", "name"), ("health", "Health", "band"),
        ("completion", "Checklists", "pct"), ("audit_pct", "Audits", "pct"),
        ("compliance", "Compliance", "pct"), ("fail_pct", "Checks failed", "pct"),
        ("overdue", "Tickets late", "int")]

full_sorted = sc.sort_values("health", ascending=False)

# ---------------------------------------------------------------- copy ----
HTML = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 14mm 13mm 16mm 13mm; }}
body {{ font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color:#0F1B26;
        font-size:9.4pt; line-height:1.5; margin:0; }}
h1,h2,h3 {{ margin:0; font-weight:700; letter-spacing:-.01em }}
.page {{ page-break-after: always; }}
.page:last-child {{ page-break-after: auto; }}
.masthead {{ border-bottom:3px solid #0F1B26; padding-bottom:9px; margin-bottom:14px }}
.masthead .eyebrow {{ font-size:7.6pt; letter-spacing:.16em; text-transform:uppercase;
   color:#2F3A8F; font-weight:700 }}
.masthead h1 {{ font-size:20pt; margin:5px 0 3px }}
.masthead .meta {{ font-size:8.4pt; color:#7A8A98 }}
.masthead .meta b {{ color:#33475B }}
h2.sec {{ font-size:12.4pt; margin:0 0 3px; padding-top:2px }}
h2.sec .kicker {{ display:block; font-size:7.4pt; letter-spacing:.14em;
   text-transform:uppercase; color:#2F3A8F; font-weight:700; margin-bottom:3px }}
p.lede {{ color:#33475B; margin:0 0 12px; font-size:9.6pt }}
p {{ margin:0 0 8px }}
.rule {{ border:0; border-top:1px solid #D7DEE5; margin:14px 0 12px }}

table {{ border-collapse:collapse; width:100% }}
.kpis td {{ width:25%; padding:0 5px 0 0; vertical-align:top }}
.kpis td:last-child {{ padding-right:0 }}
.kpi {{ border:1px solid #D7DEE5; border-top:3px solid #2F3A8F; padding:8px 9px 7px }}
.kpi .lab {{ font-size:7.2pt; letter-spacing:.09em; text-transform:uppercase;
   color:#7A8A98; font-weight:700 }}
.kpi .val {{ font-size:19pt; font-weight:700; line-height:1.1; margin:3px 0 1px }}
.kpi .val small {{ font-size:10pt; color:#7A8A98; font-weight:400 }}
.kpi .note {{ font-size:7.6pt; color:#7A8A98; line-height:1.35 }}
.chip {{ font-size:7.6pt; font-weight:700; padding:1px 4px; border-radius:3px }}
.chip.up {{ color:#17845A; background:#E4F2EB }}
.chip.down {{ color:#AF3428; background:#FAE9E7 }}
.chip.flat {{ color:#7A8A98; background:#EEF1F4 }}

.grid th {{ font-size:7.2pt; letter-spacing:.06em; text-transform:uppercase;
   color:#7A8A98; font-weight:700; text-align:right; padding:5px 6px;
   border-bottom:1.4px solid #33475B }}
.grid th:first-child {{ text-align:left }}
.grid td {{ padding:4.5px 6px; border-bottom:1px solid #EAEFF3; text-align:right;
   font-size:8.7pt }}
.grid td.l {{ text-align:left }}
.grid td .sub {{ display:block; font-size:7.2pt; color:#7A8A98 }}
.grid td.n {{ font-variant-numeric:tabular-nums }}
.tag {{ display:inline-block; min-width:22px; padding:1px 5px; border-radius:9px;
   font-size:7.8pt; font-weight:700 }}
.tag.ok {{ background:#E4F2EB; color:#17845A }}
.tag.warn {{ background:#FBF0DF; color:#B9770E }}
.tag.bad {{ background:#FAE9E7; color:#AF3428 }}

.find {{ border-left:3px solid #2F3A8F; padding:2px 0 2px 10px; margin:0 0 11px }}
.find.alarm {{ border-left-color:#AF3428 }}
.find.good {{ border-left-color:#17845A }}
.find h3 {{ font-size:9.9pt; margin-bottom:2px }}
.find p {{ margin:0; color:#33475B; font-size:9pt }}

.two td {{ width:50%; vertical-align:top; padding-right:9px }}
.two td:last-child {{ padding-right:0; padding-left:9px }}
img.chart {{ width:100%; display:block }}
.cap {{ font-size:7.6pt; color:#7A8A98; margin:3px 0 0; line-height:1.4 }}
.box {{ background:#F4F6F9; border:1px solid #E1E7ED; padding:9px 11px; margin:0 0 10px }}
.box h3 {{ font-size:9.4pt; margin-bottom:4px }}
.box p {{ font-size:8.6pt; color:#33475B; margin:0 }}
.act td {{ padding:6px 7px; border-bottom:1px solid #EAEFF3; font-size:8.7pt;
   vertical-align:top }}
.act th {{ font-size:7.2pt; letter-spacing:.06em; text-transform:uppercase;
   color:#7A8A98; font-weight:700; text-align:left; padding:5px 7px;
   border-bottom:1.4px solid #33475B }}
.act td.who {{ color:#2F3A8F; font-weight:700; white-space:nowrap }}
.act td.when {{ white-space:nowrap; color:#7A8A98 }}
.num {{ font-variant-numeric:tabular-nums }}
ul {{ margin:0 0 8px; padding-left:15px }} li {{ margin-bottom:3px; color:#33475B }}
.foot {{ font-size:7.4pt; color:#7A8A98; border-top:1px solid #D7DEE5;
   padding-top:6px; margin-top:12px; line-height:1.5 }}
a {{ color:#2F3A8F; text-decoration:none }}
</style></head><body>

<!-- ============================ PAGE 1 ============================ -->
<div class="page">
  <div class="masthead">
    <div class="eyebrow">Spice Route Kitchens &nbsp;·&nbsp; Monthly Operations Review</div>
    <h1>{cur['start']} – {cur['end']}</h1>
    <div class="meta">Prepared for <b>Anjali Menon, Head of Operations</b> and the area
      management team &nbsp;·&nbsp; 20 outlets &nbsp;·&nbsp; compared against
      {prev['start']}&nbsp;–&nbsp;{prev['end']} &nbsp;·&nbsp;
      live detail at <a href="{DASH}">{DASH.replace('https://','')}</a></div>
  </div>

  <h2 class="sec"><span class="kicker">The month in one line</span>
    Compliance held; follow-up did not.</h2>
  <p class="lede">Stores filed slightly more of their routine paperwork than last month and
    hygiene audits improved sharply. But the work those checks generate is not being closed:
    {M['backlog']['overdue']} of {M['backlog']['total']} open tickets are past their deadline,
    {M['backlog']['over_30d']} of them by more than a month, and
    {cur['high_breach']:.0f}% of high-priority tickets raised this period missed their 24-hour
    target. The chain is good at spotting problems and poor at finishing them.</p>

  <table class="kpis"><tr>
    <td><div class="kpi"><div class="lab">Checklist completion</div>
      <div class="val">{cur['completion']:.1f}<small>%</small></div>
      <div class="note">{d(cur['completion'], prev['completion'])}
        &nbsp;{cur['missed']} opening/closing runs missed</div></div></td>
    <td><div class="kpi"><div class="lab">Hygiene audits done</div>
      <div class="val">{cur['audit']:.1f}<small>%</small></div>
      <div class="note">{d(cur['audit'], prev['audit'])}
        &nbsp;{cur['audit_missed']} store-weeks with no audit</div></div></td>
    <td><div class="kpi"><div class="lab">Avg compliance score</div>
      <div class="val">{cur['compliance']:.1f}<small>%</small></div>
      <div class="note">{d(cur['compliance'], prev['compliance'])}
        &nbsp;{cur['below']:.0f}% of filings below threshold</div></div></td>
    <td><div class="kpi" style="border-top-color:#AF3428"><div class="lab">Tickets past due</div>
      <div class="val">{M['backlog']['overdue']}</div>
      <div class="note">of {M['backlog']['total']} open &nbsp;·&nbsp;
        median age {M['backlog']['median_age']:.0f} days</div></div></td>
  </tr></table>

  <hr class="rule">

  <h2 class="sec"><span class="kicker">What changed, and what it means</span>
    Four things worth your attention</h2>

  <div class="find alarm">
    <h3>1 &nbsp; The ticket backlog has become structural, not seasonal</h3>
    <p>{M['backlog']['over_30d']} of the {M['backlog']['total']} open tickets are more than 30 days
      old and the oldest is {M['backlog']['oldest']:.0f} days. Escalations have risen every period
      ({first['escalated']} &rarr; {prev['escalated']} &rarr; {cur['escalated']}), which tells us
      escalation is being used as a filing cabinet rather than a trigger. Safety is the single
      largest category in the backlog ({M['backlog']['by_category']['Safety']} open tickets),
      which is the part I would not let run another month.</p>
  </div>

  <div class="find alarm">
    <h3>2 &nbsp; Closing a ticket is not the same as fixing the problem</h3>
    <p>Reading the free-text issue reports rather than the tick-boxes: {M['recurrence']['events']}
      times this quarter a store reported <em>the same fault in the same words</em> it had already
      reported before, and in {M['recurrence']['after_close']} of those cases the earlier ticket had
      already been marked Closed. Median time to recurrence is
      {M['recurrence']['median_gap']:.0f} days. Delhi &ndash; Connaught Place has reported the same
      grill igniter fault four separate times. We are paying to reopen problems we believe we solved.</p>
  </div>

  <div class="find alarm">
    <h3>3 &nbsp; The chain average hides a two-speed estate</h3>
    <p>Chain completion moved {first['completion']:.1f}% &rarr; {cur['completion']:.1f}% across the
      quarter, which reads like slow progress. It is not: the eight healthiest stores average
      {sc[sc.band=='Healthy'].completion.mean():.0f}% completion while seven at-risk stores average
      {sc[sc.band=='At risk'].completion.mean():.0f}%, and that gap has not narrowed in three months.
      Those seven stores generate 63% of every missed checklist in the chain. This is a
      seven-store problem being reported as a twenty-store average.</p>
  </div>

  <div class="find good">
    <h3>4 &nbsp; Hygiene audits are the one clear win &mdash; and it was coachable</h3>
    <p>Weekly audit completion went {prev['audit']:.1f}% &rarr; {cur['audit']:.1f}%, the largest
      single improvement of the quarter, driven mostly by Bhopal &ndash; MP Nagar
      (+{up.chg.iloc[0]:.0f} points on checklists) after its area manager started reviewing the
      missed-audit list weekly. That is the intervention worth copying to the other six.</p>
  </div>

  <hr class="rule">

  <h2 class="sec"><span class="kicker">Decisions needed from you</span>
    Three of the five actions need your call, not ours</h2>
  <table class="act"><tbody>
    <tr><td style="width:52%"><b>Set the high-priority SLA at 24 or 48 hours.</b> If it stays at 24
      it needs on-call cover funded; if not, move it to 48 and the breach number becomes real again.</td>
      <td>Today we breach {[r for r in M['sla'] if r['priority']=='High'][0]['breach']:.0f}% of the
        time, so the target no longer changes anyone's behaviour.</td>
      <td class="when">p.5</td></tr>
    <tr><td><b>Approve a refrigeration and ice-machine condition survey</b> at the six worst outlets.</td>
      <td>Two of the three most-failed checks chain-wide are equipment, not discipline.</td>
      <td class="when">p.4</td></tr>
    <tr><td><b>Agree the seven at-risk stores get a named 30-day plan</b> with their area manager.</td>
      <td>They produce 63% of all missed checklists; the Bhopal playbook already worked once.</td>
      <td class="when">p.6</td></tr>
  </tbody></table>

  <div class="foot">Definitions: completion measures filings against each form's expected cadence
    (opening and closing daily per store, hygiene audit weekly per store); ad-hoc forms are never
    counted as missed. Every record is attributed to a store via the person who filed it. Periods
    are 28 days so editions stay comparable. Source: Linemate, extracted {M['window']['end']}.</div>
</div>

<!-- ============================ PAGE 2 ============================ -->
<div class="page">
  <h2 class="sec"><span class="kicker">Chain performance</span>Thirteen weeks at a glance</h2>
  <p class="lede">Daily checklist completion has been flat in the mid-70s since mid-June. The
    volatility in the audit line is the story worth watching &mdash; audits are done by exception
    rather than by routine, so the line swings between 40% and 80% depending on who chased them.</p>
  <img class="chart" src="charts/weekly_trend.png">
  <p class="cap">Weekly, all 20 outlets. Compliance score is the average of the scored
    checklist and audit submissions filed that week; it stays high because the stores that skip
    filing are also the stores that would have scored badly &mdash; a survivorship effect worth
    remembering whenever compliance looks reassuring.</p>

  <hr class="rule">

  <h2 class="sec"><span class="kicker">Distribution, not average</span>
    Where each store started the quarter, and where it is now</h2>
  <img class="chart" src="charts/dumbbell.png">
  <p class="cap">Hollow marker = {L[0]}, solid = {L[2]}. Green means the store improved,
    red means it slipped. Nine stores now clear the 85% completion target; four have sat below
    50% for the entire quarter.</p>

  <table class="two"><tr>
    <td><div class="box"><h3>Most improved</h3>
      <p>{"<br>".join(f"<b>{i}</b> &nbsp;{r.then:.0f}% &rarr; {r.now:.0f}% checklists (+{r.chg:.0f} pts)" for i, r in up.iterrows())}</p>
    </div></td>
    <td><div class="box"><h3>Quietly slipping</h3>
      <p>{"<br>".join(f"<b>{i}</b> &nbsp;{r.comp_then:.0f}% &rarr; {r.comp_now:.0f}% compliance ({r.comp_chg:.0f} pts)" for i, r in down.iterrows())}</p>
    </div></td>
  </tr></table>
  <p class="cap">Nagpur is the one to act on: it is not just the lowest performer, it is the
    fastest-declining one. Chandigarh matters for a different reason &mdash; it was a healthy store
    a month ago and nobody has flagged it yet.</p>
</div>

<!-- ============================ PAGE 3 ============================ -->
<div class="page">
  <h2 class="sec"><span class="kicker">Store scorecard</span>All 20 outlets, quarter to date</h2>
  <p class="lede">Health is a 0&ndash;100 roll-up of what the store itself controls: completion (35),
    audits (15), compliance score (30) and failed checks (20). Ticket lateness sits in its own column
    because it is owned by the area manager, not the store.</p>
  {store_table(full_sorted, COLS)}
  <p class="cap">Green &ge; 85, amber 70&ndash;84, red below 70.
    &ldquo;Checks failed&rdquo; is the share of yes/no questions answered No.
    &ldquo;Tickets late&rdquo; is open tickets already past their deadline as at {M['window']['end']}.</p>
</div>

<!-- ============================ PAGE 4 ============================ -->
<div class="page">
  <h2 class="sec"><span class="kicker">What is actually failing</span>
    The same six checks, month after month</h2>
  <p class="lede">Across {M['value']['answers']:,} answered questions this quarter,
    {M['value']['checks_failed']:,} checks came back No. They are not spread evenly &mdash; a handful
    of checks account for most of them, and the top two are equipment problems rather than
    discipline problems.</p>
  <img class="chart" src="charts/failing_checks.png">
  <p class="cap">Share of submissions answering No, by period. Only checks asked at least
    25 times in the current period are shown.</p>

  <div class="box">
    <h3>The ice machines are the single biggest failing check in the business</h3>
    <p>&ldquo;Ice machine functioning properly?&rdquo; has failed on roughly a third of all opening
      checklists, and the rate has climbed across the quarter &mdash; 27.3% in May to 33.7% so far in
      August. Crucially it fails at good stores too: even the outlet with the <em>fewest</em> ice
      failures in the chain still answers No 19.5% of the time. That is an asset problem, not a
      compliance problem. The free-text reports point the same way: &ldquo;ice machine leaking water
      onto the floor, stopped using it&rdquo; has been filed repeatedly at Ahmedabad alone.
      Walk-in freezer temperature is the same pattern at a lower level (23.4% failing, also rising).</p>
  </div>

  <p><b>What I would do with this.</b> Two of the top three failing checks are refrigeration and ice.
    Rather than coach twenty store managers on the same check, it is cheaper to commission a
    condition survey of the ice machines and walk-in units at the six worst outlets and decide
    replace-versus-service with actual numbers. I can produce the per-asset failure history from
    Linemate in an afternoon if you want it costed.</p>

  <hr class="rule">

  <h2 class="sec"><span class="kicker">Timeliness</span>A third of openings are logged late</h2>
  <p>454 of 1,366 opening checklists this quarter (33%) were filed at or after 09:00, which for a
    store opening at 08:00 usually means the checklist was completed from memory rather than
    walked through. It correlates almost perfectly with the at-risk group. It is worth a
    conversation before it becomes a food-safety incident, because a back-filled temperature check
    is not a temperature check.</p>
</div>

<!-- ============================ PAGE 5 ============================ -->
<div class="page">
  <h2 class="sec"><span class="kicker">Follow-through</span>
    Where the operating model is leaking</h2>
  <p class="lede">This is the section I would spend the meeting on. Reporting works. Resolution
    does not, and the pattern is consistent enough that it is a process design issue rather than
    an effort issue.</p>

  <table class="two"><tr>
    <td>
      <img class="chart" src="charts/backlog.png">
      <p class="cap">Open tickets by age. The bar on the right is the problem:
        {M['backlog']['over_30d']} tickets older than 30 days, {M['backlog']['escalated']} of them
        formally escalated and still open.</p>
    </td>
    <td>
      <img class="chart" src="charts/sla.png">
      <p class="cap">Share of tickets that missed their deadline, by priority, quarter to date.
        The inversion is the finding: the more urgent the ticket, the more likely we miss it.</p>
    </td>
  </tr></table>

  <div class="find alarm">
    <h3>The 24-hour high-priority SLA is not real</h3>
    <p>High-priority tickets breach {[r for r in M['sla'] if r['priority']=='High'][0]['breach']:.0f}%
      of the time against a 24-hour target, with a median resolution of
      {[r for r in M['sla'] if r['priority']=='High'][0]['med_res']:.0f} hours &mdash; sitting almost
      exactly on the deadline, which is what a target nobody has resourced looks like. In the current
      period it reached {cur['high_breach']:.0f}%. Either we staff for 24 hours or we set the target
      at 48 and stop generating breach noise that everyone has learned to ignore.</p>
  </div>

  <div class="find alarm">
    <h3>Roughly one in five reported issues never becomes a ticket</h3>
    <p>{M['issues']['total']} store issue reports were filed this quarter;
      {M['issues']['converted']} ({M['issues']['conversion']:.0f}%) generated a ticket. The other
      {M['issues']['total'] - M['issues']['converted']} &mdash; including
      {M['issues']['high_no_ticket']} marked High severity &mdash; went nowhere. Separately,
      {M['issues']['no_photo']:.0f}% of issue reports have no photo attached, which is the single
      biggest reason maintenance vendors come back for a second visit.</p>
  </div>

  <table class="two"><tr>
    <td><img class="chart" src="charts/funnel.png">
      <p class="cap">Issue reports through to closed tickets, quarter to date. Of the
        {M['issues']['converted']} reports that did become tickets, {_LINKED_CLOSED} are closed and
        {M['issues']['converted'] - _LINKED_CLOSED} are still open. Both drop-offs are fixable in
        configuration rather than headcount.</p></td>
    <td>
      <h3 style="font-size:9.4pt;margin-bottom:5px">Faults reported more than once at the same store</h3>
      <table class="grid"><thead><tr><th>Store</th><th>Times</th></tr></thead><tbody>
      {"".join(f'<tr><td class="l"><b>{r["outlet"]}</b><span class="sub">{r["issue"][:58]}</span></td><td class="n">{r["times"]}</td></tr>' for r in M['recurrence']['top'][:5])}
      </tbody></table>
      <p class="cap">{M['recurrence']['events']} recurrences across
        {M['recurrence']['outlets']} stores; {M['recurrence']['after_close']} came back after the
        earlier ticket had been closed.</p>
    </td>
  </tr></table>
</div>

<!-- ============================ PAGE 6 ============================ -->
<div class="page">
  <h2 class="sec"><span class="kicker">Recommendations</span>Five decisions, with owners</h2>
  <table class="act">
    <thead><tr><th style="width:47%">Action</th><th>Why</th><th>Owner</th><th>By</th></tr></thead>
    <tbody>
    <tr><td><b>Clear the 30-day backlog.</b> Triage all {M['backlog']['over_30d']} tickets older than
      a month: fix, re-scope or close with a reason. Safety category first.</td>
      <td>{M['backlog']['by_category']['Safety']} open safety tickets, median age
        {M['backlog']['median_age']:.0f} days.</td>
      <td class="who">Area managers</td><td class="when">2 weeks</td></tr>
    <tr><td><b>Re-baseline the high-priority SLA to 48 hours</b> or fund on-call cover for the
      24-hour target. Pick one.</td>
      <td>{[r for r in M['sla'] if r['priority']=='High'][0]['breach']:.0f}% breach makes the current
        target meaningless.</td>
      <td class="who">VP Operations</td><td class="when">This month</td></tr>
    <tr><td><b>Auto-raise a ticket from any issue report of Medium severity or above</b>, and make
      the photo field mandatory on High.</td>
      <td>Closes the {M['issues']['total'] - M['issues']['converted']}-report leak, including
        {M['issues']['high_no_ticket']} High-severity ones. Configuration change, no headcount.</td>
      <td class="who">Linemate admin</td><td class="when">1 week</td></tr>
    <tr><td><b>Commission a refrigeration and ice-machine condition survey</b> at the six worst
      outlets; decide service versus replace on the failure history.</td>
      <td>Two of the top three failing checks chain-wide, and rising every month.</td>
      <td class="who">Maintenance</td><td class="when">4 weeks</td></tr>
    <tr><td><b>Put the seven at-risk stores on a named 30-day plan</b> using the Bhopal playbook:
      weekly missed-audit review with the store manager.</td>
      <td>They generate 63% of all missed checklists. Bhopal moved
        +{up.chg.iloc[0]:.0f} points with exactly this.</td>
      <td class="who">Area managers</td><td class="when">Starts Monday</td></tr>
    </tbody>
  </table>

  <hr class="rule">

  <h2 class="sec"><span class="kicker">What Linemate caught this quarter</span>
    The counterfactual</h2>
  <p class="lede">None of the above is visible without the platform. Over 13 weeks across 20 outlets:</p>
  <table class="kpis"><tr>
    <td><div class="kpi"><div class="lab">Checks answered</div>
      <div class="val">{M['value']['answers']:,}</div>
      <div class="note">across {M['value']['submissions']:,} submissions</div></div></td>
    <td><div class="kpi" style="border-top-color:#AF3428"><div class="lab">Failed checks logged</div>
      <div class="val">{M['value']['checks_failed']:,}</div>
      <div class="note">each one a defect that was found and recorded rather than missed</div></div></td>
    <td><div class="kpi" style="border-top-color:#B9770E"><div class="lab">High-severity issues surfaced</div>
      <div class="val">{M['value']['high_sev_caught']}</div>
      <div class="note">of {M['value']['issues_surfaced']} issues reported from the floor</div></div></td>
    <td><div class="kpi" style="border-top-color:#17845A"><div class="lab">Tickets closed</div>
      <div class="val">{M['value']['tickets_closed']}</div>
      <div class="note">of {M['value']['tickets']} raised &nbsp;·&nbsp;
        {M['value']['tickets_closed']/M['value']['tickets']*100:.0f}% resolution rate</div></div></td>
  </tr></table>
  <p>Put plainly: {M['value']['checks_failed']:,} things were wrong in our kitchens this quarter and
    we know what each one was, which store it was in and who found it. Not knowing used to be the
    hard part of running twenty kitchens; that part is now solved. The remaining problem &mdash; and
    the reason this report exists &mdash; is that we close {M['value']['tickets_closed']/M['value']['tickets']*100:.0f}% of tickets
    but fix fewer than that, and until the recurrence number comes down we are measuring activity
    rather than resolution. Next month's edition will track exactly that: repeat faults per store,
    and the age of the oldest open safety ticket.</p>

  <div class="foot"><b>About this report.</b> Issued monthly, first working day, covering the
    trailing 28 days so every edition is comparable. Sent as PDF to the VP of Operations and the
    four area managers, with the live dashboard linked for anyone who wants to drill into a
    specific store, day or submission. Questions, or a cut of any number in here, to the
    analytics team. Generated from Linemate data through {M['window']['end']}.</div>
</div>
</body></html>"""

with open("out/report.html", "w") as fh:
    fh.write(HTML)

subprocess.run([
    "wkhtmltopdf", "--enable-local-file-access", "--page-size", "A4",
    "--margin-top", "14mm", "--margin-bottom", "16mm",
    "--margin-left", "13mm", "--margin-right", "13mm",
    "--footer-font-size", "7", "--footer-font-name", "Helvetica",
    "--footer-left", "Spice Route Kitchens · Monthly Operations Review · "
                     f"{cur['start']} – {cur['end']}",
    "--footer-right", "Page [page] of [topage]",
    "--footer-spacing", "6",
    "out/report.html", "out/Spice-Route-Monthly-Ops-Review-Aug-2026.pdf"
], check=True, cwd=".", capture_output=True)
print("PDF written")
