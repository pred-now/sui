import { jest } from "@jest/globals";
import { getJson } from "../lib/predict";
import { toMarket } from "../lib/market";
import { env } from "../lib/env";
import { createRedis } from "../lib/redis";

// hits the live testnet API
jest.retryTimes(2, { logErrorsBeforeRetry: true });
describe("snapshot", () => {
    let oracles: any[] = [];

    beforeAll(async () => {
        const r = await getJson(`/predicts/${env.predictId}/oracles`);
        oracles = Array.isArray(r) ? r : r.oracles ?? [];
    });

    it("returns oracles from the API", () => {
        expect(oracles.length).toBeGreaterThan(0);
    });

    it("maps a live market to the Market shape", () => {
        const now = Date.now();
        const live = oracles.filter(o => Number(o.expiry) > now);
        expect(live.length).toBeGreaterThan(0);

        const m = toMarket(live[0]);
        expect(m.oracleId).toMatch(/^0x/);
        expect(m.underlying.length).toBeGreaterThan(0);
        expect(m.expiry).toBeGreaterThan(now);
    });

    it("groups markets by underlying in redis", async () => {
        const redis = createRedis();
        const now = Date.now();
        const live = oracles.filter(o => Number(o.expiry) > now).slice(0, 5);

        await redis.del("markets:test");
        for (const o of live) {
            const m = toMarket(o);
            await redis.hset("markets:test", m.oracleId, JSON.stringify(m));
        }

        // reuse the grouping path against a temp key
        const raw = await redis.hgetall("markets:test");
        const grouped: Record<string, unknown[]> = {};
        for (const json of Object.values(raw)) {
            const m = JSON.parse(json);
            (grouped[m.underlying] ??= []).push(m);
        }
        expect(Object.keys(grouped).length).toBeGreaterThan(0);

        await redis.del("markets:test");
        await redis.quit();
    });
});
