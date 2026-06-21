// fair YES probability from forward, strike, and the SVI vol surface.
// mirrors fairYes in sui/web/src/lib/markets.ts

export interface Svi {
    a: number;
    b: number;
    rho: number;
    m: number;
    sigma: number;
}

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

// SVI total variance at log-moneyness k
function sviTotalVar(svi: Svi, k: number): number {
    const d = k - svi.m;
    return svi.a + svi.b * (svi.rho * d + Math.sqrt(d * d + svi.sigma * svi.sigma));
}

// digital call N(d2), null if unpriceable. forward and strike share units
export function fairYes(forward: number, strike: number, svi: Svi): number | null {
    if (strike <= 0 || forward <= 0) return null;
    const k = Math.log(strike / forward);
    const w = sviTotalVar(svi, k);
    if (w <= 0) return null;
    const d2 = (-k - w / 2) / Math.sqrt(w);
    return normCdf(d2);
}
