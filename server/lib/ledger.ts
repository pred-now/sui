import type Redis from "ioredis";

// all amounts in USD base units (1e6), since 1 USD = 1 DUSDC
export interface Ledger {
    balance: number; // deposits minus withdrawals plus net pnl
    locked: number; // open bet exposure
    debt: number; // borrowed, future
    fees: number;
}

const ZERO: Ledger = { balance: 0, locked: 0, debt: 0, fees: 0 };
const ledgerKey = (userId: string) => `ledger:${userId}`;

// total coin base units ever credited per asset, drives deposit deltas
export const depositHwKey = (userId: string, coinType: string) =>
    `deposited:hw:${userId}:${coinType}`;

// what a user may withdraw: balance minus locked, debt and fees
export function available(l: Ledger): number {
    return Math.max(0, l.balance - l.locked - l.debt - l.fees);
}

export async function getLedger(redis: Redis, userId: string): Promise<Ledger> {
    const raw = await redis.get(ledgerKey(userId));
    return raw ? { ...ZERO, ...(JSON.parse(raw) as Partial<Ledger>) } : { ...ZERO };
}

export async function setLedger(redis: Redis, userId: string, l: Ledger): Promise<void> {
    await redis.set(ledgerKey(userId), JSON.stringify(l));
}

// add balance exactly once, keyed on an idempotency id (a coin or digest)
export async function creditUsd(
    redis: Redis,
    userId: string,
    amount: number,
    idemKey: string,
): Promise<boolean> {
    const fresh = await redis.set(idemKey, "1", "NX");
    if (!fresh) return false; // already processed
    const l = await getLedger(redis, userId);
    l.balance += amount;
    await setLedger(redis, userId, l);
    return true;
}

// remove balance, used after a withdrawal transfer confirms
export async function debit(redis: Redis, userId: string, amount: number): Promise<void> {
    const l = await getLedger(redis, userId);
    l.balance = Math.max(0, l.balance - amount);
    await setLedger(redis, userId, l);
}

// lock stake for an open bet. throws if the user cannot cover it.
export async function lockStake(redis: Redis, userId: string, stake: number): Promise<void> {
    const l = await getLedger(redis, userId);
    if (available(l) < stake) throw new Error("insufficient balance");
    l.locked += stake;
    await setLedger(redis, userId, l);
}

// settle a position: release the stake lock and apply net pnl to balance
export async function settlePosition(redis: Redis, userId: string, stake: number, payout: number): Promise<void> {
    const l = await getLedger(redis, userId);
    l.locked = Math.max(0, l.locked - stake);
    l.balance = Math.max(0, l.balance + payout - stake);
    await setLedger(redis, userId, l);
}
