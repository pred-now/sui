// historical odds: recompute YES probability for any strike from the surface.
// pricing validated against the live protocol mid (see plan Phase 0).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface Svi {
    a: number;
    b: number;
    rho: number;
    m: number;
    sigma: number;
}

// one merged snapshot from the server
export interface SurfacePoint extends Svi {
    t: number;
    forward: number;
}

// chart intervals. lowercase m = minutes, 1M = one month.
// range is the server surface window we fetch; lookbackMs is the client view.
export interface Timeframe {
    label: string;
    lookbackMs: number;
    range: string;
}

export const TIMEFRAMES: Timeframe[] = [
    { label: "1m", lookbackMs: 60_000, range: "1h" },
    { label: "3m", lookbackMs: 180_000, range: "1h" },
    { label: "5m", lookbackMs: 300_000, range: "1h" },
    { label: "15m", lookbackMs: 900_000, range: "1h" },
    { label: "1H", lookbackMs: 3_600_000, range: "1h" },
    { label: "6H", lookbackMs: 21_600_000, range: "6h" },
    { label: "12H", lookbackMs: 43_200_000, range: "1d" },
    { label: "1D", lookbackMs: 86_400_000, range: "1d" },
    { label: "1W", lookbackMs: 604_800_000, range: "all" },
    { label: "1M", lookbackMs: 2_592_000_000, range: "all" },
    { label: "ALL", lookbackMs: Infinity, range: "all" },
];

// Abramowitz & Stegun erf approximation
function erf(x: number): number {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y =
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
            0.254829592) *
            t *
            Math.exp(-x * x);
    return s * y;
}

function normCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

function sviTotalVar(svi: Svi, k: number): number {
    const d = k - svi.m;
    return svi.a + svi.b * (svi.rho * d + Math.sqrt(d * d + svi.sigma * svi.sigma));
}

// digital call N(d2). returns 0..1, or null if unpriceable
export function yesProbability(forward: number, strike: number, svi: Svi): number | null {
    if (strike <= 0 || forward <= 0) return null;
    const k = Math.log(strike / forward);
    const w = sviTotalVar(svi, k);
    if (w <= 0) return null;
    const d2 = (-k - w / 2) / Math.sqrt(w);
    return normCdf(d2);
}

// strike where YES = 50%, by bisection (yes is monotonic decreasing in strike)
export function fiftyStrike(forward: number, svi: Svi): number {
    let lo = forward * 0.5;
    let hi = forward * 1.5;
    for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        const p = yesProbability(forward, mid, svi);
        if (p == null) break;
        if (p > 0.5) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

export async function fetchSurface(
    oracleId: string,
    range: string,
    points = 2000,
): Promise<SurfacePoint[]> {
    const q = new URLSearchParams({ range, points: String(points) });
    const res = await fetch(`${API_URL}/markets/${oracleId}/surface?${q}`);
    if (!res.ok) throw new Error(`surface -> ${res.status}`);
    return res.json();
}
