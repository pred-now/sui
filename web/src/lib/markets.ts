// shared shape with sui/server/lib/market.ts
export interface Market {
    oracleId: string;
    underlying: string;
    expiry: number;
    status: string;
    minStrike: number;
    tickSize: number;
    activatedAt: number;
}

// snapshot is grouped by underlying
export type Snapshot = Record<string, Market[]>;

// mirrors MarketDetails in sui/server/lib/market.ts
export interface MarketDetails {
    oracleId: string;
    underlying: string;
    status: string;
    expiry: number;
    minStrike: number;
    tickSize: number;
    activatedAt: number;
    settlementPrice: number | null;
    settledAt: number | null;
    price: {
        spot: number;
        forward: number;
        checkpoint: number;
        timestampMs: number;
    } | null;
    svi: {
        a: number;
        b: number;
        rho: number;
        m: number;
        sigma: number;
        checkpoint: number;
        timestampMs: number;
    } | null;
    askBounds: unknown;
    updatedAt: number;
}

// Abramowitz & Stegun erf approximation
function erf(x: number): number {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y =
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
            0.284496736) *
            t +
            0.254829592) *
            t *
            Math.exp(-x * x);
    return s * y;
}

function normCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

// SVI total variance at log-moneyness k
function sviTotalVar(
    svi: NonNullable<MarketDetails["svi"]>,
    k: number,
): number {
    const d = k - svi.m;
    return (
        svi.a + svi.b * (svi.rho * d + Math.sqrt(d * d + svi.sigma * svi.sigma))
    );
}

// fair YES probability, digital call N(d2). null if unpriceable
export function fairYes(d: MarketDetails): number | null {
    // settled markets resolve to 0 or 1
    if (d.settlementPrice != null) return d.settlementPrice >= d.minStrike ? 1 : 0;
    if (!d.price || !d.svi || d.minStrike <= 0 || d.price.forward <= 0)
        return null;
    const k = Math.log(d.minStrike / d.price.forward);
    const w = sviTotalVar(d.svi, k);
    if (w <= 0) return null;
    const d2 = (-k - w / 2) / Math.sqrt(w);
    return normCdf(d2);
}

// probability 0..1 to cents, e.g. "76.3¢"
export function toCents(p: number): string {
    return `${(p * 100).toFixed(1)}¢`;
}

// "$104,213"
export function formatUsd(n: number): string {
    return `$${Math.round(n).toLocaleString("en-US")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

// DD.HH.MM.SS / H.MM.SS / MM.SS, leading unit unpadded
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `${d}.${pad(h)}.${pad(m)}.${pad(s)}`;
    if (h > 0) return `${h}.${pad(m)}.${pad(s)}`;
    return `${pad(m)}.${pad(s)}`;
}

// strike subtitle, e.g. "≥ $100,000"
export function strikeText(n: number): string {
    return n > 0 ? `≥ $${n.toLocaleString("en-US")}` : "≥ strike";
}

// "Jun 30, 2026"
export function formatExpiryDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

// "Jun 30"
export function formatExpiryShort(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
}

export function marketQuestion(m: Market): string {
    return `Will BTC close ${strikeText(m.minStrike)} on ${formatExpiryShort(m.expiry)}?`;
}
