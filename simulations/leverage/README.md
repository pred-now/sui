# Leverage bad-debt simulation

One shared TypeScript harness that compares seven strategies for handling leverage
bad debt on a binary prediction market, ordered from best UX (cheap, full leverage,
few rejections) to worst UX (safest for the house, but restrictive or expensive).

```bash
npm install
npm start                 # run all seven, side by side
npm start -- --scenario 1 # one strategy by leading digit or key
npm start -- --runs 1000 --jumpSize 0.6 --treasurySeed 4000
npm run harden            # stress strategy 1, size the ceiling, lock steering -> launch config
npm run elasticity        # live elasticity estimator + control law (the assumption to measure)
npm run capital           # capital-per-open-interest ratio that survives the tail
```

## What it models

A stream of leveraged bets (`side, stake, leverage, entry odds, arrival time`) hits a
single binary market. The fair probability is a logit random walk that drifts and then
resolves Bernoulli off its final price. Users sit on both sides. Each scenario runs three
regimes:

- **best**  - balanced two-sided flow, calm prices, no jump.
- **worst** - heavily one-sided flow ending in a jump into the side that hurts Pred.
- **mc**    - Monte Carlo over randomized flow, vol, market type, and jumps (incl. rare
  black swans), averaged over `--runs`.

The same seed drives a given `(regime, run)` across all policies, so every strategy sees
the **identical** markets and order flow. Differences are the policy, not luck.

## Position & bad-debt model

A position of notional `N = stake * leverage` on a side earns `N * (p - entry)` (mark to
market in probability space) and settles at the binary outcome. Equity is
`stake + PnL - interest`.

- **Maintenance liquidation:** each step, if `equity < maint * N`, close. Under smooth
  moves this fires near the margin, so no bad debt.
- **Bad debt is jump-driven:** a jump moves price past the liquidation point inside one
  step, so the position closes with `stake + PnL < 0` and Pred eats the gap. This is the
  whole point - calm markets are safe, jumps are where the money is lost.
- **Netting (CCP):** the matched long/short book self-collateralizes, so only the live
  **naked-imbalance fraction** of a default reaches Pred. A balanced book barely scratches
  the treasury; a one-sided book passes nearly the full loss through.
- **Dynamic steering:** the crowded side pays a higher borrow rate and the balancing side
  pays less (it can be paid to balance). Modeled as both a price signal and a behavioral
  nudge that flips some crowders, which shrinks the naked imbalance.
- **Residual hedge:** Pred holds the anti-crowd side sized to the live naked imbalance and
  settles it at resolution. It pays out exactly when the crowd is wiped, at a carry cost.
- **Self-hedge every (max safety):** Pred neutralizes every position, so bad debt ~0 but it
  locks `fullCollateralBps` of treasury per notional and rejects opens once capital is
  exhausted - which is how max safety prices users out.

Assumptions are reduced-form, chosen so the seven are directly comparable rather than to
nail any single protocol's exact mechanics.

## The seven strategies (best UX -> worst UX)

1. **Netting + dynamic steering + residual hedge** - free matched loans, rate steers the
   imbalance, the vault hedges the leftover. 5x, maintenance + deleverage cliff.
2. **Netting + flat low rate + cliff + pool** - one flat rate, no active hedge, a premium
   pool soaks the leftover.
3. **2x cap + netting + flat premium** - low cap shrinks worst-case loss; user loses payout.
4. **Hard imbalance caps** - refuse crowding opens past a cap; bounds bad debt, adds friction.
5. **Leverage only on midbook markets** - allow leverage only on fast near-50/50 markets.
6. **Per-position full premium, no netting** - every position prepays its full expected
   shortfall. The worst-UX cost baseline.
7. **Self-hedge every position, near-full collateral** - 2x cap, full hedge cost on the
   user, treasury locked. Max safety, prices users out.

## Metrics

User-side: borrow cost (% of stake, annualized), rejected/capped share, liquidated share,
deleveraged share, max-payout cut, avg naked imbalance. Pred-side: bad debt, max treasury
drawdown, premium+fee income, ending treasury, peak capital locked, insolvent-run share.
Each prints **best / worst / avg(MC)** side by side, then a cross-scenario summary.

## Representative result (defaults, 500 runs)

```
scenario                    cost%stk   costAnn    rej%    liq%    wBadDebt  wInsol%    endTreas
1-netting-dynamic-hedge          0.4      123%     0.0    10.2        $739      0.0      $8,749
2-netting-flat-pool              1.4      438%     0.0    11.8      $4,179     19.6      $7,915
3-twox-cap                       0.4      133%    75.0     3.9      $1,058      0.0      $8,028
4-hard-imbalance-cap             0.9      274%    16.9    10.5        $194      0.0      $8,045
5-midbook-only                   0.4      140%    37.4     8.4        $742      0.0      $7,948
6-per-position-premium          29.4     9214%     0.0    11.8      $5,201     18.8     $13,264
7-self-hedge-every               2.3      461%    96.5     3.8          $0      0.0      $6,087
```

Reading it:

- **#1 wins on both axes:** ~0.4% cost, full 5x, no rejections, and dynamic steering holds
  the naked imbalance to ~22% worst-case (vs ~80% for the flat #2), so the small hedge+pool
  keeps it solvent.
- **#2** shows the cost of dropping steering and the active hedge: a flat rate over-charges
  balanced users yet under-charges the tail, and the pool fails ~20% of worst-case jumps.
- **#3 / #5** stay cheap and solvent by restricting the user instead (75% capped / 37%
  no-leverage markets).
- **#4** bounds worst-case bad debt hardest ($194) by refusing crowding past the cap.
- **#6** is the punchline baseline: ~29% of stake upfront (9000%+ annualized) and *still*
  ~19% insolvent, because per-position expected-shortfall pricing under-prices correlated
  jumps. Every netting scenario beats it.
- **#7** drives bad debt to zero but locks the whole treasury and rejects ~96% of demand -
  maximum safety defeats the point of leverage.

## Hardening strategy 1 into a launch config (`npm run harden`)

Takes the best-UX winner and pressure-tests it instead of trusting it. Three steps:

1. **Stress to break.** Ten correlated markets sharing one pool, a larger jump (0.6), a
   one-sided crowd (0.9), and lagged steering. Weakening the steering strength lets the
   naked imbalance climb; insolvency stays ~2% up to ~22% imbalance, then takes off
   (16% insolvent at ~34%, 55% at ~79%). So the pool **breaks around ~34% imbalance**.
2. **Soft ceiling below the break.** Set the backstop at ~60% of the break (**20%**). It
   ramps steering hard as imbalance nears it and hard-refuses only above it. At normal flow
   it is invisible - ~0.1% rejections, identical 0.4% cost, same imbalance as plain #1 - but
   on the breaking case it cuts insolvency 35% -> 0%, halves bad debt, and quarters the
   drawdown while rejecting ~1%.
3. **Lock the steering strength.** Sweep `dynamicK`: imbalance falls and borrow-rate
   volatility rises with it. The strongest steering that keeps the rate calm (<= ~5pp
   stdev) is **dynamicK = 4**, holding normal imbalance to ~11% (well under the 20% ceiling).

**Launch config:** strategy 1 (netting + dynamic steering + residual hedge + small premium
pool), `dynamicK = 4` as the main safety dial, a rarely-hit 20% soft imbalance ceiling, 5x
max leverage. Best-UX core with a proven floor under the worst day.

## Elasticity: the one assumption you must measure live (`npm run elasticity`)

Steering only works if crowders respond to the rebate near the wall. The sim can't know the
real elasticity - only live money can. So it is an explicit parameter (`--elasticity`, 1.0 =
optimistic) with a live estimator and a control law (`src/elasticity-meter.ts`):

- **Measure.** Every steering decision emits `(incentive, flipped)`. `ElasticityMeter` regresses
  flipped on incentive through the origin; the slope is the elasticity. In-sim it recovers the
  true value exactly (0.90/0.60/0.30/0.15) with tight error bars from ~35k fills.
- **It's a UX dependency, not a solvency one.** Because the 20% ceiling hard-caps imbalance
  below the break no matter who flips, **insolvency stays ~0% across every elasticity** - the
  pool is safe even if nobody responds. What moves is the rejection rate: under the break
  stress, rejections run ~2% at e=1.0 and climb to ~30-49% at e=0.1-0.2.
- **Adapt.** `recommend(e)` raises `dynamicK` as `e` falls to claw back rejections (the ceiling
  stays put - tightening it only adds rejections). If response is very weak, steering saturates
  and the residual rejection is the price of leverage: the real lever is lower max leverage.
- **Live loop:** feed fills into the meter; once `stderr` is small, push `recommend(e)`; keep
  re-measuring. Discover the elasticity, don't assume it.

## Capital: the tail is a number, not a bug (`npm run capital`)

A rare black swan can still sink a single thin-pool market. That is a capital decision. The
study measures, over 20k single-market runs, the worst pool loss per unit of peak leveraged
open interest:

| quantile | loss/OI (normal) | loss/OI (jump 0.65) |
|---|---|---|
| p99 | 0.070 | 0.085 |
| p99.9 | 0.110 | 0.136 |
| p99.99 | 0.148 | 0.166 |

**Capital rule: hold treasury+pool >= 0.14 x peak leveraged open interest** (the conservative
p99.9), equivalently **cap leveraged OI at ~7x the pool**. Verified: sizing the pool to
0.14 x median OI (~$11.5k vs the $8k default) drops single-market insolvency from ~0.5% to
~0.04%. The tail is handled by holding 14 cents of risk capital per dollar of leveraged OI.

## CLI knobs

`--scenario` plus every field of `SimConfig`: `--runs --bets --steps --marketDays --seed
--vol --avgStake --maxReqLev --treasurySeed --poolSeed --midbookFrac --jumpSize --jumpAt
--worstCrowd --elasticity`. Treasury is sized near one market's tail risk so insolvency discriminates;
raise `--treasurySeed` for a deeper-pocketed house, or `--jumpSize` / `--worstCrowd` to
stress it harder.

## Files

`rng` seeded PRNG · `market` price path + jump · `flow` per-regime arrivals · `engine` the
shared core (netting, pricing, hedge, pool, caps, liquidation, cliff, settlement) ·
`policies` the seven presets · `report` aggregation + tables · `cli` args · `main` wiring.
