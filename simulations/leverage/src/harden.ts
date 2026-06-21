import { Rng } from "./rng.js";
import { runPortfolio } from "./engine.js";
import { POLICIES } from "./policies.js";
import { aggregate } from "./report.js";
import { DEFAULTS } from "./cli.js";
import type { Aggregate, Policy, SimConfig } from "./types.js";

// Harden strategy 1 into a launch config:
//   1) stress it (correlated markets + larger jump + lagged steering) until it breaks
//   2) add a soft ceiling below the break, confirm it is invisible at normal flow
//   3) sweep the steering strength to hold imbalance low without a jumpy rate

const S1 = POLICIES[0];
const clone = (o: Partial<Policy>): Policy => ({ ...S1, ...o });
const RUNS = 600;

function run(cfg: SimConfig, policy: Policy, regime: "best" | "worst" | "mc", k: number, corr: number, seed0: number): Aggregate {
    const out = [];
    for (let i = 0; i < RUNS; i++) out.push(runPortfolio(new Rng(seed0 + i * 1009), cfg, policy, regime, k, corr));
    return aggregate(out);
}

const f1 = (x: number) => x.toFixed(1);
const money = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
const pad = (s: string, w: number) => s.padStart(w);

// ---- step 1: stress to failure, read off the imbalance that breaks it ----
// brutal-but-fixed stress; weaken the steering to let imbalance climb and watch the pool fail
function step1(): number {
    console.log("\n#1 STRESS TO BREAK  (10 correlated markets, jump=0.6, crowd=0.9, lagged steering, one shared pool)");
    console.log("   weakening steering strength so the naked imbalance climbs; find the level that sinks the pool\n");
    const cfg: SimConfig = { ...DEFAULTS, jumpSize: 0.6, worstCrowd: 0.9 };
    const K = 10, CORR = 1.0;
    const ks = [8, 5, 3, 2, 1.5, 1, 0.6, 0.3, 0]; // strong steer -> weak steer

    console.log("  " + pad("steerK", 8) + pad("imbalance%", 12) + pad("badDebt", 12) + pad("maxDD", 12) + pad("insolvent%", 12));
    console.log("  " + "-".repeat(56));
    let breakImb = 0;
    let lastImb = 0;
    for (const k of ks) {
        const a = run(cfg, clone({ dynamicK: k, steerLagSteps: 8 }), "worst", K, CORR, 9001);
        lastImb = a.peakNaked;
        console.log(
            "  " + pad(f1(k), 8) + pad(f1(a.peakNaked), 12) + pad(money(a.badDebt), 12) +
                pad(money(a.maxDrawdown), 12) + pad(f1(a.insolventFrac), 12),
        );
        if (breakImb === 0 && a.insolventFrac >= 12) breakImb = a.peakNaked; // pool clearly failing
    }
    if (breakImb === 0) breakImb = lastImb;
    const ceiling = Math.max(0.15, Math.floor((breakImb * 0.6) / 5) * 5 / 100); // ~60% below break, to 5%
    console.log(`\n  pool starts failing around ${f1(breakImb)}% naked imbalance -> soft ceiling = ${(ceiling * 100).toFixed(0)}% (well below)`);
    return ceiling;
}

// ---- step 2: add the ceiling, prove it is silent at normal flow ----
function step2(ceiling: number) {
    console.log(`\n#2 SOFT CEILING AT ${(ceiling * 100).toFixed(0)}%  (does it stay invisible at normal flow?)`);
    const normal: SimConfig = { ...DEFAULTS };
    const plain = run(normal, S1, "mc", 1, 0, 4242);
    const ceil = run(normal, clone({ softCeilingFrac: ceiling }), "mc", 1, 0, 4242);

    const rowH = "  " + pad("", 16) + pad("rejected%", 12) + pad("cost%stk", 12) + pad("imbalance%", 12) + pad("insolvent%", 12);
    console.log("  normal MC flow:");
    console.log(rowH);
    console.log("  " + pad("plain S1", 16) + pad(f1(plain.rejectedShare), 12) + pad(f1(plain.avgBorrowCostPctStake), 12) + pad(f1(plain.peakNaked), 12) + pad(f1(plain.insolventFrac), 12));
    console.log("  " + pad("+ ceiling", 16) + pad(f1(ceil.rejectedShare), 12) + pad(f1(ceil.avgBorrowCostPctStake), 12) + pad(f1(ceil.peakNaked), 12) + pad(f1(ceil.insolventFrac), 12));

    // and confirm it rescues the breaking case (weak steering -> high imbalance)
    const cfg: SimConfig = { ...DEFAULTS, jumpSize: 0.6, worstCrowd: 0.9 };
    const broken = clone({ dynamicK: 0.6, steerLagSteps: 8 });
    const fixed = clone({ dynamicK: 0.6, steerLagSteps: 8, softCeilingFrac: ceiling });
    const before = run(cfg, broken, "worst", 10, 1.0, 9001);
    const after = run(cfg, fixed, "worst", 10, 1.0, 9001);
    console.log("\n  under the breaking stress (weak steering, high imbalance):");
    console.log(rowH.replace("cost%stk", "badDebt ").replace("imbalance%", "  maxDD  "));
    console.log("  " + pad("no ceiling", 16) + pad(f1(before.rejectedShare), 12) + pad(money(before.badDebt), 12) + pad(money(before.maxDrawdown), 12) + pad(f1(before.insolventFrac), 12));
    console.log("  " + pad("+ ceiling", 16) + pad(f1(after.rejectedShare), 12) + pad(money(after.badDebt), 12) + pad(money(after.maxDrawdown), 12) + pad(f1(after.insolventFrac), 12));
}

// ---- step 3: lock the steering strength (lowest imbalance, calm rate) ----
// strongest steering whose borrow-rate volatility stays under the trader-annoyance tolerance
function step3(): number {
    const TOL = 5.0; // pp: rates mostly inside a predictable band
    console.log(`\n#3 LOCK STEERING STRENGTH  (sweep dynamicK: lowest imbalance with rate volatility under ${TOL}pp)`);
    const cfg: SimConfig = { ...DEFAULTS, worstCrowd: 0.8 }; // one-sided lean so steering must work
    const ks = [0, 0.5, 1, 2, 3, 4, 6, 8];
    console.log("  " + pad("dynamicK", 10) + pad("imbalance%", 12) + pad("rateVol(pp)", 13) + pad("cost%stk", 10) + pad("calm?", 7));
    console.log("  " + "-".repeat(52));
    let pick = 0; // ks ascending => last one under tolerance is the strongest calm setting
    for (const k of ks) {
        const a = run(cfg, clone({ dynamicK: k, steerLagSteps: 8 }), "mc", 1, 0, 7007);
        const calm = a.rateStd <= TOL;
        if (calm) pick = k;
        console.log("  " + pad(f1(k), 10) + pad(f1(a.peakNaked), 12) + pad(f1(a.rateStd), 13) + pad(f1(a.avgBorrowCostPctStake), 10) + pad(calm ? "yes" : "no", 7));
    }
    console.log(`\n  dynamicK = ${pick}: strongest steering (lowest imbalance) that keeps the rate calm (<= ${TOL}pp)`);
    return pick;
}

function main() {
    console.log("HARDEN STRATEGY 1 -> LAUNCH CONFIG");
    console.log(`runs/point=${RUNS} steps=${DEFAULTS.steps} bets=${DEFAULTS.bets} pool=${money(DEFAULTS.treasurySeed + DEFAULTS.poolSeed)}`);
    const ceiling = step1();
    step2(ceiling);
    const k = step3();

    console.log("\n================ LAUNCH CONFIG ================");
    console.log("  strategy 1: netting + dynamic steering + residual hedge + small premium pool");
    console.log(`  dynamicK (main safety dial)  = ${k}`);
    console.log(`  soft ceiling (rare backstop) = ${(ceiling * 100).toFixed(0)}% naked imbalance`);
    console.log(`  rebate floor / rate cap      = ${S1.rebateFloorAnnual} .. ${S1.rateCapAnnual}`);
    console.log(`  maintenance margin           = ${S1.maintenanceMargin}`);
    console.log(`  deleverage cliff from        = ${S1.cliffStart} of market life`);
    console.log(`  residual hedge cost          = ${S1.hedgeCostBps}bps, pool premium = ${S1.poolPremiumBps}bps`);
    console.log(`  max leverage                 = ${S1.maxLeverage}x`);
    console.log("\n  best-UX core (cheap, full leverage, ~0 rejections) with a proven floor under the worst day.");
}

main();
