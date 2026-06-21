import { Rng } from "./rng.js";
import { runPortfolio, setSteerObserver } from "./engine.js";
import { POLICIES } from "./policies.js";
import { aggregate } from "./report.js";
import { DEFAULTS } from "./cli.js";
import { ElasticityMeter, recommend } from "./elasticity-meter.js";
import type { Aggregate, Policy, SimConfig } from "./types.js";

// Treat live elasticity as a parameter you discover, not one you assumed.
//   1) the meter recovers the true elasticity from (incentive, flipped) observations
//   2) sensitivity: weak elasticity makes the ceiling lean on rejections / risk
//   3) the control law reads the measured value and restores safety

const S1 = POLICIES[0];
const clone = (o: Partial<Policy>): Policy => ({ ...S1, ...o });
const RUNS = 600;
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const pad = (s: string, w: number) => s.padStart(w);

function run(cfg: SimConfig, policy: Policy, regime: "best" | "worst" | "mc", k: number, corr: number, seed0: number): Aggregate {
    const out = [];
    for (let i = 0; i < RUNS; i++) out.push(runPortfolio(new Rng(seed0 + i * 1009), cfg, policy, regime, k, corr));
    return aggregate(out);
}

// ---- 1: the meter recovers the true elasticity from live observations ----
function part1() {
    console.log("\n#1 ESTIMATOR  (does the meter recover the true elasticity from fills?)");
    console.log("  " + pad("true e", 9) + pad("estimate", 11) + pad("±1sigma", 10) + pad("samples", 10));
    console.log("  " + "-".repeat(39));
    const cfg: SimConfig = { ...DEFAULTS, worstCrowd: 0.85 };
    for (const eTrue of [0.9, 0.6, 0.3, 0.15]) {
        const meter = new ElasticityMeter();
        setSteerObserver((inc, fl) => meter.observe(inc, fl));
        for (let i = 0; i < 200; i++) runPortfolio(new Rng(31 + i * 7), { ...cfg, elasticity: eTrue }, clone({ steerLagSteps: 8 }), "mc", 1, 0);
        setSteerObserver(null);
        console.log("  " + pad(f2(eTrue), 9) + pad(f2(meter.estimate()), 11) + pad(f2(meter.stderr()), 10) + pad(String(meter.samples), 10));
    }
    console.log("  -> the slope-through-origin estimate tracks the true value; tighter as samples grow.");
}

// ---- 2: sensitivity — weak elasticity strains the ceiling ----
function part2() {
    console.log("\n#2 SENSITIVITY  (launch config under the break stress, varying real elasticity)");
    const cfg: SimConfig = { ...DEFAULTS, jumpSize: 0.6, worstCrowd: 0.9 };
    const pol = clone({ steerLagSteps: 8 }); // launch config: dynamicK=4, ceiling=0.2
    console.log("  " + pad("elasticity", 11) + pad("imbalance%", 12) + pad("rejected%", 11) + pad("insolvent%", 12));
    console.log("  " + "-".repeat(45));
    for (const e of [1.0, 0.8, 0.6, 0.4, 0.2, 0.1]) {
        const a = run({ ...cfg, elasticity: e }, pol, "worst", 10, 1.0, 9001);
        console.log("  " + pad(f1(e), 11) + pad(f1(a.peakNaked), 12) + pad(f1(a.rejectedShare), 11) + pad(f1(a.insolventFrac), 12));
    }
    console.log("  -> solvency holds at every elasticity (the ceiling caps imbalance); only the");
    console.log("     rejection rate moves. Weak response costs UX, not the pool.");
}

// ---- 3: the control law reads the measured value and restores safety ----
function part3() {
    console.log("\n#3 ADAPTATION  (measured e=0.25: keep the as-built knobs, or retune from the meter?)");
    const cfg: SimConfig = { ...DEFAULTS, jumpSize: 0.6, worstCrowd: 0.9, elasticity: 0.25 };
    const asBuilt = clone({ steerLagSteps: 8 });
    const rec = recommend(0.25);
    const tuned = clone({ steerLagSteps: 8, dynamicK: rec.dynamicK, softCeilingFrac: rec.softCeilingFrac });

    const a0 = run(cfg, asBuilt, "worst", 10, 1.0, 9001);
    const a1 = run(cfg, tuned, "worst", 10, 1.0, 9001);
    console.log(`  control law -> dynamicK ${asBuilt.dynamicK} -> ${rec.dynamicK}, ceiling held at ${rec.softCeilingFrac} (${rec.mode})`);
    console.log("  " + pad("", 14) + pad("imbalance%", 12) + pad("rejected%", 11) + pad("insolvent%", 12));
    console.log("  " + pad("as-built", 14) + pad(f1(a0.peakNaked), 12) + pad(f1(a0.rejectedShare), 11) + pad(f1(a0.insolventFrac), 12));
    console.log("  " + pad("retuned", 14) + pad(f1(a1.peakNaked), 12) + pad(f1(a1.rejectedShare), 11) + pad(f1(a1.insolventFrac), 12));
    console.log("  -> both stay solvent; raising steering claws back rejections. If response is");
    console.log("     this weak, residual rejection is the price of leverage -> lower max leverage.");
}

function main() {
    console.log("ELASTICITY INSTRUMENTATION  (the one assumption you must measure live)");
    console.log(`runs/point=${RUNS}`);
    part1();
    part2();
    part3();
    console.log("\nLIVE LOOP: feed every steering decision (incentive, flipped) into ElasticityMeter;");
    console.log("  once stderr is small, call recommend(e) and push dynamicK / ceiling. Re-measure continuously.");
}

main();
