import { describe, it, expect } from "@jest/globals";
import { BetEngine } from "../services/engine";
import { LiquidationService } from "../services/liquidation";
import { SettlementService } from "../services/settlement";
import { DETAILS_KEY } from "../lib/market";
import { getLedger, setLedger, available } from "../lib/ledger";
import { getLevBook, getLevPosition, getLevOI, levPosKey, setLevPosition, type LevPosition } from "../lib/levbook";
import { listHistory } from "../lib/history";
import { getPool, genesis, POOL } from "../lib/pool";
import { fakeRedis } from "./fake-redis";

const OID = "0xabc";
const STRIKE = 60000;

function details(over: Record<string, unknown> = {}) {
    const now = Date.now();
    return {
        oracleId: OID, underlying: "BTC", status: "active",
        expiry: now + 3_600_000, minStrike: 0, tickSize: 0, activatedAt: now - 3_600_000,
        settlementPrice: null, settledAt: null,
        price: { spot: 60000, forward: 60000, checkpoint: 1, timestampMs: now },
        svi: { a: 0.04, b: 0.1, rho: 0, m: 0, sigma: 0.2, checkpoint: 1, timestampMs: now },
        askBounds: null, updatedAt: now,
        ...over,
    };
}
async function seed(r: any, d = details()) {
    await r.hset(DETAILS_KEY, OID, JSON.stringify(d));
    return d;
}
async function fund(r: any, userId: string, usd = 1000) {
    await setLedger(r, userId, { balance: usd * 1_000_000, locked: 0, debt: 0, fees: 0 });
}
const noChain = { devInspectTransactionBlock: async () => { throw new Error("offline"); } } as any;
const treasury = (reserveUsd = 100_000) =>
    ({ reserveBalance: async () => reserveUsd * 1_000_000, mint: async () => "DIG", redeem: async () => "DIG" }) as any;

describe("leverage: open", () => {
    it("locks only margin, borrows the rest, updates L/S + OI", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        const open = await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 3, "o1");

        expect(open.notional).toBe(30_000_000);
        expect(open.borrowed).toBe(20_000_000);
        const l = await getLedger(r, "u");
        expect(l.locked).toBe(10_000_000); // only the margin is locked
        const pos = await getLevPosition(r, "u", OID, STRIKE, "yes");
        expect(pos?.margin).toBe(10_000_000);
        expect(pos?.borrowed).toBe(20_000_000);
        expect((await getLevBook(r, OID, STRIKE)).L).toBe(30_000_000); // L/S track gross notional
        expect(await getLevOI(r)).toBe(30_000_000); // cohort OI tracks notional (the 0.14 rule's denominator)
    });

    it("rejects leverage above the max", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await expect(e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 6, "o2")).rejects.toThrow(/leverage/);
    });

    it("rejects when the cohort OI capital cap is reached", async () => {
        const r = fakeRedis();
        const d = await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury(1000)); // maxOI = 1000/0.14 = $7142
        const cohort = `BTC:${d.expiry}`;
        await r.sadd("lev:cohorts", cohort);
        await r.set(`lev:oi:${cohort}`, String(7_140_000_000)); // pre-load near the cap
        // margin 5 @ 2x is $10 notional, which pushes the cohort past maxOI = 1000/0.14 = $7142
        await expect(e.openLeverage("u", OID, STRIKE, "yes", 5_000_000, 2, "cap1")).rejects.toThrow(/capacity/);
    });

    it("cohorts are independent: a full cohort does not block another market", async () => {
        const r = fakeRedis();
        const d = await seed(r);
        await fund(r, "u", 100000);
        const e = new BetEngine(r, noChain, treasury(1000));
        // saturate this market's cohort
        const cohortA = `BTC:${d.expiry}`;
        await r.sadd("lev:cohorts", cohortA);
        await r.set(`lev:oi:${cohortA}`, String(7_140_000_000));
        // a different market (different expiry => different cohort) still has room
        const d2 = { ...details({ expiry: d.expiry + 5_000_000 }), oracleId: "0xdef" };
        await r.hset(DETAILS_KEY, "0xdef", JSON.stringify(d2));
        await expect(e.openLeverage("u", "0xdef", STRIKE, "yes", 5_000_000, 2, "iso1")).resolves.toBeDefined();
    });

    it("rejects a leveraged open inside the cliff window but allows 1x", async () => {
        const r = fakeRedis();
        const now = Date.now();
        await seed(r, details({ expiry: now + 30_000 })); // inside the final-minute window
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await expect(e.openLeverage("u", OID, STRIKE, "yes", 5_000_000, 2, "cliffopen")).rejects.toThrow(/expiry/);
        await expect(e.openLeverage("u", OID, STRIKE, "yes", 5_000_000, 1, "okopen")).resolves.toBeDefined();
    });
});

describe("bet: 1x (no borrow, no liquidation, still closeable)", () => {
    it("borrows nothing, locks the full margin, and reserves no cohort OI", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        const open = await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 1, "x1");

        expect(open.borrowed).toBe(0);
        expect(open.notional).toBe(10_000_000);
        expect((await getLedger(r, "u")).locked).toBe(10_000_000);
        expect(await getLevOI(r)).toBe(0); // zero borrow => no capital reservation
    });

    it("never liquidates a 1x bet, even when the mark collapses", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 1, "x1");

        await seed(r, details({ price: { spot: 30000, forward: 30000, checkpoint: 2, timestampMs: Date.now() } }));
        await r.set(`lev:cross:${levPosKey("u", OID, STRIKE, "yes")}`, String(Date.now() - 40_000));
        await new LiquidationService(r, e).tick();

        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).not.toBeNull();
    });

    it("skips the cliff near expiry and rides to settlement", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 1, "x1");

        const now = Date.now();
        await seed(r, details({ activatedAt: now - 1_140_000, expiry: now + 30_000 })); // inside the cliff window
        await new LiquidationService(r, e).tick();
        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).not.toBeNull(); // cliff left it alone

        await seed(r, details({ status: "settled", settlementPrice: 61000, activatedAt: now - 1_140_000, expiry: now + 30_000 }));
        await new SettlementService(r, treasury(), e).tick();
        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).toBeNull(); // settled at the outcome
    });

    it("is closeable any time and writes a trade-history record", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 1, "x1");
        const close = await e.closeLeverage("u", OID, STRIKE, "yes", "c1");

        expect(close.reason).toBe("close");
        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).toBeNull();
        const hist = await listHistory(r, "u");
        expect(hist.length).toBe(1);
        expect(hist[0].reason).toBe("close");
        expect(hist[0].side).toBe("yes");
        expect(hist[0].borrowed).toBe(0);
        expect(hist[0].openedAt).toBeGreaterThan(0);
    });
});

describe("leverage: close", () => {
    it("returns equity, clears the position and the books", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 2, "o1");
        const close = await e.closeLeverage("u", OID, STRIKE, "yes", "c1");

        expect(close.reason).toBe("close");
        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).toBeNull();
        expect((await getLevBook(r, OID, STRIKE)).L).toBe(0);
        const l = await getLedger(r, "u");
        expect(l.locked).toBe(0);
        expect(l.balance).toBeLessThanOrEqual(1_000_000_000); // round-trip spread cost
    });
});

describe("leverage: liquidation + cliff", () => {
    it("liquidates an underwater position after the delay", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 3, "o1");

        // jump the mark down hard: forward far below strike makes YES near-worthless
        await seed(r, details({ price: { spot: 30000, forward: 30000, checkpoint: 2, timestampMs: Date.now() } }));
        // pre-age the underwater marker so the 30s anti-manipulation delay is satisfied
        await r.set(`lev:cross:${levPosKey("u", OID, STRIKE, "yes")}`, String(Date.now() - 40_000));
        // pyth agrees with the jumped oracle, so the cross-check lets liquidation proceed
        global.fetch = (async () => ({
            ok: true,
            json: async () => ({ parsed: [{ price: { price: "3000000000000", expo: -8, publish_time: Math.floor(Date.now() / 1000) } }] }),
        })) as any;

        const liq = new LiquidationService(r, e);
        await liq.tick();

        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).toBeNull();
        expect(Number(await r.get("lev:baddebt"))).toBeGreaterThan(0); // a jump leaves bad debt
        expect((await getLedger(r, "u")).locked).toBe(0);
    });

    it("force-closes via the deleverage cliff near expiry", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 3, "o1");

        // re-seed near expiry: inside the final-minute cliff window
        const now = Date.now();
        await seed(r, details({ activatedAt: now - 1_140_000, expiry: now + 30_000 }));
        const liq = new LiquidationService(r, e);
        await liq.tick();

        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).toBeNull();
        expect((await getLedger(r, "u")).locked).toBe(0);
    });

    it("settles a leftover leveraged position at the outcome", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 3, "o1"); // ~61 contracts, $20 borrowed

        await seed(r, details({ status: "settled", settlementPrice: 61000 })); // YES wins
        await new SettlementService(r, treasury(), e).tick();

        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).toBeNull();
        const l = await getLedger(r, "u");
        expect(l.locked).toBe(0);
        expect(l.balance).toBeGreaterThan(1_000_000_000); // contracts paid $1, repaid the loan, profit
    });

    it("settles a past-expiry market via a live refresh when the cache never recorded it", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 3, "o1");

        // the race: the cache still shows the market expired-but-unresolved (it was dropped from the
        // active refresh loop), while the live state is actually settled. settlement fetches it fresh.
        const now = Date.now();
        await seed(r, details({ expiry: now - 1000 }));
        const settled = details({ status: "settled", settlementPrice: 61000, expiry: now - 1000 });
        const detailsSvc = {
            refresh: async (id: string) => {
                await r.hset(DETAILS_KEY, id, JSON.stringify(settled));
                return settled;
            },
        } as any;
        await new SettlementService(r, treasury(), e, detailsSvc).tick();

        expect(await getLevPosition(r, "u", OID, STRIKE, "yes")).toBeNull();
        expect((await getLedger(r, "u")).locked).toBe(0);
    });
});

describe("pool: engine + settlement routing", () => {
    it("the leverage capital gate reads the pool, not the raw reserve", async () => {
        const r = fakeRedis();
        const d = await seed(r);
        await fund(r, "u", 100000);
        const e = new BetEngine(r, noChain, treasury(1_000_000)); // $1M reserve, must be ignored
        await genesis(r, 1000 * 1_000_000); // pool $1000 -> maxOI ~$7142
        const cohort = `BTC:${d.expiry}`;
        await r.sadd("lev:cohorts", cohort);
        await r.set(`lev:oi:${cohort}`, String(7_140_000_000));
        // borrowing $5 pushes the cohort past the cap only if the gate used the $1000 pool
        await expect(e.openLeverage("u", OID, STRIKE, "yes", 5_000_000, 2, "pg")).rejects.toThrow(/capacity/);
    });

    it("a close routes real interest and no phantom bad debt when principal is covered", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        await genesis(r, 1000 * 1_000_000);
        const before = (await getPool(r)).assets;

        // craft a position: $10 borrowed, $5 accrued interest, value $12 at mark 0.5 (24 contracts)
        const now = Date.now();
        const pos: LevPosition = {
            userId: "u", oracleId: OID, strike: STRIKE, expiry: now + 3_600_000, side: "yes", cohort: "BTC:z",
            contracts: 24, margin: 5_000_000, borrowed: 10_000_000, reservedOI: 15_000_000, entryAsk: 0.5, rate: 0, fees: 5_000_000,
            openedAt: now, accruedAt: now,
        };
        await setLevPosition(r, pos);
        await r.sadd("lev:cohorts", "BTC:z");
        await r.set("lev:oi:BTC:z", String(10_000_000));
        await e.forceUnwind("u", OID, STRIKE, "yes", "test", 0.5); // value $12 > $10 principal

        expect(Number((await r.get("lev:baddebt")) ?? 0)).toBe(0); // principal covered, no phantom loss
        const after = (await getPool(r)).assets;
        expect(after - before).toBe(Math.floor(2_000_000 * POOL.stakerShare)); // interest = min($5, $12-$10) = $2
    });

    it("settlement routes the bookmaker spread to the pool", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u", 1000);
        const e = new BetEngine(r, noChain, treasury());
        await genesis(r, 20000 * 1_000_000); // large pool so the band carries both legs, no hedge mock noise
        const before = (await getPool(r)).assets;

        // a contract-neutral book (equal YES and NO contracts) leaves the house outcome-neutral, so
        // settlement keeps exactly the spread whichever side wins
        const yes = await e.openLeverage("u", OID, STRIKE, "yes", 10_000_000, 1, "y1");
        const q = await e.getQuote(OID, STRIKE, "no");
        const noStake = Math.round(yes.contracts * q.noAsk * 1_000_000);
        await e.openLeverage("u", OID, STRIKE, "no", noStake, 1, "n1");
        await seed(r, details({ status: "settled", settlementPrice: 61000 })); // YES wins

        await new SettlementService(r, treasury(), e).tick();

        const p = await getPool(r);
        expect(p.assets).toBeGreaterThan(before); // the spread was routed as a fee
        expect(p.assets - before).toBeLessThan(yes.contracts * 1_000_000); // a spread, not the whole pot
        expect(p.protocol).toBeGreaterThan(0); // split with the protocol
    });
});
