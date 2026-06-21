import { aggregateOHLC } from "../lib/candles";
import { createRedis } from "../lib/redis";
import { CandlesService } from "../services/candles";
import { spotKey, probKey } from "../lib/candles";
import { fairYes } from "../lib/pricing";

describe("aggregateOHLC", () => {
    it("buckets points by interval", () => {
        const candles = aggregateOHLC(
            [
                { time: 0, price: 10, size: 1 },
                { time: 30_000, price: 12, size: 2 },
                { time: 61_000, price: 9, size: 1 },
            ],
            60_000,
        );
        expect(candles.length).toBe(2);
        expect(candles[0]).toEqual({ time: 0, open: 10, high: 12, low: 10, close: 12, volume: 3 });
        expect(candles[1]).toEqual({ time: 60_000, open: 9, high: 9, low: 9, close: 9, volume: 1 });
    });

    it("holds OHLC invariants on unsorted input", () => {
        const candles = aggregateOHLC(
            [
                { time: 120_000, price: 5 },
                { time: 10_000, price: 7 },
                { time: 40_000, price: 3 },
            ],
            60_000,
        );
        for (let i = 1; i < candles.length; i++) {
            expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
        }
        for (const c of candles) {
            expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
            expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        }
    });

    it("empty input returns empty", () => {
        expect(aggregateOHLC([], 60_000)).toEqual([]);
    });
});

// needs a running redis at REDIS_URL
describe("CandlesService", () => {
    it("aggregates spot candles from the stored series", async () => {
        const redis = createRedis();
        const service = new CandlesService(redis);
        const oid = "0xTESTCANDLES";

        await redis.del(spotKey(oid));
        // two points in one 1m bucket, one in the next
        await redis.zadd(spotKey(oid), 0, "0|100", 30_000, "30000|110", 61_000, "61000|105");

        const candles = await service.getCandles(oid, "spot", "YES", "1m");
        expect(candles.length).toBe(2);
        expect(candles[0]).toMatchObject({ open: 100, high: 110, low: 100, close: 110 });
        expect(candles[1]).toMatchObject({ open: 105, close: 105 });

        await redis.del(spotKey(oid));
        await redis.del("candles:cache:0xTESTCANDLES:spot:YES:1m");
        await redis.quit();
    });

    it("aggregates probability candles from the stored hash", async () => {
        const redis = createRedis();
        const service = new CandlesService(redis);
        const oid = "0xTESTPROB";

        await redis.del(probKey(oid));
        await redis.hset(probKey(oid), "0", "0.9", "30000", "0.95", "61000", "0.92");

        const candles = await service.getCandles(oid, "prob", "YES", "1m");
        expect(candles.length).toBe(2);
        expect(candles[0]).toMatchObject({ open: 0.9, high: 0.95, low: 0.9, close: 0.95 });

        await redis.del(probKey(oid));
        await redis.del("candles:cache:0xTESTPROB:prob:YES:1m");
        await redis.quit();
    });
});

describe("fairYes", () => {
    it("is ~1 when spot is far above strike", () => {
        const svi = { a: 1.8e-5, b: 7.5e-4, rho: -0.27, m: 1.2e-3, sigma: 1e-3 };
        const p = fairYes(63600, 50000, svi);
        expect(p).not.toBeNull();
        expect(p!).toBeGreaterThan(0.99);
    });
});
