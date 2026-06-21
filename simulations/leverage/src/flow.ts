import { Rng } from "./rng.js";
import type { Bet, Market, Regime, Side, SimConfig } from "./types.js";
import type { Jump } from "./market.js";

export interface Flow {
    bets: Bet[];
    market: Market;
    crowdSide: Side; // side users pile onto
    jump: Jump | null; // adverse jump, set against the crowd
}

const other = (s: Side): Side => (s === "yes" ? "no" : "yes");

// Build one run's market and leveraged order flow for a regime.
//   best  = balanced flow, calm prices, no jump
//   worst = one-sided flow, big jump into the side that hurts Pred
//   mc    = randomized everything
export function genFlow(rng: Rng, cfg: SimConfig, regime: Regime): Flow {
    // market type: midbook (eligible) vs longshot/long-dated (ineligible)
    let eligible: boolean;
    let p0: number;
    if (regime === "best") {
        eligible = true;
        p0 = rng.uniform(0.47, 0.53);
    } else if (regime === "worst") {
        eligible = rng.bernoulli(cfg.midbookFrac);
        p0 = eligible ? rng.uniform(0.45, 0.55) : rng.bernoulli(0.5) ? rng.uniform(0.1, 0.2) : rng.uniform(0.8, 0.9);
    } else {
        eligible = rng.bernoulli(cfg.midbookFrac);
        p0 = eligible ? rng.uniform(0.4, 0.6) : rng.bernoulli(0.5) ? rng.uniform(0.08, 0.2) : rng.uniform(0.8, 0.92);
    }
    // longshot / long-dated markets jump harder relative to the exposure window
    const jumpSize = cfg.jumpSize * (eligible ? 0.7 : 1.6);
    const vol = regime === "best" ? cfg.vol * 0.7 : regime === "worst" ? cfg.vol : cfg.vol * rng.uniform(0.6, 1.6);
    const market: Market = { p0, eligible, jumpSize, vol };

    // crowding
    const crowdSide: Side = rng.bernoulli(0.5) ? "yes" : "no";
    const crowdFrac =
        regime === "best" ? 0.5 : regime === "worst" ? cfg.worstCrowd : rng.uniform(0.45, 0.85);

    const bets: Bet[] = [];
    for (let i = 0; i < cfg.bets; i++) {
        const onCrowd = rng.bernoulli(crowdFrac);
        bets.push({
            t: rng.uniform(0, 0.95), // leave room before resolution
            side: onCrowd ? crowdSide : other(crowdSide),
            stake: cfg.avgStake * rng.uniform(0.3, 1.7),
            reqLev: 1 + (cfg.maxReqLev - 1) * rng.next(),
        });
    }
    bets.sort((a, b) => a.t - b.t);

    // the jump goes against the crowd: crowd yes => push toward no, and vice versa
    const dir: -1 | 1 = crowdSide === "yes" ? -1 : 1;
    let jump: Jump | null = null;
    if (regime === "worst") {
        jump = { at: cfg.jumpAt, size: jumpSize, dir };
    } else if (regime === "mc" && rng.bernoulli(0.4)) {
        const swan = rng.bernoulli(0.12) ? 1.7 : 1; // occasional black swan
        jump = { at: rng.uniform(0.7, 0.98), size: Math.min(0.9, jumpSize * rng.uniform(0.5, 1.2) * swan), dir };
    }

    return { bets, market, crowdSide, jump };
}
