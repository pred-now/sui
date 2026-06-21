import { Rng } from "./rng.js";
import { runPortfolio } from "./engine.js";
import { POLICIES } from "./policies.js";
import { DEFAULTS } from "./cli.js";
import type { Metrics, Policy, SimConfig } from "./types.js";

// The rare insolvency tail is a capital decision, not a code fix. Measure the loss the pool
// must absorb per unit of leveraged open interest, then size the pool so the tail is
// survivable. Output: a ratio you hold as treasury per $1 of leveraged OI.

const S1 = POLICIES[0];
const RUNS = 20000; // large, for tail resolution
const money = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
const pad = (s: string, w: number) => s.padStart(w);

function sample(cfg: SimConfig, policy: Policy, seed0: number): Metrics[] {
    const out: Metrics[] = [];
    for (let i = 0; i < RUNS; i++) out.push(runPortfolio(new Rng(seed0 + i * 1009), cfg, policy, "mc", 1, 0));
    return out;
}

const q = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];

function study(label: string, cfg: SimConfig) {
    const ms = sample(cfg, S1, 5150);
    const losses = ms.map(m => m.maxLoss).sort((a, b) => a - b);
    const ratios = ms.filter(m => m.peakOI > 1).map(m => m.maxLoss / m.peakOI).sort((a, b) => a - b);
    const oi = ms.map(m => m.peakOI).sort((a, b) => a - b);
    const insolvent = (ms.filter(m => m.insolvent).length / ms.length) * 100;

    console.log(`\n  ${label}  (pool seed ${money(cfg.treasurySeed + cfg.poolSeed)}, insolvent ${insolvent.toFixed(2)}%)`);
    console.log("    median peak leveraged OI per market: " + money(q(oi, 0.5)));
    console.log("    " + pad("quantile", 10) + pad("loss", 12) + pad("loss/OI", 10));
    for (const p of [0.5, 0.99, 0.995, 0.999, 0.9999]) {
        console.log("    " + pad("p" + (p * 100).toFixed(p >= 0.999 ? 2 : 1), 10) + pad(money(q(losses, p)), 12) + pad(q(ratios, p).toFixed(3), 10));
    }
    return { r999: q(ratios, 0.999), medOI: q(oi, 0.5), insolvent };
}

function main() {
    console.log("CAPITAL SIZING  (pool per unit of leveraged open interest)");
    console.log(`runs=${RUNS}  launch config, single thin-pool market (k=1, MC incl. black swans)`);

    const normal = study("normal MC", { ...DEFAULTS });
    const stressed = study("nastier MC (jump=0.65)", { ...DEFAULTS, jumpSize: 0.65 });

    const R = Math.ceil(Math.max(normal.r999, stressed.r999) * 100) / 100;
    console.log("\n================ CAPITAL RULE ================");
    console.log(`  hold pool >= ${R} x peak leveraged open interest`);
    console.log(`  i.e. $${R.toFixed(2)} of treasury+pool per $1 of leveraged OI`);
    console.log(`  equivalently, cap leveraged OI at ${(1 / R).toFixed(1)} x the pool`);

    // verify: size the pool to R x typical OI and confirm the tail closes
    const sizedSeed = Math.round(R * stressed.medOI);
    const cfg: SimConfig = { ...DEFAULTS, jumpSize: 0.65, treasurySeed: sizedSeed, poolSeed: 0 };
    const ms = sample(cfg, S1, 5150);
    const ins = (ms.filter(m => m.insolvent).length / ms.length) * 100;
    console.log(`\n  verify: pool = ${R} x median OI = ${money(sizedSeed)} -> insolvency ${ins.toFixed(2)}% (was ${stressed.insolvent.toFixed(2)}% at the $8,000 pool above)`);
}

main();
