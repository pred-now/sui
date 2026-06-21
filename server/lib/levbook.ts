import type Redis from "ioredis";
import type { Side } from "./quote";

// per-market leveraged notional (usd) per side, drives borrow-rate steering
export interface LevBook {
    L: number; // leveraged long (YES) notional
    S: number; // leveraged short (NO) notional
    updatedAt: number;
}

// a user's leveraged position. holds contracts bought with margin + borrowed.
export interface LevPosition {
    userId: string;
    oracleId: string;
    strike: number;
    expiry: number;
    side: Side;
    cohort: string; // correlation cohort this notional was reserved against
    contracts: number;
    margin: number; // user collateral, usd base units
    borrowed: number; // pred loan, usd base units
    reservedOI: number; // leveraged notional reserved against the cohort cap (0 for a 1x bet)
    entryAsk: number;
    rate: number; // annual borrow rate
    fees: number; // accrued interest, usd base units
    openedAt: number;
    accruedAt: number;
}

const ZERO_BOOK: LevBook = { L: 0, S: 0, updatedAt: 0 };
const COHORTS = "lev:cohorts";

// markets that resolve on the same event jump together, so the capital rule gates on their
// summed OI. same underlying + expiry is the certain-correlation unit; staggered expiries and
// other assets are independent cohorts that share the pool (their tails do not coincide).
export const cohortOf = (underlying: string, expiry: number) => `${underlying}:${expiry}`;
const cohortKey = (cohort: string) => `lev:oi:${cohort}`;

export const levBookKey = (o: string, s: number) => `levbook:${o}:${s}`;
export const levPosKey = (userId: string, o: string, s: number, side: Side) => `lev:pos:${userId}:${o}:${s}:${side}`;
export const LEV_POSITIONS = "lev:positions"; // global set of position keys (for liquidation)
export const levUserKey = (userId: string) => `lev:user:${userId}`;

export async function getLevBook(redis: Redis, o: string, s: number): Promise<LevBook> {
    const raw = await redis.get(levBookKey(o, s));
    return raw ? { ...ZERO_BOOK, ...(JSON.parse(raw) as Partial<LevBook>) } : { ...ZERO_BOOK };
}
export async function setLevBook(redis: Redis, o: string, s: number, b: LevBook): Promise<void> {
    await redis.set(levBookKey(o, s), JSON.stringify(b));
}

// atomically reserve notional against a cohort's OI cap. INCRBYFLOAT is atomic, so the
// check-after-increment is race free across markets: a loser rolls its own increment back.
export async function reserveCohortOI(redis: Redis, cohort: string, notional: number, maxOI: number): Promise<boolean> {
    await redis.sadd(COHORTS, cohort);
    const after = Number(await redis.incrbyfloat(cohortKey(cohort), notional));
    if (after > maxOI) {
        await redis.incrbyfloat(cohortKey(cohort), -notional);
        return false;
    }
    return true;
}

export async function releaseCohortOI(redis: Redis, cohort: string, notional: number): Promise<void> {
    await redis.incrbyfloat(cohortKey(cohort), -notional);
}

export async function getCohortOI(redis: Redis, cohort: string): Promise<number> {
    return Number((await redis.get(cohortKey(cohort))) ?? 0);
}

// total leveraged OI across cohorts, for reconcile / reporting
export async function getLevOI(redis: Redis): Promise<number> {
    const cohorts = await redis.smembers(COHORTS);
    let sum = 0;
    for (const c of cohorts) sum += await getCohortOI(redis, c);
    return sum;
}

export async function getLevPosition(redis: Redis, userId: string, o: string, s: number, side: Side): Promise<LevPosition | null> {
    const raw = await redis.get(levPosKey(userId, o, s, side));
    return raw ? (JSON.parse(raw) as LevPosition) : null;
}
export async function setLevPosition(redis: Redis, p: LevPosition): Promise<void> {
    const key = levPosKey(p.userId, p.oracleId, p.strike, p.side);
    await redis.set(key, JSON.stringify(p));
    await redis.sadd(LEV_POSITIONS, key);
    await redis.sadd(levUserKey(p.userId), key);
}
export async function delLevPosition(redis: Redis, p: LevPosition): Promise<void> {
    const key = levPosKey(p.userId, p.oracleId, p.strike, p.side);
    await redis.del(key);
    await redis.srem(LEV_POSITIONS, key);
    await redis.srem(levUserKey(p.userId), key);
}
