import { Rng } from "./rng.js";
import { parseArgs } from "./cli.js";
import { POLICIES, findPolicy } from "./policies.js";
import { runOne } from "./engine.js";
import { aggregate, printScenario, printSummary, type SummaryRow } from "./report.js";
import type { Aggregate, Regime } from "./types.js";

const REGIMES: Regime[] = ["best", "worst", "mc"];
const regIdx = (r: Regime) => REGIMES.indexOf(r);

function main() {
    const { cfg, scenario } = parseArgs(process.argv.slice(2));
    const policies =
        scenario === "all"
            ? POLICIES
            : (() => {
                  const p = findPolicy(scenario);
                  if (!p) {
                      console.error(`no scenario "${scenario}". keys: ${POLICIES.map(x => x.key).join(", ")}`);
                      process.exit(1);
                  }
                  return [p];
              })();

    console.log("leverage bad-debt simulation");
    console.log(
        `runs=${cfg.runs} bets=${cfg.bets} steps=${cfg.steps} marketDays=${cfg.marketDays} ` +
            `seed=${cfg.seed} treasury=${cfg.treasurySeed} pool=${cfg.poolSeed}`,
    );

    const summary: SummaryRow[] = [];
    for (const policy of policies) {
        const agg = {} as Record<Regime, Aggregate>;
        for (const reg of REGIMES) {
            const runs = [];
            for (let i = 0; i < cfg.runs; i++) {
                // same seed per (regime, run) across policies => identical flow/paths
                const seed = cfg.seed + regIdx(reg) * 1_000_003 + i * 1009;
                runs.push(runOne(new Rng(seed), cfg, policy, reg));
            }
            agg[reg] = aggregate(runs);
        }
        printScenario(policy, agg.best, agg.worst, agg.mc);
        summary.push({ policy, mc: agg.mc, worst: agg.worst });
    }

    if (summary.length > 1) printSummary(summary);
}

main();
