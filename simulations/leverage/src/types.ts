export type Side = "yes" | "no";
export type Regime = "best" | "worst" | "mc";
export type RateMode = "dynamic" | "flat" | "fullPremium";

// A leverage bad-debt strategy. Every knob a scenario needs lives here.
export interface Policy {
    key: string;
    title: string;
    blurb: string;
    maxLeverage: number; // hard leverage cap
    netting: boolean; // net leveraged longs against shorts
    rateMode: RateMode; // how the borrow charge is computed
    baseRateAnnual: number; // baseline annualized borrow rate
    dynamicK: number; // steering sensitivity to imbalance (0 = no steer)
    rebateFloorAnnual: number; // min annual rate, can be < 0 (rebate) for balancers
    rateCapAnnual: number; // max annual rate for the crowded side
    hedgeResidual: boolean; // hedge the leftover naked imbalance from the vault
    selfHedgeEvery: boolean; // hedge every position fully (max safety)
    hedgeCostBps: number; // cost per unit notional to put on / rebalance a hedge
    pool: boolean; // premium-funded insurance pool absorbs bad debt
    poolPremiumBps: number; // upfront premium (bps of notional) into the pool
    imbalanceCapFrac: number; // reject crowding opens past this |imb|/volume (1 = none)
    maintenanceMargin: number; // liquidate when equity/notional < this
    deleverageCliff: boolean; // force-deleverage before resolution
    cliffStart: number; // time fraction to begin the deleverage cliff
    midbookOnly: boolean; // refuse leverage on longshot / long-dated markets
    fullCollateralBps: number; // treasury locked per unit notional when self-hedging
    premiumMarginMult: number; // safety multiplier on expected-shortfall premium
    steerLagSteps: number; // steering reacts to imbalance this many steps stale (0 = live)
    softCeilingFrac: number; // soft backstop: ramp steering near it, refuse crowding above it (1 = off)
}

// Global knobs, all CLI-overridable.
export interface SimConfig {
    runs: number; // runs averaged per regime
    bets: number; // leveraged arrivals per run
    steps: number; // time steps over [0,1]
    marketDays: number; // real market duration, for annualizing cost
    seed: number;
    vol: number; // calm per-step logit volatility
    avgStake: number;
    maxReqLev: number; // upper bound of user-requested leverage
    treasurySeed: number;
    poolSeed: number;
    midbookFrac: number; // share of MC markets that are leverage-eligible
    jumpSize: number; // worst-case probability jump magnitude
    jumpAt: number; // time fraction of the worst-case jump
    worstCrowd: number; // crowd share on the hurting side in the worst regime
    elasticity: number; // 0..1 crowder response to the rebate (1 = sim's optimistic assumption)
}

export interface Bet {
    t: number; // arrival time [0,1]
    side: Side;
    stake: number;
    reqLev: number; // requested leverage, before caps
}

// One market instance the flow trades against.
export interface Market {
    p0: number; // starting probability
    eligible: boolean; // midbook & short-dated => leverage allowed under filters
    jumpSize: number; // adverse jump magnitude for this market
    vol: number; // per-step logit volatility for this run
}

// Raw tallies from a single run, aggregated later.
export interface Metrics {
    attempts: number;
    positions: number;
    rejected: number; // rejected or leverage-capped
    liquidated: number;
    deleveraged: number;
    sumCostPctStake: number; // sum of charge/stake over positions
    sumCostAnnual: number; // sum of annualized cost over positions
    badDebt: number;
    income: number; // interest + premium + fees collected
    hedgeSpend: number;
    maxDrawdown: number;
    endingTreasury: number;
    insolvent: boolean;
    lockedPeak: number; // peak treasury capital locked by self-hedging
    payoutCutPct: number; // avg max-payout reduction vs requested leverage
    peakNaked: number; // book-weighted naked-imbalance fraction during the run
    rateStd: number; // stdev of the borrow rate across opens (jumpiness)
    maxLoss: number; // worst cumulative pool loss from start (capital needed to survive)
    peakOI: number; // peak leveraged open interest (sum of open notional)
}

// Mean of Metrics across a regime's runs, plus the insolvency rate.
export interface Aggregate {
    avgBorrowCostPctStake: number;
    avgBorrowCostAnnual: number;
    rejectedShare: number;
    liquidatedShare: number;
    deleveragedShare: number;
    badDebt: number;
    maxDrawdown: number;
    income: number;
    endingTreasury: number;
    insolventFrac: number;
    lockedPeak: number;
    payoutCutPct: number;
    peakNaked: number;
    rateStd: number;
}
