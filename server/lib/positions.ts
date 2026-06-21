import type Redis from "ioredis";
import type { Side } from "./quote";

// one user's accumulated position in one market. cost is total stake locked.
export interface Position {
    yesContracts: number;
    noContracts: number;
    cost: number; // usd base units
    updatedAt: number;
}

const ZERO: Position = { yesContracts: 0, noContracts: 0, cost: 0, updatedAt: 0 };

export const posKey = (userId: string, oracleId: string, strike: number) => `pos:${userId}:${oracleId}:${strike}`;
export const posIndex = (oracleId: string, strike: number) => `positions:${oracleId}:${strike}`;

export async function getPosition(redis: Redis, userId: string, oracleId: string, strike: number): Promise<Position> {
    const raw = await redis.get(posKey(userId, oracleId, strike));
    return raw ? { ...ZERO, ...(JSON.parse(raw) as Partial<Position>) } : { ...ZERO };
}

// add a fill onto the running position
export function addFill(p: Position, side: Side, contracts: number, stake: number): Position {
    return {
        yesContracts: p.yesContracts + (side === "yes" ? contracts : 0),
        noContracts: p.noContracts + (side === "no" ? contracts : 0),
        cost: p.cost + stake,
        updatedAt: Date.now(),
    };
}

// payout in usd base units if YES (or NO) resolves; 1 contract pays $1
export function payoutOf(p: Position, yesWon: boolean, unit: number): number {
    return Math.round((yesWon ? p.yesContracts : p.noContracts) * unit);
}
