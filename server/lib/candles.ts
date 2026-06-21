// OHLC candles for Predict markets, aggregated from accumulated history.
// History is stored in redis so charts beat the upstream ~100-point window.

export interface PricePoint {
    time: number; // ms epoch
    price: number;
    size?: number;
}

export interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export const INTERVALS: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
};

// redis keys
export const spotKey = (oid: string) => `candles:spot:${oid}`;
export const tradesKey = (oid: string) => `candles:trades:${oid}`;
export const probKey = (oid: string) => `candles:prob:${oid}`;
export const cacheKey = (oid: string, type: string, side: string, interval: string) =>
    `candles:cache:${oid}:${type}:${side}:${interval}`;

// pure: bucket points into OHLC candles, input may be unsorted
export function aggregateOHLC(points: PricePoint[], intervalMs: number): Candle[] {
    const sorted = [...points].sort((a, b) => a.time - b.time);
    const buckets = new Map<number, Candle>();

    for (const p of sorted) {
        const key = Math.floor(p.time / intervalMs) * intervalMs;
        const c = buckets.get(key);
        if (!c) {
            buckets.set(key, {
                time: key,
                open: p.price,
                high: p.price,
                low: p.price,
                close: p.price,
                volume: p.size ?? 0,
            });
        } else {
            c.high = Math.max(c.high, p.price);
            c.low = Math.min(c.low, p.price);
            c.close = p.price; // sorted, last seen is the close
            c.volume += p.size ?? 0;
        }
    }

    return [...buckets.values()].sort((a, b) => a.time - b.time);
}
