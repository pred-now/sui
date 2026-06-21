import type Redis from "ioredis";
import { getJson, mapLimit, sleep } from "../lib/predict";
import { Market, MARKETS_KEY, PRICE_SCALE, getDetails } from "../lib/market";
import { fairYes } from "../lib/pricing";
import {
    Candle,
    PricePoint,
    INTERVALS,
    spotKey,
    tradesKey,
    probKey,
    cacheKey,
    aggregateOHLC,
} from "../lib/candles";

const UNIT = 1_000_000;
const POLL_MS = 15_000;
const CONCURRENCY = 4;
const MAX_POINTS = 3000; // per series per market
const CACHE_TTL_S = 5;

// accumulates price/trade history in redis and serves cached candles
export class CandlesService {
    constructor(private redis: Redis) {}

    async start() {
        this.loop();
    }

    // candles for one market, cached briefly
    async getCandles(
        oracleId: string,
        type: "spot" | "contract" | "prob",
        side: "YES" | "NO",
        interval: string,
    ): Promise<Candle[]> {
        const intervalMs = INTERVALS[interval];
        if (!intervalMs) throw new Error(`bad interval: ${interval}`);

        const ck = cacheKey(oracleId, type, side, interval);
        const hit = await this.redis.get(ck);
        if (hit) return JSON.parse(hit) as Candle[];

        let points: PricePoint[];
        if (type === "contract") points = await this.readTrades(oracleId, side);
        else if (type === "prob") points = await this.readProb(oracleId);
        else points = await this.readSpot(oracleId);
        const candles = aggregateOHLC(points, intervalMs);

        await this.redis.set(ck, JSON.stringify(candles), "EX", CACHE_TTL_S);
        return candles;
    }

    // raw points, one per oracle write, for the line chart
    async getSeries(
        oracleId: string,
        type: "spot" | "contract" | "prob",
        side: "YES" | "NO",
    ): Promise<PricePoint[]> {
        let points: PricePoint[];
        if (type === "contract") points = await this.readTrades(oracleId, side);
        else if (type === "prob") points = await this.readProb(oracleId);
        else points = await this.readSpot(oracleId);
        return points.sort((a, b) => a.time - b.time);
    }

    // stored series are sorted by score, no re-sort needed
    private async readSpot(oracleId: string): Promise<PricePoint[]> {
        const members = await this.redis.zrange(spotKey(oracleId), 0, -1);
        return members.map(m => {
            const [t, p] = m.split("|");
            return { time: Number(t), price: Number(p) };
        });
    }

    private async readTrades(oracleId: string, side: "YES" | "NO"): Promise<PricePoint[]> {
        const wantUp = side === "YES" ? "1" : "0";
        const members = await this.redis.zrange(tradesKey(oracleId), 0, -1);
        const points: PricePoint[] = [];
        for (const m of members) {
            const [t, up, price, size] = m.split("|");
            if (up !== wantUp) continue;
            points.push({ time: Number(t), price: Number(price), size: Number(size) });
        }
        return points;
    }

    // fair YES probability series, stored as a time -> prob hash
    private async readProb(oracleId: string): Promise<PricePoint[]> {
        const h = await this.redis.hgetall(probKey(oracleId));
        return Object.entries(h).map(([t, p]) => ({ time: Number(t), price: Number(p) }));
    }

    // poll every active market, append new points
    private async loop() {
        for (;;) {
            try {
                const raw = await this.redis.hgetall(MARKETS_KEY);
                const ids = Object.values(raw)
                    .map(j => JSON.parse(j) as Market)
                    .filter(m => m.status === "active")
                    .map(m => m.oracleId);
                if (ids.length) {
                    await mapLimit(ids, CONCURRENCY, id => this.collect(id));
                }
            } catch (e: any) {
                console.error("candles loop:", e?.message ?? e);
            }
            await sleep(POLL_MS);
        }
    }

    private async collect(oracleId: string) {
        await Promise.all([this.collectPrices(oracleId), this.collectTrades(oracleId)]);
    }

    // one /prices fetch feeds both spot and probability series
    private async collectPrices(oracleId: string) {
        const rows = await getJson<any[]>(`/oracles/${oracleId}/prices`);
        if (!rows?.length) return;

        const sKey = spotKey(oracleId);
        const pipe = this.redis.pipeline();
        for (const r of rows) {
            const t = Number(r.checkpoint_timestamp_ms);
            pipe.zadd(sKey, t, `${t}|${Number(r.spot) / PRICE_SCALE}`);
        }
        pipe.zremrangebyrank(sKey, 0, -(MAX_POINTS + 1));
        await pipe.exec();

        await this.collectProb(oracleId, rows);
    }

    // fair YES per price point, computed once per timestamp
    private async collectProb(oracleId: string, rows: any[]) {
        const details = await getDetails(this.redis, oracleId);
        if (!details?.svi || details.minStrike <= 0) return;

        const pKey = probKey(oracleId);
        const pipe = this.redis.pipeline();
        for (const r of rows) {
            const forward = Number(r.forward) / PRICE_SCALE;
            const prob = fairYes(forward, details.minStrike, details.svi);
            if (prob == null) continue;
            pipe.hsetnx(pKey, String(Number(r.checkpoint_timestamp_ms)), String(prob));
        }
        await pipe.exec();
        await this.trimHash(pKey);
    }

    // drop oldest fields when the hash grows past the cap
    private async trimHash(key: string) {
        const n = await this.redis.hlen(key);
        if (n <= MAX_POINTS) return;
        const fields = (await this.redis.hkeys(key)).sort((a, b) => Number(a) - Number(b));
        const remove = fields.slice(0, n - MAX_POINTS);
        if (remove.length) await this.redis.hdel(key, ...remove);
    }

    private async collectTrades(oracleId: string) {
        const rows = await getJson<any[]>(`/trades/${oracleId}`);
        if (!rows?.length) return;
        const key = tradesKey(oracleId);
        const pipe = this.redis.pipeline();
        for (const r of rows) {
            const t = Number(r.checkpoint_timestamp_ms);
            const up = r.is_up ? "1" : "0";
            const price = Number(r.ask_price ?? r.bid_price) / PRICE_SCALE;
            const size = Number(r.quantity) / UNIT;
            pipe.zadd(key, t, `${t}|${up}|${price}|${size}|${r.event_digest}`);
        }
        pipe.zremrangebyrank(key, 0, -(MAX_POINTS + 1));
        await pipe.exec();
    }
}
