import { Rng } from "./rng.js";
import { buildPath } from "./market.js";
import { genFlow, type Flow } from "./flow.js";
import type { Metrics, Policy, Regime, Side, SimConfig } from "./types.js";

interface Pos {
    side: Side;
    stake: number;
    lev0: number;
    notional: number;
    entry: number;
    openT: number;
    rate: number;
    premium: number;
    realized: number;
    deleveraged: boolean;
    closed: boolean;
}

interface Lot {
    side: Side;
    d: number;
    p: number;
}

// shared risk capital across one or more correlated markets
interface Shared {
    capital0: number;
    capital: number;
    peak: number;
    maxDD: number;
    minMarked: number; // lowest marked capital reached (for capital sizing)
    peakOI: number; // peak leveraged open interest across the book
    insolvent: boolean;
    locked: number;
}

// live instrumentation hook: every steering decision emits (incentive, flipped)
type SteerObs = (incentive: number, flipped: number) => void;
let steerObs: SteerObs | null = null;
export function setSteerObserver(fn: SteerObs | null) {
    steerObs = fn;
}

// one market's mutable book, settled against the shared pool
interface MS {
    flow: Flow;
    prices: number[];
    outcome: 0 | 1;
    open: Pos[];
    notYes: number;
    notNo: number;
    lots: Lot[];
    hedgeNotional: number;
    hedgeSide: Side;
    realizedHedge: number;
    imbHist: number[]; // signed imbalance fraction per step, for lagged steering
    bi: number;
    sumImb: number;
    sumTot: number;
    rateN: number;
    rateSum: number;
    rateSumSq: number;
    cutSum: number;
    cutN: number;
    m: Metrics;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const other = (s: Side): Side => (s === "yes" ? "no" : "yes");
const move = (side: Side, from: number, to: number) => (side === "yes" ? to - from : from - to);
const loseProb = (side: Side, p: number) => (side === "yes" ? 1 - p : p);
const loseDist = (side: Side, p: number) => (side === "yes" ? p : 1 - p);

function expectedShortfall(side: Side, stake: number, lev: number, p: number): number {
    const shortfall = Math.max(0, stake * lev * loseDist(side, p) - stake);
    return loseProb(side, p) * shortfall;
}

// borrow rate from an imbalance signal (which may be stale under lagged steering)
function rateFromImb(policy: Policy, side: Side, imbFrac: number): number {
    if (policy.rateMode === "fullPremium") return 0;
    if (policy.rateMode === "flat") return policy.baseRateAnnual;
    const pressure = side === "yes" ? imbFrac : -imbFrac;
    const r = policy.baseRateAnnual * (1 + policy.dynamicK * pressure);
    return clamp(r, policy.rebateFloorAnnual, policy.rateCapAnnual);
}

function emptyMetrics(): Metrics {
    return {
        attempts: 0, positions: 0, rejected: 0, liquidated: 0, deleveraged: 0,
        sumCostPctStake: 0, sumCostAnnual: 0, badDebt: 0, income: 0, hedgeSpend: 0,
        maxDrawdown: 0, endingTreasury: 0, insolvent: false, lockedPeak: 0, payoutCutPct: 0,
        peakNaked: 0, rateStd: 0, maxLoss: 0, peakOI: 0,
    };
}

// build a market's flow + price path; optional jump override drives correlation
function createMarket(rng: Rng, cfg: SimConfig, regime: Regime, jumpSize?: number): MS {
    const flow = genFlow(rng, cfg, regime);
    if (jumpSize !== undefined && flow.jump) flow.jump.size = jumpSize;
    const path = buildPath(rng, cfg.steps, flow.market.p0, flow.market.vol, flow.jump);
    return {
        flow, prices: path.prices, outcome: path.outcome,
        open: [], notYes: 0, notNo: 0,
        lots: [], hedgeNotional: 0, hedgeSide: "no", realizedHedge: 0,
        imbHist: [], bi: 0, sumImb: 0, sumTot: 0,
        rateN: 0, rateSum: 0, rateSumSq: 0, cutSum: 0, cutN: 0,
        m: emptyMetrics(),
    };
}

const msHedgeMtm = (ms: MS, p: number) =>
    ms.realizedHedge + ms.lots.reduce((a, l) => a + l.d * move(l.side, l.p, p), 0);

function closePos(ms: MS, policy: Policy, cfg: SimConfig, shared: Shared, pos: Pos, p: number, tf: number) {
    pos.realized += pos.notional * move(pos.side, pos.entry, p);
    if (pos.side === "yes") ms.notYes -= pos.notional;
    else ms.notNo -= pos.notional;
    if (policy.selfHedgeEvery) shared.locked -= pos.stake * pos.lev0 * (policy.fullCollateralBps / 1e4);
    pos.notional = 0;
    pos.closed = true;

    const interest = (pos.lev0 - 1) * pos.stake * pos.rate * (cfg.marketDays / 365) * Math.max(0, tf - pos.openT);
    const gross = pos.stake + pos.realized;
    let interestPaid = 0;
    let bd = 0;
    if (gross <= 0) bd = -gross;
    else interestPaid = Math.min(interest, gross);

    shared.capital += interestPaid;
    ms.m.income += interestPaid;

    if (bd > 0) {
        const curNaked = clamp(Math.abs(ms.notYes - ms.notNo) / (ms.notYes + ms.notNo + 1e-9), 0, 1);
        let eff = bd;
        if (policy.netting) eff = bd * curNaked; // matched book self-collateralizes
        if (policy.selfHedgeEvery) eff = 0; // each position individually hedged
        ms.m.badDebt += eff;
        shared.capital -= eff;
    }

    const cost = pos.premium + interestPaid;
    const years = Math.max(1 / 365, (tf - pos.openT) * cfg.marketDays / 365);
    ms.m.sumCostPctStake += cost / pos.stake;
    ms.m.sumCostAnnual += cost / pos.stake / years;
}

// advance one market by one step against the shared pool
function stepMarket(ms: MS, s: number, cfg: SimConfig, policy: Policy, rng: Rng, shared: Shared) {
    const p = ms.prices[s];
    const tf = s / cfg.steps;
    const liveImb = (ms.notYes - ms.notNo) / (ms.notYes + ms.notNo + 1e-9);
    ms.imbHist[s] = liveImb;
    const steerImb =
        policy.steerLagSteps > 0 ? (ms.imbHist[Math.max(0, s - policy.steerLagSteps)] ?? liveImb) : liveImb;

    while (ms.bi < ms.flow.bets.length && Math.round(ms.flow.bets[ms.bi].t * cfg.steps) <= s) {
        const b = ms.flow.bets[ms.bi++];
        ms.m.attempts++;

        if (policy.midbookOnly && !ms.flow.market.eligible) {
            ms.m.rejected++; ms.cutSum += 1; ms.cutN++;
            continue;
        }

        // steering off the (possibly stale) signal; soft ceiling escalates off the live book.
        // the rebate creates an incentive; only an elasticity-fraction of crowders actually flip.
        let side = b.side;
        const steerPressure = side === "yes" ? steerImb : -steerImb;
        if (policy.rateMode === "dynamic" && steerPressure > 0) {
            let incentive = clamp(policy.dynamicK * steerPressure * 0.5, 0, 0.85);
            const livePressure = side === "yes" ? liveImb : -liveImb;
            if (policy.softCeilingFrac < 1 && livePressure > 0.7 * policy.softCeilingFrac) incentive = Math.max(incentive, 0.95);
            const flipped = rng.bernoulli(incentive * cfg.elasticity);
            if (flipped) side = other(side);
            steerObs?.(incentive, flipped ? 1 : 0);
        }

        const lev = Math.min(b.reqLev, policy.maxLeverage);
        const capped = lev < b.reqLev;
        ms.cutSum += (b.reqLev - lev) / b.reqLev; ms.cutN++;
        const notional = b.stake * lev;

        // refuse crowding opens past the hard cap or the soft ceiling
        const crowding = (side === "yes" && ms.notYes >= ms.notNo) || (side === "no" && ms.notNo >= ms.notYes);
        const ceiling = Math.min(policy.imbalanceCapFrac, policy.softCeilingFrac);
        if (crowding && ceiling < 1) {
            const nY = ms.notYes + (side === "yes" ? notional : 0);
            const nN = ms.notNo + (side === "no" ? notional : 0);
            const floor = 6 * cfg.avgStake * policy.maxLeverage;
            const allowed = Math.max(floor, ceiling * (nY + nN));
            if (Math.abs(nY - nN) > allowed) { ms.m.rejected++; continue; }
        }

        if (policy.selfHedgeEvery) {
            const lock = notional * (policy.fullCollateralBps / 1e4);
            if (shared.locked + lock > shared.capital) { ms.m.rejected++; continue; }
            shared.locked += lock;
            ms.m.lockedPeak = Math.max(ms.m.lockedPeak, shared.locked);
        }

        const rate = rateFromImb(policy, side, steerImb);
        let premium = 0;
        if (policy.pool) premium += notional * (policy.poolPremiumBps / 1e4);
        if (policy.rateMode === "fullPremium") premium += expectedShortfall(side, b.stake, lev, p) * policy.premiumMarginMult;
        if (policy.selfHedgeEvery) premium += notional * (policy.hedgeCostBps / 1e4);
        shared.capital += premium;
        ms.m.income += premium;
        if (policy.rateMode === "dynamic") { ms.rateN++; ms.rateSum += rate; ms.rateSumSq += rate * rate; }

        ms.open.push({ side, stake: b.stake, lev0: lev, notional, entry: p, openT: tf, rate, premium, realized: 0, deleveraged: false, closed: false });
        ms.m.positions++;
        if (capped) ms.m.rejected++;
        if (side === "yes") ms.notYes += notional; else ms.notNo += notional;
    }

    for (const pos of ms.open) {
        if (pos.closed) continue;
        if (policy.deleverageCliff && tf >= policy.cliffStart && pos.lev0 > 1) {
            const prog = clamp((tf - policy.cliffStart) / (1 - policy.cliffStart), 0, 1);
            const targetNot = pos.stake * (1 + (pos.lev0 - 1) * (1 - prog));
            if (pos.notional > targetNot + 1e-9) {
                const dN = pos.notional - targetNot;
                pos.realized += dN * move(pos.side, pos.entry, p);
                if (pos.side === "yes") ms.notYes -= dN; else ms.notNo -= dN;
                pos.notional = targetNot;
                if (!pos.deleveraged) { pos.deleveraged = true; ms.m.deleveraged++; }
            }
        }
        const eq = pos.stake + pos.realized + pos.notional * move(pos.side, pos.entry, p) - (pos.lev0 - 1) * pos.stake * pos.rate * (cfg.marketDays / 365) * Math.max(0, tf - pos.openT);
        if (eq < policy.maintenanceMargin * pos.notional) {
            closePos(ms, policy, cfg, shared, pos, p, tf);
            ms.m.liquidated++;
        }
    }

    if (policy.hedgeResidual) {
        const target = Math.abs(ms.notYes - ms.notNo);
        const wantSide: Side = ms.notYes >= ms.notNo ? "no" : "yes";
        if (wantSide !== ms.hedgeSide) { reduceHedge(ms, ms.hedgeNotional, p); ms.hedgeSide = wantSide; }
        if (target > ms.hedgeNotional) {
            const d = target - ms.hedgeNotional;
            ms.lots.push({ side: ms.hedgeSide, d, p });
            ms.hedgeNotional = target;
            const spend = d * (policy.hedgeCostBps / 1e4);
            ms.m.hedgeSpend += spend; shared.capital -= spend;
        } else if (target < ms.hedgeNotional) {
            reduceHedge(ms, ms.hedgeNotional - target, p);
        }
    }

    ms.sumImb += Math.abs(ms.notYes - ms.notNo);
    ms.sumTot += ms.notYes + ms.notNo;
}

function reduceHedge(ms: MS, amount: number, p: number) {
    let left = amount;
    while (left > 1e-9 && ms.lots.length) {
        const lot = ms.lots[0];
        const take = Math.min(lot.d, left);
        ms.realizedHedge += take * move(lot.side, lot.p, p);
        lot.d -= take;
        left -= take;
        if (lot.d <= 1e-9) ms.lots.shift();
    }
    ms.hedgeNotional = Math.max(0, ms.hedgeNotional - amount);
}

function settleMarket(ms: MS, cfg: SimConfig, policy: Policy, shared: Shared) {
    for (const pos of ms.open) if (!pos.closed) closePos(ms, policy, cfg, shared, pos, ms.outcome, 1);
    shared.capital += msHedgeMtm(ms, ms.outcome);
}

// mark the pool (incl. each market's unrealized hedge) for drawdown / insolvency
function markPool(markets: MS[], shared: Shared, s: number) {
    let marked = shared.capital;
    let oi = 0;
    for (const ms of markets) {
        marked += msHedgeMtm(ms, ms.prices[s]);
        oi += ms.notYes + ms.notNo;
    }
    shared.peak = Math.max(shared.peak, marked);
    shared.maxDD = Math.max(shared.maxDD, shared.peak - marked);
    shared.minMarked = Math.min(shared.minMarked, marked);
    shared.peakOI = Math.max(shared.peakOI, oi);
    if (marked < 0) shared.insolvent = true;
}

// final mark after settlement (resolution can be the worst point)
function markFinal(shared: Shared) {
    shared.peak = Math.max(shared.peak, shared.capital);
    shared.maxDD = Math.max(shared.maxDD, shared.peak - shared.capital);
    shared.minMarked = Math.min(shared.minMarked, shared.capital);
    if (shared.capital < 0) shared.insolvent = true;
}

// roll up per-market tallies + pool outcome into one Metrics
function finalize(markets: MS[], shared: Shared): Metrics {
    const m = emptyMetrics();
    let imb = 0, tot = 0, rN = 0, rSum = 0, rSumSq = 0, cutSum = 0, cutN = 0;
    for (const ms of markets) {
        m.attempts += ms.m.attempts;
        m.positions += ms.m.positions;
        m.rejected += ms.m.rejected;
        m.liquidated += ms.m.liquidated;
        m.deleveraged += ms.m.deleveraged;
        m.sumCostPctStake += ms.m.sumCostPctStake;
        m.sumCostAnnual += ms.m.sumCostAnnual;
        m.badDebt += ms.m.badDebt;
        m.income += ms.m.income;
        m.hedgeSpend += ms.m.hedgeSpend;
        imb += ms.sumImb; tot += ms.sumTot;
        rN += ms.rateN; rSum += ms.rateSum; rSumSq += ms.rateSumSq;
        cutSum += ms.cutSum; cutN += ms.cutN;
    }
    m.maxDrawdown = shared.maxDD;
    m.endingTreasury = shared.capital;
    m.insolvent = shared.insolvent || shared.capital < 0;
    m.lockedPeak = Math.max(...markets.map(ms => ms.m.lockedPeak), 0);
    m.peakNaked = tot > 0 ? imb / tot : 0;
    m.payoutCutPct = cutN ? cutSum / cutN : 0;
    m.rateStd = rN ? Math.sqrt(Math.max(0, rSumSq / rN - (rSum / rN) ** 2)) : 0;
    m.maxLoss = Math.max(0, shared.capital0 - shared.minMarked);
    m.peakOI = shared.peakOI;
    return m;
}

function newShared(capital0: number): Shared {
    return { capital0, capital: capital0, peak: capital0, maxDD: 0, minMarked: capital0, peakOI: 0, insolvent: false, locked: 0 };
}

// single market
export function runOne(rng: Rng, cfg: SimConfig, policy: Policy, regime: Regime): Metrics {
    const shared = newShared(cfg.treasurySeed + (policy.pool ? cfg.poolSeed : 0));
    const ms = createMarket(rng, cfg, regime);
    for (let s = 0; s <= cfg.steps; s++) {
        stepMarket(ms, s, cfg, policy, rng, shared);
        markPool([ms], shared, s);
    }
    settleMarket(ms, cfg, policy, shared);
    markFinal(shared);
    return finalize([ms], shared);
}

// K correlated markets sharing one pool. corr in [0,1] blends a common jump factor.
export function runPortfolio(
    rng: Rng,
    cfg: SimConfig,
    policy: Policy,
    regime: Regime,
    k: number,
    corr: number,
): Metrics {
    const shared = newShared(cfg.treasurySeed + (policy.pool ? cfg.poolSeed : 0));
    const common = cfg.jumpSize;
    const markets: MS[] = [];
    for (let i = 0; i < k; i++) {
        const idio = rng.uniform(0.6, 1.4) * cfg.jumpSize;
        const size = clamp(corr * common + (1 - corr) * idio, 0, 0.9);
        markets.push(createMarket(rng, cfg, regime, size));
    }
    for (let s = 0; s <= cfg.steps; s++) {
        for (const ms of markets) stepMarket(ms, s, cfg, policy, rng, shared);
        markPool(markets, shared, s);
    }
    for (const ms of markets) settleMarket(ms, cfg, policy, shared);
    markFinal(shared);
    return finalize(markets, shared);
}
