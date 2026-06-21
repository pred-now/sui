import { PRICE_SCALE } from "./market";

// one merged snapshot: forward plus the SVI params at that time
export interface SurfacePoint {
    t: number;
    forward: number;
    a: number;
    b: number;
    rho: number;
    m: number;
    sigma: number;
}

export type Range = "1h" | "6h" | "1d" | "all";

// range -> lookback ms and feed fetch limits
export const RANGES: Record<Range, { lookbackMs: number; priceLimit: number; sviLimit: number }> = {
    "1h": { lookbackMs: 3_600_000, priceLimit: 4_000, sviLimit: 1_000 },
    "6h": { lookbackMs: 21_600_000, priceLimit: 20_000, sviLimit: 4_000 },
    "1d": { lookbackMs: 86_400_000, priceLimit: 20_000, sviLimit: 20_000 },
    all: { lookbackMs: Infinity, priceLimit: 20_000, sviLimit: 20_000 },
};

export const surfaceKey = (oid: string, range: string, points: number) =>
    `surface:${oid}:${range}:${points}`;

function signed(v: any, neg: any): number {
    return Number(v) * (neg ? -1 : 1);
}

// merge price and svi feeds: sample at price times, carry last svi forward
export function mergeSurface(prices: any[], svis: any[], cutoff: number): SurfacePoint[] {
    // both feeds come newest-first, sort ascending by time
    const ps = [...prices].sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);
    const ss = [...svis].sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);

    const out: SurfacePoint[] = [];
    let si = 0;
    let cur: any = null;
    for (const p of ps) {
        const t = Number(p.checkpoint_timestamp_ms);
        if (t < cutoff) continue;
        // advance svi pointer to the last one at or before t
        while (si < ss.length && Number(ss[si].checkpoint_timestamp_ms) <= t) {
            cur = ss[si];
            si++;
        }
        if (!cur) continue; // no svi yet for this price
        out.push({
            t,
            forward: Number(p.forward) / PRICE_SCALE,
            a: Number(cur.a) / PRICE_SCALE,
            b: Number(cur.b) / PRICE_SCALE,
            rho: signed(cur.rho, cur.rho_negative) / PRICE_SCALE,
            m: signed(cur.m, cur.m_negative) / PRICE_SCALE,
            sigma: Number(cur.sigma) / PRICE_SCALE,
        });
    }
    return out;
}

// keep at most `points` by striding evenly, always keep the last
export function downsample(points: SurfacePoint[], target: number): SurfacePoint[] {
    if (points.length <= target) return points;
    const step = points.length / target;
    const out: SurfacePoint[] = [];
    for (let i = 0; i < target; i++) out.push(points[Math.floor(i * step)]);
    out.push(points[points.length - 1]);
    return out;
}
