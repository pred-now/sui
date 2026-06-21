import { describe, it, expect } from "@jest/globals";
import {
    getPool, getShares, getClaim, sharePrice, freeCapital,
    genesis, stake, requestUnstake, claim, creditFee, debitLoss, rebalanceMargin, POOL,
} from "../lib/pool";
import { setLedger, getLedger } from "../lib/ledger";
import { LEV } from "../lib/leverage";
import { fakeRedis } from "./fake-redis";

const M = 1_000_000;
async function fund(r: any, userId: string, usd: number) {
    await setLedger(r, userId, { balance: usd * M, locked: 0, debt: 0, fees: 0 });
}
// mature a pending claim by backdating its request past the cooldown
async function mature(r: any, userId: string) {
    const c = await getClaim(r, userId);
    if (c) await r.set(`pool:claim:${userId}`, JSON.stringify({ shares: c.shares, requestedAt: 0 }));
}
// seed a leveraged OI the pool must back
async function setOI(r: any, oi: number) {
    await r.sadd("lev:cohorts", "C");
    await r.set("lev:oi:C", String(oi));
}

describe("pool: shares + NAV", () => {
    it("a deposit then full claim returns the same assets for a sole staker", async () => {
        const r = fakeRedis();
        await fund(r, "u", 100);
        await stake(r, "u", 100 * M);
        const sh = await getShares(r, "u");
        expect(sh).toBe(100 * M);
        expect((await getLedger(r, "u")).balance).toBe(0);

        await requestUnstake(r, "u", sh);
        await mature(r, "u");
        const { amount } = await claim(r, "u");
        expect(amount).toBe(100 * M); // no fees/losses -> exact
        expect((await getLedger(r, "u")).balance).toBe(100 * M);
    });

    it("a fee raises NAV by exactly the staker cut, the rest to the protocol", async () => {
        const r = fakeRedis();
        await fund(r, "u", 100);
        await stake(r, "u", 100 * M);
        await creditFee(r, 40 * M, "f1");
        const p = await getPool(r);
        expect(p.assets).toBe(130 * M); // stakerCut = 0.75 * 40 = 30
        expect(p.protocol).toBe(10 * M);
        expect(sharePrice(p)).toBeCloseTo(1.3, 6);
    });

    it("a loss lowers NAV by exactly the covered amount", async () => {
        const r = fakeRedis();
        await fund(r, "u", 100);
        await stake(r, "u", 100 * M);
        await debitLoss(r, 25 * M, "l1");
        const p = await getPool(r);
        expect(p.assets).toBe(75 * M);
        expect(sharePrice(p)).toBeCloseTo(0.75, 6);
    });

    it("fee and loss are idempotent on the event id", async () => {
        const r = fakeRedis();
        await fund(r, "u", 100);
        await stake(r, "u", 100 * M);
        await creditFee(r, 40 * M, "f1");
        await creditFee(r, 40 * M, "f1"); // replay
        await debitLoss(r, 10 * M, "l1");
        await debitLoss(r, 10 * M, "l1"); // replay
        expect((await getPool(r)).assets).toBe(130 * M - 10 * M);
    });

    it("doubling stake doubles the OI cap (flywheel)", async () => {
        const r = fakeRedis();
        await fund(r, "a", 100);
        await stake(r, "a", 100 * M);
        const cap1 = (await getPool(r)).assets / LEV.poolToOI;
        await fund(r, "b", 100);
        await stake(r, "b", 100 * M);
        const cap2 = (await getPool(r)).assets / LEV.poolToOI;
        expect(cap2).toBeCloseTo(2 * cap1, 6);
    });
});

describe("pool: utilization gate + cooldown", () => {
    it("rejects a claim before the cooldown elapses", async () => {
        const r = fakeRedis();
        await fund(r, "u", 100);
        await stake(r, "u", 100 * M);
        await requestUnstake(r, "u", 100 * M);
        await expect(claim(r, "u")).rejects.toThrow(/cooldown/);
    });

    it("a claim that would breach the capital rule pays only the free capital", async () => {
        const r = fakeRedis();
        await fund(r, "u", 100);
        await stake(r, "u", 100 * M); // assets 100
        await setOI(r, 600 * M); // required = 0.14 * 600 = 84, free = 16
        expect(await freeCapital(r)).toBe(16 * M);

        await requestUnstake(r, "u", 100 * M);
        await mature(r, "u");
        const { amount, remainingShares } = await claim(r, "u");
        expect(amount).toBe(16 * M); // only the free slice
        expect(remainingShares).toBeGreaterThan(0); // the rest waits
        const p = await getPool(r);
        expect(p.assets).toBe(84 * M); // never drops below 0.14 * OI
        expect(p.assets).toBeGreaterThanOrEqual(LEV.poolToOI * 600 * M - 1);
    });
});

describe("pool: DeepBook Margin buckets", () => {
    it("moves only our own funds between hot and supplied, no borrow path", async () => {
        const r = fakeRedis();
        await genesis(r, 100 * M); // hot 100, supplied 0
        await rebalanceMargin(r, 30 * M); // supply 30
        let p = await getPool(r);
        expect(p.supplied).toBe(30 * M);
        expect(p.hot).toBe(70 * M);
        expect(p.assets).toBe(100 * M);

        await rebalanceMargin(r, -50 * M); // withdraw, capped at what we supplied
        p = await getPool(r);
        expect(p.supplied).toBe(0);
        expect(p.hot).toBe(100 * M);

        await rebalanceMargin(r, 999 * M); // can never supply more than hot (no borrow)
        p = await getPool(r);
        expect(p.supplied).toBe(100 * M);
        expect(p.hot).toBe(0);
        expect(p.assets).toBe(100 * M);
    });
});

// deterministic RNG so the fuzz is reproducible
function mulberry32(seed: number) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe("pool: invariant fuzz", () => {
    it("assets >= 0.14*OI holds and shares reconcile across random ops", async () => {
        const r = fakeRedis();
        await genesis(r, 1000 * M); // platform seeds 1000
        const users = ["platform", "a", "b", "c"];
        await fund(r, "a", 1e6);
        await fund(r, "b", 1e6);
        await fund(r, "c", 1e6);
        await r.sadd("lev:cohorts", "C");
        let oi = 0;
        const rand = mulberry32(7);

        const reconcileShares = async () => {
            const p = await getPool(r);
            let sum = 0;
            for (const u of users) {
                sum += await getShares(r, u);
                const c = await getClaim(r, u);
                if (c) sum += c.shares; // shares in flight stay in totalShares until burned
            }
            expect(sum).toBe(p.shares);
        };

        for (let i = 0; i < 150; i++) {
            const p = await getPool(r);
            const free = Math.max(0, p.assets - LEV.poolToOI * oi);
            const op = Math.floor(rand() * 6);
            const u = users[1 + Math.floor(rand() * 3)];
            try {
                if (op === 0) {
                    await stake(r, u, 1 + Math.floor(rand() * 50 * M)); // grows assets + hot
                } else if (op === 1) {
                    await creditFee(r, 1 + Math.floor(rand() * 20 * M), `f${i}`);
                } else if (op === 2) {
                    const loss = Math.floor(rand() * free); // bounded so the gate holds (tail tested elsewhere)
                    if (loss > 0) await debitLoss(r, loss, `l${i}`);
                } else if (op === 3) {
                    const room = Math.max(0, p.assets / LEV.poolToOI - oi); // new opens gated by capacity
                    oi += Math.floor(rand() * room);
                } else if (op === 4) {
                    oi = Math.max(0, oi - Math.floor(rand() * oi)); // positions close
                } else {
                    const sh = await getShares(r, u);
                    if (sh > 0) {
                        await requestUnstake(r, u, 1 + Math.floor(rand() * sh));
                        await mature(r, u);
                        await claim(r, u);
                    }
                }
            } catch {
                // legitimate gate rejections (insufficient balance, dust, capital-locked) keep the loop going
            }
            await r.set("lev:oi:C", String(oi)); // keep the claim gate's getLevOI in sync with the fuzz
            const pp = await getPool(r);
            expect(pp.assets).toBeGreaterThanOrEqual(LEV.poolToOI * oi - 1); // capital rule (modulo dust)
            expect(pp.assets).toBeGreaterThanOrEqual(0);
            await reconcileShares();
        }
    });
});
