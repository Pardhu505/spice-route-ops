"""Charts for the monthly Operations Review PDF. Palette matches the dashboard."""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter

INK, INK2, MUTED, LINE = "#0F1B26", "#33475B", "#7A8A98", "#D7DEE5"
BRAND, OK, WARN, BAD, GRID = "#2F3A8F", "#17845A", "#B9770E", "#AF3428", "#EEF1F4"
os.makedirs("out/charts", exist_ok=True)
M = json.load(open("out/metrics.json"))

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 8.5,
    "axes.edgecolor": LINE, "axes.labelcolor": INK2, "text.color": INK,
    "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.spines.top": False, "axes.spines.right": False,
    "figure.dpi": 200, "savefig.dpi": 200,
})


def save(fig, name, pad=0.15):
    fig.savefig(f"out/charts/{name}.png", bbox_inches="tight",
                pad_inches=pad, facecolor="white")
    plt.close(fig)


def style(ax, ypct=True, ymax=100):
    ax.grid(axis="y", color=GRID, lw=.9, zorder=0)
    ax.set_axisbelow(True)
    if ypct:
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
        ax.set_ylim(0, ymax)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(LINE)


# 1 -------------------------------------------------- weekly trend --------
w = M["weekly"]
labels = [x["label"] for x in w]
fig, ax = plt.subplots(figsize=(7.1, 2.25))
ax.plot(labels, [x["completion"] for x in w], color=BRAND, lw=2,
        marker="o", ms=3.4, label="Daily checklists completed", zorder=3)
ax.plot(labels, [x["audit"] for x in w], color=WARN, lw=2, marker="s", ms=3.2,
        label="Weekly hygiene audits completed", zorder=3)
ax.plot(labels, [x["compliance"] for x in w], color=OK, lw=2, ls=(0, (4, 2)),
        label="Average compliance score", zorder=3)
style(ax)
ax.set_ylim(0, 105)
ax.tick_params(axis="x", rotation=0, labelsize=7.2)
ax.legend(frameon=False, fontsize=7.6, ncol=3, loc="lower center",
          bbox_to_anchor=(.5, -.36))
save(fig, "weekly_trend")

# 2 ------------------------------------------- store dumbbell P1 vs P3 ----
labs = M["period_labels"]
p1 = {r["outlet"]: r["completion"] for r in M["period_cards"][labs[0]]}
p3 = {r["outlet"]: r["completion"] for r in M["period_cards"][labs[2]]}
order = sorted(p3, key=lambda k: p3[k])
fig, ax = plt.subplots(figsize=(7.1, 4.3))
y = np.arange(len(order))
for i, o in enumerate(order):
    a, b = p1[o], p3[o]
    col = OK if b >= a else BAD
    ax.plot([a, b], [i, i], color=col, lw=1.7, alpha=.55, zorder=2,
            solid_capstyle="round")
    ax.scatter(a, i, s=22, color="white", edgecolor=MUTED, lw=1.1, zorder=3)
    ax.scatter(b, i, s=34, color=col, zorder=4)
ax.set_yticks(y)
ax.set_yticklabels(order, fontsize=7.6)
ax.axvline(85, color=INK2, lw=.9, ls=(0, (3, 3)), zorder=1)
ax.text(85.6, len(order) - .3, "85% target", fontsize=7, color=INK2)
ax.set_xlim(30, 105)
ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
ax.grid(axis="x", color=GRID, lw=.9, zorder=0)
ax.set_axisbelow(True)
ax.scatter([], [], s=22, color="white", edgecolor=MUTED, lw=1.1,
           label=f"{labs[0]}")
ax.scatter([], [], s=34, color=INK2, label=f"{labs[2]} (current)")
ax.legend(frameon=False, fontsize=7.6, loc="lower right")
save(fig, "dumbbell")

# 3 ------------------------------------------ failing checks by period ----
qp = M["q_period"]
cur = [r for r in qp if r["period"] == labs[2] and r["asked"] >= 25]
cur = sorted(cur, key=lambda r: -r["pct"])[:6]
qids = [r["question_id"] for r in cur]
fig, ax = plt.subplots(figsize=(7.1, 2.7))
h, n = .26, len(qids)
ypos = np.arange(n)
for k, (lab, col, alpha) in enumerate(zip(labs, [MUTED, INK2, BAD], [.45, .7, 1])):
    vals = []
    for q in qids:
        m = [r for r in qp if r["period"] == lab and r["question_id"] == q]
        vals.append(m[0]["pct"] if m else 0)
    ax.barh(ypos + (1 - k) * h, vals, height=h, color=col, alpha=alpha,
            label=lab, zorder=3)
short = [(" ".join(r["question"].replace("?", "").split()[:8])) for r in cur]
ax.set_yticks(ypos)
ax.set_yticklabels(short, fontsize=7.4)
ax.invert_yaxis()
ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
ax.grid(axis="x", color=GRID, lw=.9, zorder=0)
ax.set_axisbelow(True)
ax.legend(frameon=False, fontsize=7.4, ncol=3, loc="lower center",
          bbox_to_anchor=(.5, -.28))
save(fig, "failing_checks")

# 4 ------------------------------------------------- backlog ageing -------
bl = M["backlog"]["by_bucket"]
fig, ax = plt.subplots(figsize=(3.35, 1.95))
ks = list(bl)
cols = [BRAND, BRAND, WARN, BAD, BAD]
bars = ax.bar(range(len(ks)), [bl[k] for k in ks], color=cols, width=.66, zorder=3)
for b, k in zip(bars, ks):
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1.2, str(bl[k]),
            ha="center", fontsize=8, color=INK, fontweight="bold")
ax.set_xticks(range(len(ks)))
ax.set_xticklabels([k.replace(" days", "d").replace("+ d", "+d") for k in ks],
                   fontsize=7.2)
ax.grid(axis="y", color=GRID, lw=.9, zorder=0)
ax.set_axisbelow(True)
ax.set_ylim(0, max(bl.values()) * 1.22)
ax.set_ylabel("open tickets", fontsize=7.4)
save(fig, "backlog")

# 5 ---------------------------------------------------- SLA breach --------
sla = M["sla"]
order2 = ["High", "Medium", "Low"]
sla = sorted(sla, key=lambda r: order2.index(r["priority"]))
fig, ax = plt.subplots(figsize=(3.35, 1.95))
bars = ax.bar([f'{r["priority"]}\n{r["sla_h"]:.0f}h target' for r in sla],
              [r["breach"] for r in sla],
              color=[BAD, WARN, BRAND], width=.6, zorder=3)
for b, r in zip(bars, sla):
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1.4,
            f'{r["breach"]:.0f}%', ha="center", fontsize=8.4,
            color=INK, fontweight="bold")
ax.grid(axis="y", color=GRID, lw=.9, zorder=0)
ax.set_axisbelow(True)
ax.set_ylim(0, 68)
ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
ax.tick_params(axis="x", labelsize=7.2)
ax.set_ylabel("missed the deadline", fontsize=7.4)
save(fig, "sla")

# 6 ------------------------------------------- issue funnel / leakage -----
iss = M["issues"]
import pandas as _pd
_t = _pd.read_csv("out/tickets_enriched.csv")
_linked = _t[_t.source_submission_id.notna()]
_closed_linked = int((_linked.status == "Closed").sum())
fig, ax = plt.subplots(figsize=(3.35, 1.95))
stages = ["Issue\nreported", "Became\na ticket", "Ticket\nclosed"]
vals = [iss["total"], iss["converted"], _closed_linked]
bars = ax.bar(stages, vals, color=[INK2, BRAND, OK], width=.6, zorder=3)
for b, v in zip(bars, vals):
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 5, str(v),
            ha="center", fontsize=8.4, color=INK, fontweight="bold")
ax.grid(axis="y", color=GRID, lw=.9, zorder=0)
ax.set_axisbelow(True)
ax.set_ylim(0, max(vals) * 1.2)
ax.tick_params(axis="x", labelsize=7.2)
save(fig, "funnel")

json.dump({"linked_closed": _closed_linked}, open("out/charts/_funnel.json", "w"))
print("charts written:", os.listdir("out/charts"))
