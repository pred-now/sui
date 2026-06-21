import { describe, it, expect } from "@jest/globals";
import { crossCheck, getPythPrice, pythFeedFor } from "../lib/pyth";

// stub hermes: one feed price, optionally aged to test the staleness bound
function mockHermes(price: number, ageMs = 0) {
    global.fetch = (async () => ({
        ok: true,
        json: async () => ({
            parsed: [{ price: { price: String(Math.round(price * 1e8)), expo: -8, publish_time: Math.floor((Date.now() - ageMs) / 1000) } }],
        }),
    })) as any;
}

describe("pyth cross-check", () => {
    it("maps known assets to feeds, case-insensitive", () => {
        expect(pythFeedFor("BTC")).toBeTruthy();
        expect(pythFeedFor("eth")).toBeTruthy();
        expect(pythFeedFor("NOPE")).toBeUndefined();
    });

    it("ok within tolerance, not ok past it", async () => {
        mockHermes(64000);
        expect((await crossCheck("BTC", 64050, 100)).ok).toBe(true); // ~8 bps
        expect((await crossCheck("BTC", 65000, 100)).ok).toBe(false); // ~156 bps
    });

    it("reports divergence in basis points", async () => {
        mockHermes(2000);
        const r = await crossCheck("ETH", 2010, 100);
        expect(r.bps).toBeCloseTo(50, 0); // 10/2000 = 50 bps
        expect(r.pyth).toBeCloseTo(2000, 6);
    });

    it("throws for an unmapped asset (liquidation will fail closed)", async () => {
        await expect(getPythPrice("NOPE")).rejects.toThrow(/no pyth feed/);
    });

    it("throws on a stale pyth publish", async () => {
        mockHermes(150, 60_000); // 60s old, past the 30s bound
        await expect(getPythPrice("SOL")).rejects.toThrow(/stale/);
    });
});
