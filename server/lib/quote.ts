import { ECON } from "./econ";

export type Side = "yes" | "no";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface Quote {
    f: number;
    h: number; // half spread (margin)
    k: number; // steering lean
    yesAsk: number;
    noAsk: number;
}

// half spread h, risk priced. hedgeFloor is the live vault half-spread (>= ECON.hedgeFloor).
export function spread(f: number, T: number, vol: number, velocity: number, hedgeFloor: number): number {
    const floor = Math.max(hedgeFloor, ECON.hedgeFloor);
    const tail = ECON.cTail * (1 / (f * (1 - f)) - 4); // 0 at f=0.5, grows at the tails
    const time = ECON.cTime * (1 - T);
    const unc = ECON.cUnc * vol;
    const vel = ECON.cVel * Math.abs(velocity);
    return floor + tail + time + unc + vel;
}

// steering lean k, bounded by kappa, gentle in the middle, ~max at the band edge.
// positive betImbalance = too much YES on the house, so lift yesAsk to pull NO.
export function lean(betImbalance: number, band: number): number {
    if (band <= 0) return 0;
    return ECON.kappa * Math.tanh((2 * betImbalance) / band);
}

// the two asks. yesAsk + noAsk = 1 + 2h before clamping (the lean cancels).
export function quote(
    f: number,
    T: number,
    vol: number,
    velocity: number,
    hedgeFloor: number,
    betImbalance: number,
    band: number,
): Quote {
    const h = spread(f, T, vol, velocity, hedgeFloor);
    const k = lean(betImbalance, band);
    return { f, h, k, yesAsk: clamp01(f + h + k), noAsk: clamp01(1 - f + h - k) };
}

export const askFor = (q: Quote, side: Side) => (side === "yes" ? q.yesAsk : q.noAsk);
