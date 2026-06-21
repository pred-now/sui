import type Redis from "ioredis";
import { getJson } from "../lib/predict";
import {
    SurfacePoint,
    Range,
    RANGES,
    surfaceKey,
    mergeSurface,
    downsample,
} from "../lib/surface";

const CACHE_TTL_S = 20;

// merged forward + svi history, for client-side odds repricing
export class SurfaceService {
    constructor(private redis: Redis) {}

    async getSurface(oracleId: string, range: Range, points: number): Promise<SurfacePoint[]> {
        const cfg = RANGES[range] ?? RANGES["1d"];
        const ck = surfaceKey(oracleId, range, points);

        const hit = await this.redis.get(ck);
        if (hit) return JSON.parse(hit) as SurfacePoint[];

        const [prices, svis] = await Promise.all([
            getJson<any[]>(`/oracles/${oracleId}/prices?limit=${cfg.priceLimit}`),
            getJson<any[]>(`/oracles/${oracleId}/svi?limit=${cfg.sviLimit}`),
        ]);

        // anchor the range to the data's latest point, so settled markets work too
        const maxT = (prices ?? []).reduce(
            (mx, p) => Math.max(mx, Number(p.checkpoint_timestamp_ms)),
            0,
        );
        const cutoff = cfg.lookbackMs === Infinity ? 0 : maxT - cfg.lookbackMs;
        const merged = mergeSurface(prices ?? [], svis ?? [], cutoff);
        const out = downsample(merged, points);

        await this.redis.set(ck, JSON.stringify(out), "EX", CACHE_TTL_S);
        return out;
    }
}
