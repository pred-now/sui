import { Rng } from "./rng.js";

const EPS = 1e-4;

const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface Jump {
    at: number; // time fraction [0,1]
    size: number; // probability delta
    dir: -1 | 1; // +1 pushes toward yes, -1 toward no
}

export interface PricePath {
    prices: number[]; // length steps+1, fair probability over time
    outcome: 0 | 1; // 1 = yes resolves, 0 = no
}

// Fair probability as a logit random walk, with an optional adverse jump,
// then a Bernoulli resolution off the final price.
export function buildPath(
    rng: Rng,
    steps: number,
    p0: number,
    vol: number,
    jump: Jump | null,
): PricePath {
    const prices = new Array<number>(steps + 1);
    let x = logit(clampP(p0));
    prices[0] = clampP(p0);
    const jumpStep = jump ? Math.round(jump.at * steps) : -1;

    for (let i = 1; i <= steps; i++) {
        x += rng.normal(0, vol);
        if (i === jumpStep && jump) {
            const p = clampP(sigmoid(x) + jump.dir * jump.size);
            x = logit(p);
        }
        prices[i] = clampP(sigmoid(x));
    }

    const outcome = rng.bernoulli(prices[steps]) ? 1 : 0;
    return { prices, outcome };
}
