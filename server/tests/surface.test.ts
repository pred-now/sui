import { mergeSurface, downsample } from "../lib/surface";
import { fairYes } from "../lib/pricing";

describe("mergeSurface", () => {
    it("samples at price times, carrying svi forward", () => {
        // svi at t=0 and t=100, prices at 50,120,200
        const prices = [
            { checkpoint_timestamp_ms: 200, forward: 200e9 },
            { checkpoint_timestamp_ms: 50, forward: 50e9 },
            { checkpoint_timestamp_ms: 120, forward: 120e9 },
        ];
        const svis = [
            { checkpoint_timestamp_ms: 100, a: 2e9, b: 0, rho: 0, rho_negative: false, m: 0, m_negative: false, sigma: 1e9 },
            { checkpoint_timestamp_ms: 0, a: 1e9, b: 0, rho: 0, rho_negative: false, m: 0, m_negative: false, sigma: 1e9 },
        ];
        const out = mergeSurface(prices, svis, 0);
        expect(out.map(p => p.t)).toEqual([50, 120, 200]);
        expect(out[0].forward).toBe(50); // 50e9 / 1e9
        expect(out[0].a).toBe(1); // svi@0
        expect(out[1].a).toBe(2); // svi@100 carried to t=120
        expect(out[2].a).toBe(2);
    });

    it("drops prices before the first svi and before cutoff", () => {
        const prices = [
            { checkpoint_timestamp_ms: 10, forward: 10e9 },
            { checkpoint_timestamp_ms: 90, forward: 90e9 },
        ];
        const svis = [
            { checkpoint_timestamp_ms: 50, a: 1e9, b: 0, rho: 0, rho_negative: false, m: 0, m_negative: false, sigma: 1e9 },
        ];
        const out = mergeSurface(prices, svis, 0);
        expect(out.map(p => p.t)).toEqual([90]); // t=10 has no svi yet
    });

    it("downsamples to the target keeping the last point", () => {
        const pts = Array.from({ length: 100 }, (_, i) => ({
            t: i, forward: i, a: 0, b: 0, rho: 0, m: 0, sigma: 0,
        }));
        const out = downsample(pts, 10);
        expect(out.length).toBeLessThanOrEqual(11);
        expect(out[out.length - 1].t).toBe(99);
    });
});

// pins the pricing function to the live protocol mid (Phase 0 gate)
describe("fairYes protocol gate", () => {
    it("reproduces the validated protocol mid", () => {
        // validated case: oracle 0x05306d..., forward 63755, strike 63000, total var ~0.0105.
        // protocol get_trade_amounts mid was 0.526 (YES ask 0.536 / NO ask 0.484).
        const svi = { a: 0.01048, b: 0, rho: 0, m: 0, sigma: 0.001 };
        const p = fairYes(63755, 63000, svi);
        expect(p).not.toBeNull();
        expect(p!).toBeCloseTo(0.526, 2);
    });

    it("is monotonic decreasing in strike", () => {
        const svi = { a: 0.01, b: 0, rho: 0, m: 0, sigma: 0.001 };
        const low = fairYes(63755, 60000, svi)!;
        const mid = fairYes(63755, 63755, svi)!;
        const high = fairYes(63755, 67000, svi)!;
        expect(low).toBeGreaterThan(mid);
        expect(mid).toBeGreaterThan(high);
    });
});
