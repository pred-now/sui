import type Redis from "ioredis";
import type { Side } from "./quote";

// leverage-engine knobs, from the PRED_ECON launch config (validated in the sim)
export const LEV = {
    base: 0.1, // base annualized borrow rate
    dynamicK: 4, // steering strength, the main safety dial
    softCeiling: 0.2, // max |leverage imbalance| fraction
    maxLeverage: 5,
    maintenance: 0.07, // liquidate at 7% equity / position value
    poolToOI: 0.14, // pool >= 0.14 x leveraged OI  =>  OI <= pool / 0.14
    rebateFloor: -0.04, // most a balancing borrower can be paid (annualized)
    rateCap: 0.6, // max borrow rate
    cliffMs: 60_000, // deleverage cliff: force-close leverage in the final minute before expiry
    liqDelayMs: 30_000, // liquidatable only 30s after the update that crossed it
    pythDivergenceBps: 100, // pause liquidation if oracle vs pyth diverge past this
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// signed leverage imbalance fraction in [-1,1], yes-positive
export function imbalanceFraction(L: number, S: number): number {
    const t = L + S;
    return t > 0 ? (L - S) / t : 0;
}

// borrow rate for a side: the crowded side pays more, the balancing side less (or a rebate)
export function borrowRate(side: Side, L: number, S: number, dynamicK = LEV.dynamicK): number {
    const imb = imbalanceFraction(L, S);
    const pressure = side === "yes" ? imb : -imb;
    return clamp(LEV.base * (1 + dynamicK * pressure), LEV.rebateFloor, LEV.rateCap);
}

// max leveraged open interest a pool can back (the 0.14 capital rule)
export const maxOI = (pool: number) => pool / LEV.poolToOI;

// would this crowding open push the imbalance past the soft ceiling?
// a floor lets a young book seed before the fractional ceiling bites.
export function breachesCeiling(L: number, S: number, side: Side, addNotional: number, floor: number): boolean {
    const L2 = L + (side === "yes" ? addNotional : 0);
    const S2 = S + (side === "no" ? addNotional : 0);
    const allowed = Math.max(floor, LEV.softCeiling * (L2 + S2));
    return Math.abs(L2 - S2) > allowed;
}

// per-market interest accrual: rate is annual, span in ms
export function accrueInterest(borrowed: number, rate: number, ms: number): number {
    const years = ms / (365 * 24 * 60 * 60 * 1000);
    return borrowed * rate * years;
}

// current value per contract for a side, off the oracle fair probability
export const markFor = (side: Side, fairYes: number) => (side === "yes" ? fairYes : 1 - fairYes);

// the YES probability at which a position liquidates: value*(1-maint) = owed.
// owed = borrowed + accrued fees. null when nothing is borrowed (1x never liquidates).
export function liqYesFor(contracts: number, side: Side, owed: number, unit: number): number | null {
    if (owed <= 0 || contracts <= 0) return null;
    const markLiq = owed / ((1 - LEV.maintenance) * contracts * unit);
    const clamped = Math.min(1, Math.max(0, markLiq));
    return side === "yes" ? clamped : 1 - clamped;
}

// mark a position: value, accrued fees, and equity (value - borrowed - fees)
export function equityOf(
    contracts: number,
    side: Side,
    borrowed: number,
    rate: number,
    feesAccrued: number,
    accruedAt: number,
    fairYes: number,
    now: number,
    unit: number,
): { value: number; fees: number; equity: number } {
    const fees = feesAccrued + accrueInterest(borrowed, rate, now - accruedAt);
    const value = contracts * markFor(side, fairYes) * unit;
    return { value, fees, equity: value - borrowed - fees };
}

// the steering dial is tuned live by the elasticity control loop
const dynamicKKey = "lev:dynamicK";
export async function getDynamicK(redis: Redis): Promise<number> {
    const v = await redis.get(dynamicKKey);
    return v ? Number(v) : LEV.dynamicK;
}
export async function setDynamicK(redis: Redis, k: number): Promise<void> {
    await redis.set(dynamicKKey, String(k));
}
