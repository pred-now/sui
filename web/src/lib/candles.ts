// candle fetching, mirrors sui/server/lib/candles.ts

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface Candle {
    time: number; // ms epoch
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// timeframe button -> candle interval
export const TF_INTERVAL: Record<string, string> = {
    "1H": "1m",
    "6H": "5m",
    "1D": "15m",
    "1W": "1h",
    ALL: "1h",
};

// timeframe button -> visible lookback window
export const TF_LOOKBACK_MS: Record<string, number> = {
    "1H": 3_600_000,
    "6H": 21_600_000,
    "1D": 86_400_000,
    "1W": 604_800_000,
    ALL: Infinity,
};

export interface SeriesPoint {
    time: number;
    price: number;
}

// raw per-write points, smoother than candles for a line
export async function fetchSeries(
    oracleId: string,
    type: "spot" | "contract" | "prob",
    side: "YES" | "NO",
): Promise<SeriesPoint[]> {
    const q = new URLSearchParams({ type, side });
    const res = await fetch(`${API_URL}/markets/${oracleId}/series?${q}`);
    if (!res.ok) throw new Error(`series -> ${res.status}`);
    return res.json();
}

export async function fetchCandles(
    oracleId: string,
    type: "spot" | "contract" | "prob",
    side: "YES" | "NO",
    interval: string,
): Promise<Candle[]> {
    const q = new URLSearchParams({ type, side, interval });
    const res = await fetch(`${API_URL}/markets/${oracleId}/candles?${q}`);
    if (!res.ok) throw new Error(`candles -> ${res.status}`);
    return res.json();
}
