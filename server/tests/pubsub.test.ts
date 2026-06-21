import { createRedis } from "../lib/redis";
import { EVENTS_CHANNEL } from "../lib/market";

// needs a running redis at REDIS_URL
describe("pubsub", () => {
    it("delivers a market event through the channel", async () => {
        const pub = createRedis();
        const sub = createRedis();

        const market = {
            oracleId: "0xTEST",
            underlying: "BTC",
            expiry: 9999999999999,
            status: "active",
            minStrike: 0,
            tickSize: 0,
            activatedAt: 0,
        };

        const received = new Promise<any>(resolve => {
            sub.on("message", (_ch, raw) => resolve(JSON.parse(raw)));
        });
        await sub.subscribe(EVENTS_CHANNEL);

        // at least our own subscriber, others may exist
        const n = await pub.publish(EVENTS_CHANNEL, JSON.stringify({ type: "market:new", data: market }));
        expect(n).toBeGreaterThanOrEqual(1);

        const msg = await received;
        expect(msg.type).toBe("market:new");
        expect(msg.data.oracleId).toBe("0xTEST");

        await sub.quit();
        await pub.quit();
    });
});
