import json
import sys
import numpy as np
import matplotlib.pyplot as plt

DATA = sys.argv[1] if len(sys.argv) > 1 else 'results.json'

with open(DATA) as f:
    data = json.load(f)

markets = data['markets']
n = len(markets)

fig, axes = plt.subplots(2, 2, figsize=(14, 10))
fig.suptitle(
    f"Pred Economics  |  start={data['startTreasury']:.0f}  "
    f"end={data['endTreasury']:.2f}  net={data['endTreasury'] - data['startTreasury']:.2f}  "
    f"n={n} markets",
    fontsize=13
)

# 1. Treasury step chart
ax = axes[0, 0]
y = [data['startTreasury']] + [m['endTreasury'] for m in markets]
x = list(range(len(y)))
ax.step(x, y, where='post', color='steelblue', linewidth=2)
ax.fill_between(x, data['startTreasury'], y, step='post', alpha=0.15, color='steelblue')
ax.axhline(data['startTreasury'], color='gray', linestyle='--', linewidth=0.8)
# only label every 5th tick to avoid clutter
step = max(1, n // 10)
ax.set_xticks(x[::step])
ax.set_xticklabels([str(i) for i in x[::step]], fontsize=8)
ax.set_title('Treasury over markets')
ax.set_ylabel('USDC')
ax.set_xlabel('Market #')

# 2. P&L per market (bars, no text labels -- too many)
ax = axes[0, 1]
deltas = [m['treasuryDelta'] for m in markets]
colors = ['#2ecc71' if d >= 0 else '#e74c3c' for d in deltas]
ax.bar(range(n), deltas, color=colors, alpha=0.8, width=0.85)
ax.axhline(0, color='black', linewidth=0.8)
wins = sum(1 for d in deltas if d >= 0)
ax.set_title(f'P&L per market  ({wins}/{n} positive)')
ax.set_ylabel('USDC')
ax.set_xlabel('Market #')

# 3. Imbalance -- sequential, colormap to show temporal order
ax = axes[1, 0]
cmap = plt.cm.plasma
offset = 0
for i, m in enumerate(markets):
    ticks = m['ticks']
    xs = [offset + t['tick'] for t in ticks]
    ys = [t['imbalance'] for t in ticks]
    color = cmap(i / max(1, n - 1))
    ax.plot(xs, ys, color=color, alpha=0.6, linewidth=0.7)
    ax.axvline(offset, color='gray', linewidth=0.3, alpha=0.3)
    offset += len(ticks)
ax.axhline(0, color='black', linewidth=0.6)
ax.set_title(f'Imbalance across {n} markets (purple=early, yellow=late)')
ax.set_ylabel('Contracts')
ax.set_xlabel('Tick')
sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(1, n))
sm.set_array([])
fig.colorbar(sm, ax=ax, label='Market index', shrink=0.85)

# 4. Spread width -- overlay all markets on same T axis, show mean
ax = axes[1, 1]
n_bets = data['nBets']
all_spreads = np.array([[t['spread'] for t in m['ticks']] for m in markets])
T_axis = [1 - tick / n_bets for tick in range(n_bets)]

for row in all_spreads:
    ax.plot(T_axis, row, color='steelblue', alpha=0.12, linewidth=0.8)

mean_spread = all_spreads.mean(axis=0)
ax.plot(T_axis, mean_spread, color='navy', linewidth=2, label=f'mean (n={n})')
ax.invert_xaxis()  # T=1 on left (open), T=0 on right (expiry)
ax.set_title('Spread width vs time remaining')
ax.set_xlabel('T (1 = open, 0 = expiry)')
ax.set_ylabel('Overround (yesAsk + noAsk - 1)')
ax.legend(fontsize=9)

plt.tight_layout()
out = DATA.replace('.json', '.png')
plt.savefig(out, dpi=150)
print(f'saved {out}')
plt.show()
