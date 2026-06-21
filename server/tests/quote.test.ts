import { describe, it, expect } from "@jest/globals";
import { quote, spread, lean, askFor } from "../lib/quote";
import { ECON } from "../lib/econ";
import { netExposure, decayedVelocity } from "../lib/book";
import { addFill, payoutOf } from "../lib/positions";
import { lockStake, settlePosition, getLedger, setLedger, available } from "../lib/ledger";
import { fakeRedis } from "./fake-redis";

describe("quote math", () => {
    it("h respects the vault floor", () => {
        expect(spread(0.5, 1, 0, 0, 0.03)).toBeGreaterThanOrEqual(0.03);
    });
    it("tail term is ~0 at f=0.5 and grows toward the tails", () => {
        expect(spread(0.05, 1, 0, 0, 0)).toBeGreaterThan(spread(0.5, 1, 0, 0, 0));
    });
    it("lean is zero at no imbalance and bounded by kappa", () => {
        expect(lean(0, 100)).toBe(0);
        expect(Math.abs(lean(1e9, 100))).toBeLessThanOrEqual(ECON.kappa + 1e-9);
    });
    it("yesAsk + noAsk = 1 + 2h before clamping", () => {
        const q = quote(0.45, 0.5, 0, 0, 0.01, 30, 100);
        expect(q.yesAsk + q.noAsk).toBeCloseTo(1 + 2 * q.h, 9);
    });
    it("asks clamp to [0,1]", () => {
        const q = quote(0.99, 0.1, 0, 0, 0.2, 0, 100);
        expect(q.yesAsk).toBeLessThanOrEqual(1);
        expect(q.noAsk).toBeGreaterThanOrEqual(0);
    });
    it("positive imbalance lifts yesAsk and cheapens NO", () => {
        const flat = quote(0.5, 1, 0, 0, 0.01, 0, 100);
        const leaned = quote(0.5, 1, 0, 0, 0.01, 50, 100);
        expect(leaned.yesAsk).toBeGreaterThan(flat.yesAsk);
        expect(askFor(leaned, "no")).toBeLessThan(askFor(flat, "no"));
    });
});

describe("book", () => {
    it("net exposure = yes - no - hedged", () => {
        expect(netExposure({ internalYes: 10, internalNo: 3, hedgedToVault: 2, velocity: 0, velTs: 0, updatedAt: 0 })).toBe(5);
    });
    it("velocity halves each half-life", () => {
        const now = 1_000_000;
        const b = { internalYes: 0, internalNo: 0, hedgedToVault: 0, velocity: 8, velTs: now - ECON.velocityHalfLifeMs, updatedAt: 0 };
        expect(decayedVelocity(b, now)).toBeCloseTo(4, 6);
    });
});

describe("positions", () => {
    it("addFill accumulates per side and cost", () => {
        let p = addFill({ yesContracts: 0, noContracts: 0, cost: 0, updatedAt: 0 }, "yes", 5, 2_000_000);
        p = addFill(p, "no", 3, 1_000_000);
        expect(p.yesContracts).toBe(5);
        expect(p.noContracts).toBe(3);
        expect(p.cost).toBe(3_000_000);
    });
    it("payout pays the winning side", () => {
        const p = { yesContracts: 5, noContracts: 3, cost: 0, updatedAt: 0 };
        expect(payoutOf(p, true, 1_000_000)).toBe(5_000_000);
        expect(payoutOf(p, false, 1_000_000)).toBe(3_000_000);
    });
});

describe("ledger bet flow", () => {
    it("lockStake reduces available, throws when insufficient", async () => {
        const r = fakeRedis();
        await setLedger(r, "u", { balance: 100_000_000, locked: 0, debt: 0, fees: 0 });
        await lockStake(r, "u", 30_000_000);
        expect(available(await getLedger(r, "u"))).toBe(70_000_000);
        await expect(lockStake(r, "u", 80_000_000)).rejects.toThrow(/insufficient/);
    });
    it("a winning settle applies net pnl and releases the lock", async () => {
        const r = fakeRedis();
        await setLedger(r, "u", { balance: 100_000_000, locked: 30_000_000, debt: 0, fees: 0 });
        await settlePosition(r, "u", 30_000_000, 50_000_000);
        const l = await getLedger(r, "u");
        expect(l.balance).toBe(120_000_000);
        expect(l.locked).toBe(0);
    });
    it("a losing settle debits the stake", async () => {
        const r = fakeRedis();
        await setLedger(r, "u", { balance: 100_000_000, locked: 30_000_000, debt: 0, fees: 0 });
        await settlePosition(r, "u", 30_000_000, 0);
        const l = await getLedger(r, "u");
        expect(l.balance).toBe(70_000_000);
        expect(l.locked).toBe(0);
    });
});
