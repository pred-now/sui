import type Redis from "ioredis";
import type { Side } from "./quote";

// one closed bet, however it ended: user close, liquidation, cliff, or settlement
export interface HistRecord {
    oracleId: string;
    strike: number;
    side: Side;
    leverage: number;
    reason: string; // close | liquidation | cliff | settle
    contracts: number;
    margin: number; // usd base units
    borrowed: number;
    entryAsk: number;
    mark: number; // exit mark, side terms
    value: number;
    returned: number;
    badDebt: number;
    pnl: number; // returned - margin, usd base units
    openedAt: number;
    closedAt: number;
}

const histKey = (userId: string) => `hist:${userId}`;
const MAX = 200;

// newest first, capped
export async function recordClose(redis: Redis, userId: string, rec: HistRecord): Promise<void> {
    await redis.lpush(histKey(userId), JSON.stringify(rec));
    await redis.ltrim(histKey(userId), 0, MAX - 1);
}

export async function listHistory(redis: Redis, userId: string): Promise<HistRecord[]> {
    const raw = await redis.lrange(histKey(userId), 0, -1);
    return raw.map(r => JSON.parse(r) as HistRecord);
}
