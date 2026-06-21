import type Redis from "ioredis";
import { ECON } from "./econ";

// per-market house book. exposures are in contracts (1 contract pays $1 on win).
export interface Book {
    internalYes: number; // YES contracts users hold against the house
    internalNo: number;
    hedgedToVault: number; // signed net laid off on the vault, yes-positive
    velocity: number; // decayed signed flow, yes-positive
    velTs: number;
    updatedAt: number;
}

const ZERO: Book = { internalYes: 0, internalNo: 0, hedgedToVault: 0, velocity: 0, velTs: 0, updatedAt: 0 };

export const bookKey = (oracleId: string, strike: number) => `book:${oracleId}:${strike}`;

// net YES exposure on the house = internalYes - internalNo - hedgedToVault
export function netExposure(b: Book): number {
    return b.internalYes - b.internalNo - b.hedgedToVault;
}

// decay the signed-flow velocity to now
export function decayedVelocity(b: Book, now = Date.now()): number {
    if (!b.velTs) return 0;
    return b.velocity * Math.pow(0.5, (now - b.velTs) / ECON.velocityHalfLifeMs);
}

export async function getBook(redis: Redis, oracleId: string, strike: number): Promise<Book> {
    const raw = await redis.get(bookKey(oracleId, strike));
    return raw ? { ...ZERO, ...(JSON.parse(raw) as Partial<Book>) } : { ...ZERO };
}

export async function setBook(redis: Redis, oracleId: string, strike: number, b: Book): Promise<void> {
    await redis.set(bookKey(oracleId, strike), JSON.stringify(b));
}
