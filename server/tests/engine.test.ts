import { describe, it, expect } from "@jest/globals";
import { BetEngine } from "../services/engine";
import { SettlementService } from "../services/settlement";
import { DETAILS_KEY } from "../lib/market";
import { getBook } from "../lib/book";
import { getLedger, setLedger, available } from "../lib/ledger";
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

// vault devInspect offline -> engine falls back to ECON.hedgeFloor
const noChain = { devInspectTransactionBlock: async () => { throw new Error("offline"); } } as any;
const treasury = (reserveUsd = 100_000) =>
    ({ reserveBalance: async () => reserveUsd * 1_000_000, mint: async () => "DIG", redeem: async () => "DIG" }) as any;

describe("engine: place bet", () => {
    it("locks stake, records the position, updates the book", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        const fill = await e.placeBet("u", OID, STRIKE, "yes", 10_000_000, "id1");

        expect(fill.contracts).toBeGreaterThan(0);
        const l = await getLedger(r, "u");
        expect(l.locked).toBe(10_000_000);
        expect(available(l)).toBe(990_000_000);
        const b = await getBook(r, OID, STRIKE);
        expect(b.internalYes).toBeCloseTo(fill.contracts, 6);
    });

    it("nets opposite bets against each other", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "a");
        await fund(r, "b");
        const e = new BetEngine(r, noChain, treasury());
        const fa = await e.placeBet("a", OID, STRIKE, "yes", 10_000_000, "ia");
        const fb = await e.placeBet("b", OID, STRIKE, "no", 10_000_000, "ib");
        const b = await getBook(r, OID, STRIKE);
        expect(b.internalYes).toBeCloseTo(fa.contracts, 6);
        expect(b.internalNo).toBeCloseTo(fb.contracts, 6);
        expect(Math.abs(b.internalYes - b.internalNo)).toBeLessThan(fa.contracts);
    });
});

describe("engine: capacity", () => {
    it("rejects an exposing bet past the hard cap, allows balancing", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u", 100000);
        const e = new BetEngine(r, noChain, treasury(200)); // band ~2, hardCap ~6 contracts
        await e.placeBet("u", OID, STRIKE, "yes", 500_000, "i1"); // ~1 contract, under cap
        // a big exposing YES bet (~10 contracts) blows past the hard cap
        await expect(e.placeBet("u", OID, STRIKE, "yes", 5_000_000, "i2")).rejects.toThrow(/capacity/);
        // a balancing NO bet is accepted
        await expect(e.placeBet("u", OID, STRIKE, "no", 500_000, "i3")).resolves.toBeDefined();
    });
});

describe("engine: idempotency + concurrency", () => {
    it("applies the same bet id once", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        const a = await e.placeBet("u", OID, STRIKE, "yes", 10_000_000, "same");
        const b = await e.placeBet("u", OID, STRIKE, "yes", 10_000_000, "same");
        expect(b).toEqual(a);
        expect((await getLedger(r, "u")).locked).toBe(10_000_000);
    });

    it("serializes concurrent bets on one market", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        const [x, y] = await Promise.all([
            e.placeBet("u", OID, STRIKE, "yes", 5_000_000, "x"),
            e.placeBet("u", OID, STRIKE, "yes", 5_000_000, "y"),
        ]);
        const b = await getBook(r, OID, STRIKE);
        expect(b.internalYes).toBeCloseTo(x.contracts + y.contracts, 6);
        expect((await getLedger(r, "u")).locked).toBe(10_000_000);
    });
});

describe("engine: staleness", () => {
    it("pauses a stale-oracle market", async () => {
        const r = fakeRedis();
        const now = Date.now();
        await seed(r, details({ price: { spot: 60000, forward: 60000, checkpoint: 1, timestampMs: now - 120_000 } }));
        await fund(r, "u");
        const e = new BetEngine(r, noChain, treasury());
        expect((await e.getQuote(OID, STRIKE, "yes")).paused).toBe(true);
        await expect(e.placeBet("u", OID, STRIKE, "yes", 10_000_000, "s1")).rejects.toThrow(/paused/);
    });
});

describe("settlement", () => {
    it("pays the winning side and debits the losing side, idempotently", async () => {
        const r = fakeRedis();
        await seed(r);
        await fund(r, "yesUser");
        await fund(r, "noUser");
        const e = new BetEngine(r, noChain, treasury());
        await e.placeBet("yesUser", OID, STRIKE, "yes", 10_000_000, "y1");
        await e.placeBet("noUser", OID, STRIKE, "no", 10_000_000, "n1");

        await seed(r, details({ status: "settled", settlementPrice: 61000 })); // YES wins
        const s = new SettlementService(r, treasury(), e);
        await s.tick();

        const yu = await getLedger(r, "yesUser");
        const nu = await getLedger(r, "noUser");
        expect(yu.locked).toBe(0);
        expect(nu.locked).toBe(0);
        expect(yu.balance).toBeGreaterThan(1_000_000_000); // profit on the win
        expect(nu.balance).toBe(990_000_000); // lost the $10 stake

        await s.tick(); // idempotent
        expect((await getLedger(r, "yesUser")).balance).toBe(yu.balance);
    });
});
