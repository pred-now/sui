import type Redis from "ioredis";

export interface Tx {
    type: "deposit" | "withdraw";
    asset: string; // USDC | SUI
    usd: number; // usd base units credited or debited
    at: number;
    ref?: string; // coin object id (deposit) or tx digest (withdraw)
    to?: string; // destination, withdrawals
}

const txKey = (userId: string) => `tx:${userId}`;
const MAX = 100;

// lifetime usd totals, survive the capped tx list
const depositedKey = (userId: string) => `deposited:total:${userId}`;
const withdrawnKey = (userId: string) => `withdrawn:total:${userId}`;

// newest first, capped. also bumps the lifetime total
export async function recordTx(redis: Redis, userId: string, tx: Tx): Promise<void> {
    await redis.lpush(txKey(userId), JSON.stringify(tx));
    await redis.ltrim(txKey(userId), 0, MAX - 1);
    const key = tx.type === "deposit" ? depositedKey(userId) : withdrawnKey(userId);
    await redis.incrby(key, tx.usd);
}

export async function listTx(redis: Redis, userId: string): Promise<Tx[]> {
    const raw = await redis.lrange(txKey(userId), 0, -1);
    return raw.map(r => JSON.parse(r) as Tx);
}

// lifetime deposited and withdrawn, usd base units
export async function getTotals(
    redis: Redis,
    userId: string,
): Promise<{ deposited: number; withdrawn: number }> {
    const [d, w] = await Promise.all([
        redis.get(depositedKey(userId)),
        redis.get(withdrawnKey(userId)),
    ]);
    return { deposited: Number(d ?? 0), withdrawn: Number(w ?? 0) };
}

// one-time seed of totals from the existing tx lists, runs once
export async function backfillTotals(redis: Redis, userIds: string[]): Promise<void> {
    const first = await redis.set("totals:migrated", "1", "NX");
    if (!first) return;
    for (const userId of userIds) {
        let deposited = 0;
        let withdrawn = 0;
        for (const t of await listTx(redis, userId)) {
            if (t.type === "deposit") deposited += t.usd;
            else withdrawn += t.usd;
        }
        if (deposited) await redis.set(depositedKey(userId), String(deposited));
        if (withdrawn) await redis.set(withdrawnKey(userId), String(withdrawn));
    }
}
