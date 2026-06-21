import { env } from "./env";

// pyth hermes price-feed ids per underlying (network-agnostic, from pyth.network/price-feeds).
// add a feed here before leverage liquidations can run on a new asset.
const FEEDS: Record<string, string> = {
    BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    SUI: "23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
    SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    AVAX: "93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7",
    BNB: "2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
    APT: "03ae4db29ed4ae33d323568895aa00337e658e348b37509f5372ae51f0af00d5",
    ARB: "3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5",
    DOGE: "dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c",
    XRP: "ec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8",
};

const CACHE_MS = 3_000; // briefly cache each feed
const PYTH_STALE_MS = 30_000; // pyth's own publish must be recent

const cache = new Map<string, { price: number; at: number }>();

// one feed's latest price. throws on http error, missing, stale, or non-positive.
async function fetchFeed(feedId: string): Promise<number> {
    const id = feedId.replace(/^0x/, "");
    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.price;

    const res = await fetch(`${env.pythHermesUrl}/v2/updates/price/latest?ids[]=${id}`);
    if (!res.ok) throw new Error(`hermes -> ${res.status}`);
    const json = await res.json();
    const p = json?.parsed?.[0]?.price;
    if (!p) throw new Error("no pyth price");

    const ageMs = Date.now() - Number(p.publish_time) * 1000;
    if (ageMs > PYTH_STALE_MS) throw new Error(`pyth stale ${Math.round(ageMs / 1000)}s`);
    const price = Number(p.price) * 10 ** Number(p.expo); // expo is negative
    if (!(price > 0)) throw new Error("bad pyth price");

    cache.set(id, { price, at: Date.now() });
    return price;
}

export const pythFeedFor = (underlying: string): string | undefined => FEEDS[underlying.toUpperCase()];

// independent price for an underlying. throws if no feed or hermes unavailable/stale.
export async function getPythPrice(underlying: string): Promise<number> {
    const feed = pythFeedFor(underlying);
    if (!feed) throw new Error(`no pyth feed for ${underlying}`);
    return fetchFeed(feed);
}

export interface CrossCheck {
    ok: boolean;
    bps: number; // divergence of the oracle spot from pyth, in basis points
    pyth: number;
}

// compare an oracle spot to the independent pyth price. throws if pyth is unavailable.
export async function crossCheck(underlying: string, oracleSpot: number, toleranceBps: number): Promise<CrossCheck> {
    const pyth = await getPythPrice(underlying);
    const bps = (Math.abs(oracleSpot - pyth) / pyth) * 10_000;
    return { ok: bps <= toleranceBps, bps, pyth };
}

// latest SUI/USD, for pricing SUI deposits and withdrawals
export async function getSuiUsd(): Promise<number> {
    return fetchFeed(FEEDS.SUI);
}
