import type Redis from "ioredis";
import { getJson, mapLimit, sleep } from "../lib/predict";
import { Market, MarketDetails, MARKETS_KEY, DETAILS_KEY, EVENTS_CHANNEL, toDetails, getDetails } from "../lib/market";

const REFRESH_MS = 1_000;
const REFRESH_CONCURRENCY = 4;

// fetches and broadcasts full market state from DeepBook
export class MarketDetailsService {
    constructor(private redis: Redis) {}

    async start() {
        this.loop();
    }

    // cached details, fetched fresh on a miss
    async get(oracleId: string): Promise<MarketDetails | null> {
        const cached = await getDetails(this.redis, oracleId);
        if (cached) return cached;
        return this.refresh(oracleId);
    }

    // fetch state, store, publish if changed
    async refresh(oracleId: string): Promise<MarketDetails | null> {
        try {
            const state = await getJson(`/oracles/${oracleId}/state`);
            const details = toDetails(state);

            const prev = await this.redis.hget(DETAILS_KEY, oracleId);
            await this.redis.hset(DETAILS_KEY, oracleId, JSON.stringify(details));

            if (changed(prev, details)) {
                await this.redis.publish(
                    EVENTS_CHANNEL,
                    JSON.stringify({ type: "market:details", data: details }),
                );
            }
            return details;
        } catch (e: any) {
            console.error("details refresh failed:", oracleId, e?.message ?? e);
            return null;
        }
    }

    // refresh active markets fast, they drive the live odds
    private async loop() {
        for (;;) {
            const raw = await this.redis.hgetall(MARKETS_KEY);
            const ids = Object.values(raw)
                .map(j => JSON.parse(j) as Market)
                .filter(m => m.status === "active")
                .map(m => m.oracleId);
            if (ids.length) {
                await mapLimit(ids, REFRESH_CONCURRENCY, id => this.refresh(id));
            }
            await sleep(REFRESH_MS);
        }
    }
}

// compare new details to stored, ignoring updatedAt
function changed(prevJson: string | null, next: MarketDetails): boolean {
    if (!prevJson) return true;
    const prev = JSON.parse(prevJson) as MarketDetails;
    return (
        prev.status !== next.status ||
        prev.price?.checkpoint !== next.price?.checkpoint ||
        prev.svi?.checkpoint !== next.svi?.checkpoint ||
        prev.settlementPrice !== next.settlementPrice
    );
}
