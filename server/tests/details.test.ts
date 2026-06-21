import { jest } from "@jest/globals";
import { getJson } from "../lib/predict";
import { env } from "../lib/env";
import { createRedis } from "../lib/redis";
import { MarketDetailsService } from "../services/market-details";
import { EVENTS_CHANNEL } from "../lib/market";

// hits live testnet API and local redis
jest.retryTimes(2, { logErrorsBeforeRetry: true });
describe("market details", () => {
    let oracleId = "";

    beforeAll(async () => {
        const r = await getJson(`/predicts/${env.predictId}/oracles`);
        const oracles: any[] = Array.isArray(r) ? r : r.oracles ?? [];
        const now = Date.now();
        oracleId = (oracles.find(o => o.status === "active" && Number(o.expiry) > now) ?? {}).oracle_id;
    });

    it("found an active market to test", () => {
        expect(oracleId).toMatch(/^0x/);
    });

    it("fetches and normalizes full details", async () => {
        const redis = createRedis();
        const service = new MarketDetailsService(redis);

        const d = await service.refresh(oracleId);
        expect(d).not.toBeNull();
        expect(d!.oracleId).toBe(oracleId);
        expect(d!.status).toBe("active");
        expect(d!.expiry).toBeGreaterThan(Date.now());
        expect(d!.price!.spot).toBeGreaterThan(0);
        expect(d!.svi).not.toBeNull();

        await redis.quit();
    });

    it("caches details and serves them from get()", async () => {
        const redis = createRedis();
        const service = new MarketDetailsService(redis);

        await service.refresh(oracleId);
        const cached = await service.get(oracleId);
        expect(cached!.oracleId).toBe(oracleId);

        await redis.quit();
    });

    it("publishes a market:details event on change", async () => {
        const redis = createRedis();
        const sub = createRedis();
        const service = new MarketDetailsService(redis);

        // clear so the next refresh counts as a change
        await redis.hdel("market:details", oracleId);

        // shared channel, match only our details message
        const received = new Promise<any>(resolve => {
            sub.on("message", (_ch, raw) => {
                const m = JSON.parse(raw);
                if (m.type === "market:details" && m.data.oracleId === oracleId) resolve(m);
            });
        });
        await sub.subscribe(EVENTS_CHANNEL);

        await service.refresh(oracleId);
        const msg = await received;
        expect(msg.type).toBe("market:details");
        expect(msg.data.oracleId).toBe(oracleId);

        await sub.quit();
        await redis.quit();
    });
});
