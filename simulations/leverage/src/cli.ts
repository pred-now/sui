import type { SimConfig } from "./types.js";

export interface Args {
    cfg: SimConfig;
    scenario: string; // policy key, leading digit, or "all"
}

export const DEFAULTS: SimConfig = {
    runs: 400,
    bets: 300,
    steps: 200,
    marketDays: 2,
    seed: 12345,
    vol: 0.04,
    avgStake: 100,
    maxReqLev: 5,
    treasurySeed: 6000, // sized near one market's tail risk so insolvency discriminates
    poolSeed: 2000,
    midbookFrac: 0.6,
    jumpSize: 0.5,
    jumpAt: 0.94,
    worstCrowd: 0.9,
    elasticity: 1, // optimistic until measured live; sweep it in src/elasticity.ts
};

const NUM_KEYS = Object.keys(DEFAULTS) as (keyof SimConfig)[];

// every knob is a --flag; --scenario picks one policy or "all"
export function parseArgs(argv: string[]): Args {
    const cfg = { ...DEFAULTS };
    let scenario = "all";
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) continue;
        const key = a.slice(2);
        const val = argv[++i];
        if (key === "scenario") {
            scenario = val ?? "all";
        } else if ((NUM_KEYS as string[]).includes(key)) {
            cfg[key as keyof SimConfig] = Number(val);
        } else {
            console.error(`unknown arg --${key}`);
        }
    }
    return { cfg, scenario };
}
