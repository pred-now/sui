import type Redis from "ioredis";

// prices and strikes are 1e9 scaled
export const PRICE_SCALE = 1_000_000_000;

export interface Market {
    oracleId: string;
    underlying: string;
    expiry: number;
    status: string;
    minStrike: number;
    tickSize: number;
    activatedAt: number;
}

// full state DeepBook provides per market
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

// redis keys and pub/sub channel
export const MARKETS_KEY = "markets";
export const DETAILS_KEY = "market:details";
export const EVENTS_CHANNEL = "discovery:events";

// build a Market from an oracle list/state entry
export function toMarket(o: any): Market {
    return {
        oracleId: o.oracle_id ?? o.id,
        underlying: (o.underlying_asset ?? "").toUpperCase(),
        expiry: Number(o.expiry),
        status: o.status,
        minStrike: Number(o.min_strike ?? 0),
        tickSize: Number(o.tick_size ?? 0),
        activatedAt: Number(o.activated_at ?? 0),
    };
}

// signed value from a magnitude and a negative flag
function signed(v: any, neg: any): number {
    return Number(v) * (neg ? -1 : 1);
}

// normalize an /oracles/{id}/state response into MarketDetails
export function toDetails(state: any): MarketDetails {
    const o = state.oracle ?? {};
    const p = state.latest_price;
    const s = state.latest_svi;
    return {
        oracleId: o.oracle_id,
        underlying: (o.underlying_asset ?? "").toUpperCase(),
        status: o.status,
        expiry: Number(o.expiry),
        minStrike: Number(o.min_strike ?? 0) / PRICE_SCALE,
        tickSize: Number(o.tick_size ?? 0) / PRICE_SCALE,
        activatedAt: Number(o.activated_at ?? 0),
        settlementPrice: o.settlement_price == null ? null : Number(o.settlement_price) / PRICE_SCALE,
        settledAt: o.settled_at == null ? null : Number(o.settled_at),
        price: p
            ? {
                  spot: Number(p.spot) / PRICE_SCALE,
                  forward: Number(p.forward) / PRICE_SCALE,
                  checkpoint: Number(p.checkpoint),
                  timestampMs: Number(p.checkpoint_timestamp_ms),
              }
            : null,
        svi: s
            ? {
                  // svi params are 1e9 scaled
                  a: Number(s.a) / PRICE_SCALE,
                  b: Number(s.b) / PRICE_SCALE,
                  rho: signed(s.rho, s.rho_negative) / PRICE_SCALE,
                  m: signed(s.m, s.m_negative) / PRICE_SCALE,
                  sigma: Number(s.sigma) / PRICE_SCALE,
                  checkpoint: Number(s.checkpoint),
                  timestampMs: Number(s.checkpoint_timestamp_ms),
              }
            : null,
        askBounds: state.ask_bounds ?? null,
        updatedAt: Date.now(),
    };
}

// read cached details for one market
export async function getDetails(redis: Redis, oracleId: string): Promise<MarketDetails | null> {
    const json = await redis.hget(DETAILS_KEY, oracleId);
    return json ? (JSON.parse(json) as MarketDetails) : null;
}

// read all markets, grouped by underlying, sorted by expiry
export async function groupedSnapshot(redis: Redis): Promise<Record<string, Market[]>> {
    const raw = await redis.hgetall(MARKETS_KEY);
    const out: Record<string, Market[]> = {};
    for (const json of Object.values(raw)) {
        const m = JSON.parse(json) as Market;
        (out[m.underlying] ??= []).push(m);
    }
    for (const list of Object.values(out)) {
        list.sort((a, b) => a.expiry - b.expiry);
    }
    return out;
}
