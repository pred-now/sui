import { describe, it, expect } from "@jest/globals";
import { fakeRedis } from "./fake-redis";
import { setLedger, getLedger } from "../lib/ledger";
import { withdrawUsdc } from "../services/withdrawals";

async function seed(r: any, balance: number, debt = 0, fees = 0, addr = "0xdest") {
    await r.set(
        "user:u",
        JSON.stringify({ userId: "u", provider: "x", address: "0xproxy", createdAt: 0 }),
    );
    if (addr) await r.set("withdrawAddr:u", addr);
    await setLedger(r, "u", { balance, locked: 0, debt, fees });
}

// fake treasury, counts payouts with an optional delay to hold the lock
function fakeTreasury(onExec?: () => Promise<void>) {
    const state = { calls: 0 };
    const svc = {
        payout: async () => {
            state.calls++;
            if (onExec) await onExec();
            return `DIG${state.calls}`;
        },
    } as any;
    return { svc, state };
}

describe("withdrawUsdc gating", () => {
    it("less than available passes and debits once", async () => {
        const r = fakeRedis();
        await seed(r, 1000);
        const res = await withdrawUsdc(r, fakeTreasury().svc, "u", 400, "id1");
        expect(res.status).toBe("done");
        expect((await getLedger(r, "u")).balance).toBe(600);
    });

    it("exactly available passes", async () => {
        const r = fakeRedis();
        await seed(r, 600);
        await expect(withdrawUsdc(r, fakeTreasury().svc, "u", 600, "id1")).resolves.toMatchObject({
            status: "done",
        });
        expect((await getLedger(r, "u")).balance).toBe(0);
    });

    it("more than available is rejected", async () => {
        const r = fakeRedis();
        await seed(r, 1000);
        await expect(withdrawUsdc(r, fakeTreasury().svc, "u", 1001, "id1")).rejects.toThrow(
            /exceeds balance/,
        );
    });

    it("debt reduces available so borrowed funds cannot leave", async () => {
        const r = fakeRedis();
        await seed(r, 1000, 800); // available = 200
        const t = fakeTreasury();
        await expect(withdrawUsdc(r, t.svc, "u", 500, "a")).rejects.toThrow(/exceeds balance/);
        await expect(withdrawUsdc(r, t.svc, "u", 200, "b")).resolves.toMatchObject({ status: "done" });
        expect((await getLedger(r, "u")).balance).toBe(800);
    });

    it("rejects when no withdrawal address is registered", async () => {
        const r = fakeRedis();
        await seed(r, 1000, 0, 0, "");
        await expect(withdrawUsdc(r, fakeTreasury().svc, "u", 100, "id1")).rejects.toThrow(/registered/);
    });
});

describe("withdrawUsdc idempotency and concurrency", () => {
    it("the same id never double-pays", async () => {
        const r = fakeRedis();
        await seed(r, 1000);
        const t = fakeTreasury();
        const a = await withdrawUsdc(r, t.svc, "u", 300, "same");
        const b = await withdrawUsdc(r, t.svc, "u", 300, "same");
        expect(a.digest).toBe(b.digest);
        expect(t.state.calls).toBe(1);
        expect((await getLedger(r, "u")).balance).toBe(700);
    });

    it("two concurrent withdrawals cannot both pass", async () => {
        const r = fakeRedis();
        await seed(r, 1000);
        const t = fakeTreasury(() => new Promise(res => setTimeout(res, 30)));
        const results = await Promise.allSettled([
            withdrawUsdc(r, t.svc, "u", 1000, "a"),
            withdrawUsdc(r, t.svc, "u", 1000, "b"),
        ]);
        expect(results.filter(x => x.status === "fulfilled").length).toBe(1);
        expect((await getLedger(r, "u")).balance).toBe(0);
    });

    it("a failed payout debits nothing and a retry settles once", async () => {
        const r = fakeRedis();
        await seed(r, 1000);
        let fail = true;
        const t = {
            payout: async () => {
                if (fail) {
                    fail = false;
                    throw new Error("tx failed");
                }
                return "DIG";
            },
        } as any;
        await expect(withdrawUsdc(r, t, "u", 400, "x")).rejects.toThrow();
        expect((await getLedger(r, "u")).balance).toBe(1000);
        await expect(withdrawUsdc(r, t, "u", 400, "x")).resolves.toMatchObject({ status: "done" });
        expect((await getLedger(r, "u")).balance).toBe(600);
    });
});
