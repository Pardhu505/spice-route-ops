/* Monthly Operations Review -> .docx  (mirrors the PDF edition) */
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  ImageRun, PageBreak, Header, Footer, PageNumber, convertInchesToTwip
} = require("docx");

const M = JSON.parse(fs.readFileSync("out/metrics.json", "utf8"));
const SC = JSON.parse(fs.readFileSync("out/scorecard.json", "utf8"));
const P = M.periods, L = M.period_labels;
const cur = P[2], prev = P[1], first = P[0];
const BL = M.backlog, IS = M.issues, RC = M.recurrence, VA = M.value;
const hi = M.sla.find(r => r.priority === "High");
const DASH = "https://spice-route-ops.onrender.com";

/* ---------- palette ---------- */
const NAVY = "1B2A38", INK = "16202B", SLATE = "43566A", GREY = "748799";
const RED = "C0392B", GREEN = "12805A", AMBER = "B4740A", BLUE = "1F6FB4";
const RULE = "DDE4EA", ZEBRA = "F4F7F9";
const FONT = "Calibri";

/* page width 8.5in - 2*0.75in margins = 7in = 10080 dxa */
const W = 10080;

/* ---------- helpers ---------- */
const t = (text, o = {}) => new TextRun({ text, font: FONT, ...o });
const p = (runs, o = {}) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs], ...o
});
const body = (text, o = {}) => p(t(text, { size: 20, color: SLATE, ...o.run }),
  { spacing: { after: 110, line: 258 }, ...o });

function kicker(text) {
  return p(t(text.toUpperCase(), { size: 15, bold: true, color: BLUE,
    characterSpacing: 30 }), { spacing: { after: 40 } });
}
function h2(text) {
  return p(t(text, { size: 26, bold: true, color: INK }),
    { spacing: { after: 120 }, heading: HeadingLevel.HEADING_2 });
}
function h3(text, color) {
  return p(t(text, { size: 21, bold: true, color: color || INK }),
    { spacing: { before: 60, after: 50 }, heading: HeadingLevel.HEADING_3 });
}
function rule() {
  return new Paragraph({ spacing: { before: 80, after: 110 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } } });
}
function img(file, widthIn) {
  const png = fs.readFileSync(file);
  // read intrinsic size from the PNG IHDR so aspect ratio is exact
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const width = widthIn * 96;
  return p(new ImageRun({ type: "png", data: png,
    transformation: { width: Math.round(width), height: Math.round(width * h / w) } }),
    { spacing: { before: 60, after: 60 }, alignment: AlignmentType.CENTER });
}
function caption(text) {
  return p(t(text, { size: 16, color: GREY, italics: false }),
    { spacing: { after: 120 } });
}
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const thinBottom = { style: BorderStyle.SINGLE, size: 4, color: RULE };

function cell(children, opts = {}) {
  return new TableCell({
    children, width: { size: opts.w, type: WidthType.DXA },
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
    margins: { top: 62, bottom: 62, left: 100, right: 100 },
    borders: { top: opts.top || noBorder, bottom: opts.bottom || thinBottom,
               left: noBorder, right: noBorder },
    verticalAlign: "center"
  });
}
function txtCell(text, w, o = {}) {
  return cell([p(t(String(text), { size: o.size || 18, bold: o.bold,
    color: o.color || SLATE }), { alignment: o.align || AlignmentType.LEFT })],
    { w, fill: o.fill, top: o.top, bottom: o.bottom });
}

/* KPI strip: four boxes in a borderless table */
function kpiRow(items) {
  const w = Math.floor(W / items.length);
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: items.map(() => w),
    rows: [new TableRow({ children: items.map(it => new TableCell({
      width: { size: w, type: WidthType.DXA },
      margins: { top: 105, bottom: 105, left: 120, right: 120 },
      shading: { type: ShadingType.CLEAR, fill: "F7F9FB", color: "auto" },
      borders: { top: { style: BorderStyle.SINGLE, size: 18, color: it.color || BLUE },
                 bottom: noBorder, left: noBorder, right: noBorder },
      children: [
        p(t(it.label.toUpperCase(), { size: 14, bold: true, color: GREY,
          characterSpacing: 20 }), { spacing: { after: 60 } }),
        p(t(it.value, { size: 40, bold: true, color: INK }), { spacing: { after: 40 } }),
        p(t(it.note, { size: 15, color: GREY }))
      ]
    })) })]
  });
}

function delta(a, b, unit = "pt", inv = false) {
  const x = a - b;
  if (Math.abs(x) < 0.05) return "no change";
  const arrow = x > 0 ? "\u25B2" : "\u25BC";
  return `${arrow} ${Math.abs(x).toFixed(1)}${unit} vs last period`;
}

/* ---------- store scorecard table ---------- */
const COLW = [2500, 1000, 1330, 1180, 1290, 1400, 1380];
function scorecardTable() {
  const head = new TableRow({ tableHeader: true, children: [
    ["Store", AlignmentType.LEFT], ["Rating", AlignmentType.RIGHT],
    ["Checklists", AlignmentType.RIGHT], ["Audits", AlignmentType.RIGHT],
    ["Avg score", AlignmentType.RIGHT], ["Checks failed", AlignmentType.RIGHT],
    ["Tickets late", AlignmentType.RIGHT]
  ].map(([label, align], i) => cell(
    [p(t(label.toUpperCase(), { size: 14, bold: true, color: GREY, characterSpacing: 20 }),
      { alignment: align })],
    { w: COLW[i], bottom: { style: BorderStyle.SINGLE, size: 10, color: SLATE } }))
  });
  const rows = SC.map((r, i) => {
    const fill = i % 2 ? ZEBRA : undefined;
    const bandColor = r.band === "Healthy" ? GREEN : r.band === "Watch" ? AMBER : RED;
    const word = r.band === "Healthy" ? "Good" : r.band === "Watch" ? "Watch" : "At risk";
    const R = AlignmentType.RIGHT;
    return new TableRow({ cantSplit: true, children: [
      cell([
        p(t(r.outlet, { size: 17, bold: true, color: INK })),
        p(t(r.area_manager, { size: 13, color: GREY }))
      ], { w: COLW[0], fill }),
      cell([p([t(`${Math.round(r.health)}  `, { size: 17, bold: true, color: INK }),
               t(word, { size: 14, bold: true, color: bandColor })], { alignment: R })],
        { w: COLW[1], fill }),
      txtCell(`${r.completion.toFixed(1)}%`, COLW[2], { align: R, fill, color: INK, bold: true }),
      txtCell(r.audit_pct === null ? "-" : `${r.audit_pct.toFixed(1)}%`, COLW[3], { align: R, fill }),
      txtCell(`${r.compliance.toFixed(1)}%`, COLW[4], { align: R, fill }),
      txtCell(`${r.fail_pct.toFixed(1)}%`, COLW[5],
        { align: R, fill, color: r.fail_pct >= 25 ? RED : r.fail_pct >= 15 ? AMBER : SLATE }),
      txtCell(String(r.overdue), COLW[6],
        { align: R, fill, bold: r.overdue >= 5, color: r.overdue >= 5 ? RED : SLATE })
    ] });
  });
  return new Table({ width: { size: W, type: WidthType.DXA },
    columnWidths: COLW, rows: [head, ...rows] });
}

/* ---------- actions table ---------- */
const AW = [4400, 3180, 1400, 1100];
function actionsTable(rows) {
  const head = new TableRow({ tableHeader: true, children:
    ["Action", "Why", "Owner", "By"].map((l, i) => cell(
      [p(t(l.toUpperCase(), { size: 14, bold: true, color: GREY, characterSpacing: 20 }))],
      { w: AW[i], bottom: { style: BorderStyle.SINGLE, size: 10, color: SLATE } }))
  });
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: AW,
    rows: [head, ...rows.map((r, i) => {
      const fill = i % 2 ? ZEBRA : undefined;
      return new TableRow({ cantSplit: true, children: [
        cell([p([t(r.bold, { size: 17, bold: true, color: INK }),
                 t(" " + r.rest, { size: 17, color: SLATE })])], { w: AW[0], fill }),
        txtCell(r.why, AW[1], { fill }),
        txtCell(r.owner, AW[2], { fill, bold: true, color: BLUE }),
        txtCell(r.by, AW[3], { fill, color: GREY })
      ] });
    })] });
}

/* ---------- finding block ---------- */
function finding(num, title, text, color) {
  return [
    new Paragraph({
      spacing: { before: 100, after: 40 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color } },
      indent: { left: 150 },
      children: [t(`${num}   ${title}`, { size: 21, bold: true, color: INK })]
    }),
    new Paragraph({
      spacing: { after: 120, line: 262 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color } },
      indent: { left: 150 },
      children: [t(text, { size: 19, color: SLATE })]
    })
  ];
}

/* ====================== document ====================== */
const children = [];

/* --- masthead --- */
children.push(
  kicker("Spice Route Kitchens  \u00B7  Monthly Operations Review"),
  new Paragraph({
    spacing: { after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: NAVY } },
    children: [t(`${cur.start} \u2013 ${cur.end}`, { size: 40, bold: true, color: INK })]
  }),
  p(t(`Prepared for Anjali Menon, Head of Operations, and the area management team  \u00B7  ` +
      `20 outlets  \u00B7  compared against ${prev.start} \u2013 ${prev.end}  \u00B7  ` +
      `live detail at ${DASH.replace("https://", "")}`,
      { size: 16, color: GREY }), { spacing: { after: 200 } }),

  kicker("The month in one line"),
  h2("Compliance held; follow-up did not."),
  body(`Stores filed slightly more of their routine paperwork than last month and hygiene audits ` +
    `improved sharply. But the work those checks generate is not being closed: ${BL.overdue} of ` +
    `${BL.total} open tickets are past their deadline, ${BL.over_30d} of them by more than a ` +
    `month, and ${Math.round(cur.high_breach)}% of high-priority tickets raised this period missed ` +
    `their 24-hour target. The chain is good at spotting problems and poor at finishing them.`,
    { run: { size: 21 }, spacing: { after: 200 } }),

  kpiRow([
    { label: "Checklist completion", value: `${cur.completion.toFixed(1)}%`, color: RED,
      note: `${delta(cur.completion, prev.completion)}  \u00B7  ${cur.missed} runs missed` },
    { label: "Hygiene audits done", value: `${cur.audit.toFixed(1)}%`, color: GREEN,
      note: `${delta(cur.audit, prev.audit)}  \u00B7  ${cur.audit_missed} store-weeks missed` },
    { label: "Avg compliance score", value: `${cur.compliance.toFixed(1)}%`, color: BLUE,
      note: `${delta(cur.compliance, prev.compliance)}  \u00B7  ${cur.below.toFixed(0)}% below threshold` },
    { label: "Tickets past due", value: String(BL.overdue), color: RED,
      note: `of ${BL.total} open  \u00B7  median age ${Math.round(BL.median_age)} days` }
  ]),
  rule(),

  kicker("What changed, and what it means"),
  h2("Four things worth your attention"),
  ...finding(1, "The ticket backlog has become structural, not seasonal",
    `${BL.over_30d} of the ${BL.total} open tickets are more than 30 days old and the oldest is ` +
    `${Math.round(BL.oldest)} days. Escalations have risen every period (${first.escalated} \u2192 ` +
    `${prev.escalated} \u2192 ${cur.escalated}), which tells us escalation is being used as a filing ` +
    `cabinet rather than a trigger. Safety is the single largest category in the backlog ` +
    `(${BL.by_category.Safety} open tickets), which is the part I would not let run another month.`, RED),
  ...finding(2, "Closing a ticket is not the same as fixing the problem",
    `Reading the free-text issue reports rather than the tick-boxes: ${RC.events} times this quarter ` +
    `a store reported the same fault in the same words it had already reported before, and in ` +
    `${RC.after_close} of those cases the earlier ticket had already been marked Closed. Median time ` +
    `to recurrence is ${Math.round(RC.median_gap)} days. Delhi \u2013 Connaught Place has reported the ` +
    `same grill igniter fault four separate times. We are paying to reopen problems we believe we solved.`, RED),
  ...finding(3, "The chain average hides a two-speed estate",
    `Chain completion moved ${first.completion.toFixed(1)}% \u2192 ${cur.completion.toFixed(1)}% across ` +
    `the quarter, which reads like slow progress. It is not: the eight healthiest stores average 91% ` +
    `completion while seven at-risk stores average 54%, and that gap has not narrowed in three months. ` +
    `Those seven stores generate 63% of every missed checklist in the chain. This is a seven-store ` +
    `problem being reported as a twenty-store average.`, RED),
  ...finding(4, "Hygiene audits are the one clear win \u2014 and it was coachable",
    `Weekly audit completion went ${prev.audit.toFixed(1)}% \u2192 ${cur.audit.toFixed(1)}%, the largest ` +
    `single improvement of the quarter, driven mostly by Bhopal \u2013 MP Nagar (+34 points on ` +
    `checklists) after its area manager started reviewing the missed-audit list weekly. That is the ` +
    `intervention worth copying to the other six.`, GREEN),

  p(new PageBreak()),
  kicker("Decisions needed from you"),
  h2("Three of the five actions need your call, not ours"),
  actionsTable([
    { bold: "Set the high-priority SLA at 24 or 48 hours.",
      rest: "If it stays at 24 it needs on-call cover funded; if not, move it to 48 and the breach number becomes real again.",
      why: `Today we breach ${Math.round(hi.breach)}% of the time, so the target no longer changes anyone's behaviour.`,
      owner: "VP Operations", by: "This month" },
    { bold: "Approve a refrigeration and ice-machine condition survey",
      rest: "at the six worst outlets.",
      why: "Two of the three most-failed checks chain-wide are equipment, not discipline.",
      owner: "Maintenance", by: "4 weeks" },
    { bold: "Agree the seven at-risk stores get a named 30-day plan",
      rest: "with their area manager.",
      why: "They produce 63% of all missed checklists; the Bhopal playbook already worked once.",
      owner: "Area managers", by: "Starts Monday" }
  ]),

  /* ---------- page 2 (cont.) ---------- */
  rule(),
  kicker("Chain performance"),
  h2("Thirteen weeks at a glance"),
  body("Daily checklist completion has been flat in the mid-70s since mid-June. The volatility in " +
    "the audit line is the story worth watching \u2014 audits are done by exception rather than by " +
    "routine, so the line swings between 40% and 80% depending on who chased them."),
  img("out/charts/weekly_trend.png", 7),
  caption("Weekly, all 20 outlets. Compliance score is the average of the scored checklist and audit " +
    "submissions filed that week; it stays high because the stores that skip filing are also the " +
    "stores that would have scored badly \u2014 a survivorship effect worth remembering whenever " +
    "compliance looks reassuring."),
  rule(),
  kicker("Distribution, not average"),
  h2("Where each store started the quarter, and where it is now"),
  img("out/charts/dumbbell.png", 6.4),
  caption(`Hollow marker = ${L[0]}, solid = ${L[2]}. Green means the store improved, red means it ` +
    `slipped. Nine stores now clear the 85% completion target; four have sat below 50% for the ` +
    `entire quarter. Nagpur is the one to act on: it is not just the lowest performer, it is the ` +
    `fastest-declining one. Chandigarh matters for a different reason \u2014 it was a healthy store a ` +
    `month ago and nobody has flagged it yet.`),

  /* ---------- page 3 ---------- */
  p(new PageBreak()),
  kicker("Store scorecard"),
  h2("All 20 outlets, quarter to date"),
  body("Rating is a 0\u2013100 roll-up of what the store itself controls: completion (35), audits (15), " +
    "compliance score (30) and failed checks (20). Ticket lateness sits in its own column because it " +
    "is owned by the area manager, not the store."),
  scorecardTable(),
  p(t("Good \u2265 85, Watch 70\u201384, At risk below 70. \u201CChecks failed\u201D is the share of " +
    "yes/no questions answered No. \u201CTickets late\u201D is open tickets already past their " +
    "deadline as at " + M.window.end + ".", { size: 16, color: GREY }),
    { spacing: { before: 140 } }),

  /* ---------- page 4 ---------- */
  p(new PageBreak()),
  kicker("What is actually failing"),
  h2("The same six checks, month after month"),
  body(`Across ${VA.answers.toLocaleString("en-US")} answered questions this quarter, ` +
    `${VA.checks_failed.toLocaleString("en-US")} checks came back No. They are not spread evenly ` +
    `\u2014 a handful of checks account for most of them, and the top two are equipment problems ` +
    `rather than discipline problems.`),
  img("out/charts/failing_checks.png", 7),
  caption("Share of submissions answering No, by period. Only checks asked at least 25 times in the " +
    "current period are shown."),
  h3("The ice machines are the single biggest failing check in the business"),
  body("\u201CIce machine functioning properly?\u201D has failed on roughly a third of all opening " +
    "checklists, and the rate has climbed across the quarter \u2014 27.3% in May to 33.7% so far in " +
    "August. Crucially it fails at good stores too: even the outlet with the fewest ice failures in " +
    "the chain still answers No 19.5% of the time. That is an asset problem, not a compliance " +
    "problem. The free-text reports point the same way: \u201Cice machine leaking water onto the " +
    "floor, stopped using it\u201D has been filed repeatedly at Ahmedabad alone. Walk-in freezer " +
    "temperature is the same pattern at a lower level (23.4% failing, also rising)."),
  h3("What I would do with this"),
  body("Two of the top three failing checks are refrigeration and ice. Rather than coach twenty " +
    "store managers on the same check, it is cheaper to commission a condition survey of the ice " +
    "machines and walk-in units at the six worst outlets and decide replace-versus-service with " +
    "actual numbers. I can produce the per-asset failure history from Linemate in an afternoon if " +
    "you want it costed."),
  rule(),
  kicker("Timeliness"),
  h2("A third of openings are logged late"),
  body("454 of 1,366 opening checklists this quarter (33%) were filed at or after 09:00, which for a " +
    "store opening at 08:00 usually means the checklist was completed from memory rather than walked " +
    "through. It correlates almost perfectly with the at-risk group. It is worth a conversation " +
    "before it becomes a food-safety incident, because a back-filled temperature check is not a " +
    "temperature check."),

  /* ---------- page 5 ---------- */
  p(new PageBreak()),
  kicker("Follow-through"),
  h2("Where the operating model is leaking"),
  body("This is the section I would spend the meeting on. Reporting works. Resolution does not, and " +
    "the pattern is consistent enough that it is a process design issue rather than an effort issue."),
  img("out/charts/backlog.png", 3.35),
  caption(`Open tickets by age. The bar on the right is the problem: ${BL.over_30d} tickets older ` +
    `than 30 days, ${BL.escalated} of them formally escalated and still open.`),
  img("out/charts/sla.png", 3.35),
  caption("Share of tickets that missed their deadline, by priority, quarter to date. The inversion " +
    "is the finding: the more urgent the ticket, the more likely we miss it."),
  ...finding("", "The 24-hour high-priority SLA is not real",
    `High-priority tickets breach ${Math.round(hi.breach)}% of the time against a 24-hour target, ` +
    `with a median resolution of ${Math.round(hi.med_res)} hours \u2014 sitting almost exactly on the ` +
    `deadline, which is what a target nobody has resourced looks like. In the current period it ` +
    `reached ${Math.round(cur.high_breach)}%. Either we staff for 24 hours or we set the target at 48 ` +
    `and stop generating breach noise that everyone has learned to ignore.`, RED),
  ...finding("", "Roughly one in five reported issues never becomes a ticket",
    `${IS.total} store issue reports were filed this quarter; ${IS.converted} ` +
    `(${Math.round(IS.conversion)}%) generated a ticket. The other ${IS.total - IS.converted} \u2014 ` +
    `including ${IS.high_no_ticket} marked High severity \u2014 went nowhere. Separately, ` +
    `${Math.round(IS.no_photo)}% of issue reports have no photo attached, which is the single biggest ` +
    `reason maintenance vendors come back for a second visit.`, RED),
  h3("Faults reported more than once at the same store"),
  new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [7600, 2480],
    rows: [
      new TableRow({ tableHeader: true, children: [
        cell([p(t("STORE AND FAULT", { size: 14, bold: true, color: GREY, characterSpacing: 20 }))],
          { w: 7600, bottom: { style: BorderStyle.SINGLE, size: 10, color: SLATE } }),
        cell([p(t("TIMES", { size: 14, bold: true, color: GREY, characterSpacing: 20 }),
          { alignment: AlignmentType.RIGHT })],
          { w: 2480, bottom: { style: BorderStyle.SINGLE, size: 10, color: SLATE } })
      ] }),
      ...RC.top.slice(0, 5).map((r, i) => new TableRow({ children: [
        cell([p(t(r.outlet, { size: 18, bold: true, color: INK })),
              p(t(r.issue, { size: 15, color: GREY }))], { w: 7600, fill: i % 2 ? ZEBRA : undefined }),
        txtCell(String(r.times), 2480,
          { align: AlignmentType.RIGHT, bold: true, color: RED, fill: i % 2 ? ZEBRA : undefined })
      ] }))
    ]
  }),
  caption(`${RC.events} recurrences across ${RC.outlets} stores; ${RC.after_close} came back after ` +
    `the earlier ticket had been closed.`),

  /* ---------- page 6 ---------- */
  rule(),
  kicker("Recommendations"),
  h2("Five decisions, with owners"),
  actionsTable([
    { bold: "Clear the 30-day backlog.",
      rest: `Triage all ${BL.over_30d} tickets older than a month: fix, re-scope or close with a reason. Safety category first.`,
      why: `${BL.by_category.Safety} open safety tickets, median age ${Math.round(BL.median_age)} days.`,
      owner: "Area managers", by: "2 weeks" },
    { bold: "Re-baseline the high-priority SLA to 48 hours",
      rest: "or fund on-call cover for the 24-hour target. Pick one.",
      why: `${Math.round(hi.breach)}% breach makes the current target meaningless.`,
      owner: "VP Operations", by: "This month" },
    { bold: "Auto-raise a ticket from any issue report of Medium severity or above,",
      rest: "and make the photo field mandatory on High.",
      why: `Closes the ${IS.total - IS.converted}-report leak, including ${IS.high_no_ticket} High-severity ones. Configuration change, no headcount.`,
      owner: "Linemate admin", by: "1 week" },
    { bold: "Commission a refrigeration and ice-machine condition survey",
      rest: "at the six worst outlets; decide service versus replace on the failure history.",
      why: "Two of the top three failing checks chain-wide, and rising every month.",
      owner: "Maintenance", by: "4 weeks" },
    { bold: "Put the seven at-risk stores on a named 30-day plan",
      rest: "using the Bhopal playbook: weekly missed-audit review with the store manager.",
      why: "They generate 63% of all missed checklists. Bhopal moved +34 points with exactly this.",
      owner: "Area managers", by: "Starts Monday" }
  ]),
  rule(),
  kicker("What Linemate caught this quarter"),
  h2("The counterfactual"),
  body("None of the above is visible without the platform. Over 13 weeks across 20 outlets:"),
  kpiRow([
    { label: "Checks answered", value: VA.answers.toLocaleString("en-US"), color: BLUE,
      note: `across ${VA.submissions.toLocaleString("en-US")} submissions` },
    { label: "Failed checks logged", value: VA.checks_failed.toLocaleString("en-US"), color: RED,
      note: "each one a defect found and recorded rather than missed" },
    { label: "High-severity issues", value: String(VA.high_sev_caught), color: AMBER,
      note: `of ${VA.issues_surfaced} issues reported from the floor` },
    { label: "Tickets closed", value: String(VA.tickets_closed), color: GREEN,
      note: `of ${VA.tickets} raised \u00B7 ${Math.round(VA.tickets_closed / VA.tickets * 100)}% resolution rate` }
  ]),
  body(`Put plainly: ${VA.checks_failed.toLocaleString("en-US")} things were wrong in our kitchens ` +
    `this quarter and we know what each one was, which store it was in and who found it. Not knowing ` +
    `used to be the hard part of running twenty kitchens; that part is now solved. The remaining ` +
    `problem \u2014 and the reason this report exists \u2014 is that we close ` +
    `${Math.round(VA.tickets_closed / VA.tickets * 100)}% of tickets but fix fewer than that, and ` +
    `until the recurrence number comes down we are measuring activity rather than resolution. Next ` +
    `month's edition will track exactly that: repeat faults per store, and the age of the oldest open ` +
    `safety ticket.`, { spacing: { before: 200, after: 160 } }),
  p(t("About this report.  ", { size: 16, bold: true, color: SLATE }))
);
children.push(p([
  t("Issued monthly, first working day, covering the trailing 28 days so every edition is " +
    "comparable. Sent as PDF and Word to the VP of Operations and the four area managers, with the " +
    "live dashboard linked for anyone who wants to drill into a specific store, day or submission. " +
    "Generated from Linemate data through " + M.window.end + ".", { size: 16, color: GREY })
]));

const doc = new Document({
  creator: "Linemate Analytics",
  title: `Spice Route Kitchens - Monthly Operations Review - ${cur.start} to ${cur.end}`,
  description: "Monthly operations review for the VP of Operations",
  styles: { default: { document: { run: { font: FONT, size: 20, color: SLATE } } } },
  sections: [{
    properties: {
      page: {
        size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
        margin: { top: convertInchesToTwip(0.75), bottom: convertInchesToTwip(0.85),
                  left: convertInchesToTwip(0.75), right: convertInchesToTwip(0.75) }
      }
    },
    footers: { default: new Footer({ children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE } },
      spacing: { before: 80 },
      children: [
        t(`Spice Route Kitchens  \u00B7  Monthly Operations Review  \u00B7  ${cur.start} \u2013 ${cur.end}`,
          { size: 14, color: GREY }),
        t("\t\t", { size: 14 }),
        t("Page ", { size: 14, color: GREY }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 14, color: GREY }),
        t(" of ", { size: 14, color: GREY }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 14, color: GREY })
      ]
    })] }) },
    children
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("out/Spice-Route-Monthly-Ops-Review-Aug-2026.docx", buf);
  console.log("docx written", (buf.length / 1024).toFixed(0), "KB");
});
