import type Redis from "ioredis";
import { LEV } from "./leverage";
import { getLevOI } from "./levbook";
import { getLedger, setLedger, available } from "./ledger";

// LP risk-capital vault config (governance tunable). poolToOI is shared with the leverage engine.
export const POOL = {
    stakerShare: 0.75, // fraction of fees to stakers, the rest to the protocol
    unstakeCooldownMs: 24 * 60 * 60 * 1000, // request -> cooldown -> claim
    marginLowFrac: 0.2, // below this hot/assets fraction, pull from Margin (mainnet only)
    marginHighFrac: 0.4, // above this, supply the excess to Margin (mainnet only)
};

// the platform's own first-loss shares, seeded at genesis from the existing reserve
export const PLATFORM = "platform";

export interface PoolState {
    assets: number; // total pool assets, usd base units (NAV numerator)
    shares: number; // total shares outstanding
    protocol: number; // protocol's accumulated cut, usd base units
    hot: number; // liquid assets held by Pred (backs risk + redemptions)
    supplied: number; // assets supplied to DeepBook Margin, mainnet only
    updatedAt: number;
}

interface Claim {
    shares: number;
    requestedAt: number;
}

const ZERO: PoolState = { assets: 0, shares: 0, protocol: 0, hot: 0, supplied: 0, updatedAt: 0 };
const STATE = "pool:state";
const STAKERS = "pool:stakers";
const GENESIS = "pool:genesis";
const sharesKey = (u: string) => `pool:shares:${u}`;
const claimKey = (u: string) => `pool:claim:${u}`;
const evtKey = (id: string) => `poolEvt:${id}`;

// serialize every pool mutation in this process (single writer, matches the engine's model)
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.catch(() => {}).then(fn);
    chain = next.catch(() => {});
    return next;
}

export async function getPool(redis: Redis): Promise<PoolState> {
    const raw = await redis.get(STATE);
    return raw ? { ...ZERO, ...(JSON.parse(raw) as Partial<PoolState>) } : { ...ZERO };
}
async function setPool(redis: Redis, p: PoolState): Promise<void> {
    p.updatedAt = Date.now();
    await redis.set(STATE, JSON.stringify(p));
}

// NAV helpers. first deposit is 1:1, then shares track assets.
export const sharePrice = (p: PoolState) => (p.shares > 0 ? p.assets / p.shares : 1);
export const sharesForDeposit = (p: PoolState, amount: number) =>
    p.shares === 0 || p.assets === 0 ? amount : Math.floor((amount * p.shares) / p.assets);
export const assetsForShares = (p: PoolState, shares: number) =>
    p.shares === 0 ? 0 : Math.floor((shares * p.assets) / p.shares);

export async function getShares(redis: Redis, userId: string): Promise<number> {
    return Number((await redis.get(sharesKey(userId))) ?? 0);
}
export async function getClaim(redis: Redis, userId: string): Promise<Claim | null> {
    const raw = await redis.get(claimKey(userId));
    return raw ? (JSON.parse(raw) as Claim) : null;
}

// the 0.14 capital rule, shared with the leverage engine (rounded to base units)
export const requiredCapital = (leveragedOI: number) => Math.round(LEV.poolToOI * leveragedOI);
export async function freeCapital(redis: Redis): Promise<number> {
    const p = await getPool(redis);
    const oi = await getLevOI(redis);
    return Math.max(0, p.assets - requiredCapital(oi));
}

// seed the pool from the platform's existing reserve so capacity is continuous from day one
export async function genesis(redis: Redis, seedAssets: number): Promise<void> {
    return serialized(async () => {
        const fresh = await redis.set(GENESIS, "1", "NX");
        if (!fresh) return;
        const p = await getPool(redis);
        if (p.shares > 0) return;
        const seed = Math.max(0, Math.round(seedAssets));
        await setPool(redis, { assets: seed, shares: seed, protocol: 0, hot: seed, supplied: 0, updatedAt: Date.now() });
        await redis.set(sharesKey(PLATFORM), String(seed));
        await redis.sadd(STAKERS, PLATFORM);
    });
}

// stake idle ledger balance into the pool, minting shares
export async function stake(redis: Redis, userId: string, amount: number): Promise<{ shares: number; sharePrice: number }> {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("bad amount");
    return serialized(async () => {
        const l = await getLedger(redis, userId);
        if (available(l) < amount) throw new Error("insufficient balance");
        const p = await getPool(redis);
        const minted = sharesForDeposit(p, amount);
        if (minted <= 0) throw new Error("amount too small");
        l.balance -= amount;
        await setLedger(redis, userId, l);
        p.assets += amount;
        p.shares += minted;
        p.hot += amount;
        await setPool(redis, p);
        await redis.set(sharesKey(userId), String((await getShares(redis, userId)) + minted));
        await redis.sadd(STAKERS, userId);
        return { shares: minted, sharePrice: sharePrice(p) };
    });
}

// request to unstake: moves shares into a pending claim that waits out the cooldown
export async function requestUnstake(redis: Redis, userId: string, shares: number): Promise<Claim> {
    if (!Number.isFinite(shares) || shares <= 0) throw new Error("bad shares");
    return serialized(async () => {
        const cur = await getShares(redis, userId);
        if (cur < shares) throw new Error("insufficient shares");
        const existing = await getClaim(redis, userId);
        const claim: Claim = { shares: (existing?.shares ?? 0) + shares, requestedAt: Date.now() };
        await redis.set(sharesKey(userId), String(cur - shares));
        await redis.set(claimKey(userId), JSON.stringify(claim));
        return claim;
    });
}

// claim a matured unstake. re-checks the capital rule at claim time and pays at most free + hot.
export async function claim(redis: Redis, userId: string): Promise<{ amount: number; remainingShares: number }> {
    return serialized(async () => {
        const c = await getClaim(redis, userId);
        if (!c) throw new Error("no pending unstake");
        if (Date.now() - c.requestedAt < POOL.unstakeCooldownMs) throw new Error("cooldown not elapsed");
        const p = await getPool(redis);
        const oi = await getLevOI(redis);
        const free = Math.max(0, p.assets - requiredCapital(oi));
        const grossOut = assetsForShares(p, c.shares);
        const payable = Math.max(0, Math.min(grossOut, free, p.hot));
        if (payable <= 0) throw new Error("capital backing open risk, try again later");
        const burn = grossOut > 0 ? Math.floor((c.shares * payable) / grossOut) : c.shares;
        p.assets -= payable;
        p.shares -= burn;
        p.hot -= payable;
        await setPool(redis, p);
        const l = await getLedger(redis, userId);
        l.balance += payable;
        await setLedger(redis, userId, l);
        const remainingShares = c.shares - burn;
        if (remainingShares > 0) await redis.set(claimKey(userId), JSON.stringify({ shares: remainingShares, requestedAt: c.requestedAt }));
        else await redis.del(claimKey(userId));
        return { amount: payable, remainingShares };
    });
}

// a realized fee: stakers' cut raises NAV, the rest accrues to the protocol. idempotent on id.
export async function creditFee(redis: Redis, fee: number, id: string): Promise<boolean> {
    if (!(fee > 0)) return false;
    return serialized(async () => {
        const fresh = await redis.set(evtKey(id), "1", "NX");
        if (!fresh) return false;
        const p = await getPool(redis);
        const stakerCut = Math.floor(fee * POOL.stakerShare);
        p.assets += stakerCut;
        p.hot += stakerCut;
        p.protocol += fee - stakerCut;
        await setPool(redis, p);
        return true;
    });
}

// a realized loss the pool covers: lowers NAV for every staker pro rata. idempotent on id.
export async function debitLoss(redis: Redis, loss: number, id: string): Promise<boolean> {
    if (!(loss > 0)) return false;
    return serialized(async () => {
        const fresh = await redis.set(evtKey(id), "1", "NX");
        if (!fresh) return false;
        const p = await getPool(redis);
        p.assets = Math.max(0, p.assets - loss);
        p.hot = Math.max(0, p.hot - loss);
        await setPool(redis, p);
        return true;
    });
}

// move funds between hot and supplied via water marks (mainnet Margin only). caller does the chain tx.
export async function rebalanceMargin(redis: Redis, supplyDelta: number): Promise<void> {
    return serialized(async () => {
        const p = await getPool(redis);
        const d = Math.round(supplyDelta);
        if (d > 0) {
            const move = Math.min(d, p.hot);
            p.hot -= move;
            p.supplied += move;
        } else if (d < 0) {
            const move = Math.min(-d, p.supplied);
            p.supplied -= move;
            p.hot += move;
        }
        await setPool(redis, p);
    });
}
