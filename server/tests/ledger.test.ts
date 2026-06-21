import { describe, it, expect } from "@jest/globals";
import { available, creditUsd, debit, getLedger, setLedger } from "../lib/ledger";
import { fakeRedis } from "./fake-redis";

describe("available", () => {
    it("equals balance with nothing locked", () => {
        expect(available({ balance: 1000, locked: 0, debt: 0, fees: 0 })).toBe(1000);
    });
    it("subtracts locked exposure", () => {
        expect(available({ balance: 1000, locked: 300, debt: 0, fees: 0 })).toBe(700);
    });
    it("subtracts debt and fees", () => {
        expect(available({ balance: 1000, locked: 0, debt: 200, fees: 100 })).toBe(700);
    });
    it("clamps to zero", () => {
        expect(available({ balance: 100, locked: 0, debt: 300, fees: 0 })).toBe(0);
    });
});

describe("creditUsd idempotency", () => {
    it("the same coin credits once", async () => {
        const r = fakeRedis();
        expect(await creditUsd(r, "u", 500, "deposited:u:usdc:C1")).toBe(true);
        expect(await creditUsd(r, "u", 500, "deposited:u:usdc:C1")).toBe(false);
        expect((await getLedger(r, "u")).balance).toBe(500);
    });

    it("a new coin adds again", async () => {
        const r = fakeRedis();
        await creditUsd(r, "u", 500, "deposited:u:usdc:A");
        await creditUsd(r, "u", 250, "deposited:u:usdc:B");
        expect((await getLedger(r, "u")).balance).toBe(750);
    });
});

describe("debit", () => {
    it("reduces the balance", async () => {
        const r = fakeRedis();
        await setLedger(r, "u", { balance: 500, locked: 0, debt: 0, fees: 0 });
        await debit(r, "u", 200);
        expect((await getLedger(r, "u")).balance).toBe(300);
    });
    it("clamps at zero", async () => {
        const r = fakeRedis();
        await setLedger(r, "u", { balance: 100, locked: 0, debt: 0, fees: 0 });
        await debit(r, "u", 999);
        expect((await getLedger(r, "u")).balance).toBe(0);
    });
});
