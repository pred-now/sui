import type { Policy } from "./types.js";

// shared defaults; each scenario overrides what it changes
const base: Omit<Policy, "key" | "title" | "blurb"> = {
    maxLeverage: 5,
    netting: true,
    rateMode: "flat",
    baseRateAnnual: 0.12,
    dynamicK: 0,
    rebateFloorAnnual: 0,
    rateCapAnnual: 0.6,
    hedgeResidual: false,
    selfHedgeEvery: false,
    hedgeCostBps: 25,
    pool: true,
    poolPremiumBps: 25,
    imbalanceCapFrac: 1, // no cap
    maintenanceMargin: 0.06,
    deleverageCliff: true,
    cliffStart: 0.9,
    midbookOnly: false,
    fullCollateralBps: 0,
    premiumMarginMult: 1,
    steerLagSteps: 0,
    softCeilingFrac: 1, // off by default
};

// ordered best-UX -> worst-UX
export const POLICIES: Policy[] = [
    {
        ...base,
        key: "1-netting-dynamic-hedge",
        title: "Netting + dynamic steering + residual hedge",
        blurb: "Best UX. Free matched loans, rate steers imbalance, vault hedges the leftover.",
        rateMode: "dynamic",
        baseRateAnnual: 0.08,
        dynamicK: 4, // locked by the steering sweep (npm run harden)
        rebateFloorAnnual: -0.04, // balancers can be paid to balance
        rateCapAnnual: 0.6,
        hedgeResidual: true,
        poolPremiumBps: 12,
        softCeilingFrac: 0.2, // rare backstop sized from the stress test
    },
    {
        ...base,
        key: "2-netting-flat-pool",
        title: "Netting + flat low rate + cliff + pool",
        blurb: "One flat rate, no active hedge, insurance pool soaks the leftover imbalance.",
        rateMode: "flat",
        baseRateAnnual: 0.12,
        poolPremiumBps: 45, // pool works harder without a hedge
    },
    {
        ...base,
        key: "3-twox-cap",
        title: "2x cap + netting + flat premium",
        blurb: "Low cap shrinks worst-case loss; user gives up max payout.",
        maxLeverage: 2,
        baseRateAnnual: 0.1,
        poolPremiumBps: 22,
    },
    {
        ...base,
        key: "4-hard-imbalance-cap",
        title: "Hard imbalance caps",
        blurb: "Refuse crowding opens past a cap; bounds bad debt, adds friction.",
        baseRateAnnual: 0.12,
        imbalanceCapFrac: 0.25,
        poolPremiumBps: 28,
    },
    {
        ...base,
        key: "5-midbook-only",
        title: "Leverage only on high-frequency midbook markets",
        blurb: "Allow leverage only on fast near-50/50 markets; refuse longshots/long-dated.",
        baseRateAnnual: 0.12,
        midbookOnly: true,
        poolPremiumBps: 22,
    },
    {
        ...base,
        key: "6-per-position-premium",
        title: "Per-position full premium, no netting",
        blurb: "Worst-UX cost baseline. Every position prepays its full expected shortfall.",
        netting: false,
        rateMode: "fullPremium",
        baseRateAnnual: 0,
        pool: false,
        poolPremiumBps: 0,
        premiumMarginMult: 1.5,
    },
    {
        ...base,
        key: "7-self-hedge-every",
        title: "Pred self-hedges every position, near-full collateral",
        blurb: "Worst UX. Max safety: 2x cap, full hedge cost on the user, treasury locked.",
        maxLeverage: 2,
        netting: false,
        rateMode: "flat",
        baseRateAnnual: 0.1,
        selfHedgeEvery: true,
        hedgeCostBps: 120,
        pool: false,
        poolPremiumBps: 0,
        maintenanceMargin: 0.1,
        cliffStart: 0.85,
        fullCollateralBps: 9000, // 90% of notional locked from treasury
    },
];

export function findPolicy(key: string): Policy | undefined {
    return POLICIES.find(p => p.key === key || p.key.startsWith(key + "-") || p.key[0] === key);
}
