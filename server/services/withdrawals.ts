import type Redis from "ioredis";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { USDC } from "../lib/config";
import { SUI_UNIT } from "../lib/sui";
import { getLedger, debit, available, depositHwKey } from "../lib/ledger";
import { publish, userRoom } from "../lib/bus";
import { recordTx } from "../lib/txlog";
import { getSuiUsd } from "../lib/pyth";
import { getUser } from "./user";
import type { CustodyService } from "./custody";
import type { TreasuryService } from "./treasury";

export interface WithdrawResult {
    status: string;
    digest: string;
    usd: number; // usd base units debited
    to: string;
}

const lockKey = (userId: string) => `lock:wd:${userId}`;
const wdKey = (id: string) => `wd:${id}`;
const SUI_GAS_BUFFER = 20_000_000; // keep 0.02 SUI for gas

const addr = (userId: string) => `withdrawAddr:${userId}`;

// withdraw USDC: debit the usd ledger 1:1, pay from the admin float
export async function withdrawUsdc(
    redis: Redis,
    treasury: TreasuryService,
    userId: string,
    base: number,
    id: string,
): Promise<WithdrawResult> {
    if (!Number.isInteger(base) || base <= 0) throw new Error("bad amount");
    const to = await redis.get(addr(userId));
    if (!to) throw new Error("no registered withdrawal address");

    const got = await redis.set(lockKey(userId), "1", "EX", 60, "NX");
    if (!got) throw new Error("withdrawal in progress");
    try {
        const prior = await redis.get(wdKey(id));
        if (prior) return JSON.parse(prior) as WithdrawResult; // idempotent retry

        // usdc base units equal usd base units
        if (base > available(await getLedger(redis, userId))) throw new Error("amount exceeds balance");

        await redis.set(wdKey(id), JSON.stringify({ status: "pending", usd: base, to }));

        let digest: string;
        try {
            digest = await treasury.payout(to, USDC, base);
        } catch (e) {
            await redis.del(wdKey(id)); // failed, allow a clean retry
            throw e;
        }

        await debit(redis, userId, base);
        await recordTx(redis, userId, { type: "withdraw", asset: "USDC", usd: base, at: Date.now(), ref: digest, to });
        const l = await getLedger(redis, userId);
        await publish(redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(userId));
        const result: WithdrawResult = { status: "done", digest, usd: base, to };
        await redis.set(wdKey(id), JSON.stringify(result));
        return result;
    } finally {
        await redis.del(lockKey(userId));
    }
}

// withdraw SUI: debit the usd-equivalent via pyth, pay from the proxy wallet
export async function withdrawSui(
    redis: Redis,
    custody: CustodyService,
    client: SuiJsonRpcClient,
    userId: string,
    base: number,
    id: string,
): Promise<WithdrawResult> {
    if (!Number.isInteger(base) || base <= 0) throw new Error("bad amount");
    const user = await getUser(redis, userId);
    if (!user) throw new Error("no account");
    const to = await redis.get(addr(userId));
    if (!to) throw new Error("no registered withdrawal address");

    const got = await redis.set(lockKey(userId), "1", "EX", 60, "NX");
    if (!got) throw new Error("withdrawal in progress");
    try {
        const prior = await redis.get(wdKey(id));
        if (prior) return JSON.parse(prior) as WithdrawResult;

        // usd value of the sui amount, checked against the ledger
        const usd = Math.round((base / SUI_UNIT) * (await getSuiUsd()) * 1e6);
        if (usd > available(await getLedger(redis, userId))) throw new Error("amount exceeds balance");

        // proxy pays its own gas, leave a buffer
        const coins = await client.getCoins({ owner: user.address, coinType: SUI_TYPE_ARG });
        const total = coins.data.reduce((s, c) => s + Number(c.balance), 0);
        if (base + SUI_GAS_BUFFER > total) throw new Error("not enough sui in wallet");

        await redis.set(wdKey(id), JSON.stringify({ status: "pending", usd, to }));

        let digest: string;
        try {
            digest = await custody.executeSelf(userId, "withdraw-sui", tx => {
                const [coin] = tx.splitCoins(tx.gas, [BigInt(base)]);
                tx.transferObjects([coin], to);
            });
            await client.waitForTransaction({ digest });
        } catch (e) {
            await redis.del(wdKey(id));
            throw e;
        }

        await debit(redis, userId, usd);
        // proxy sui dropped by base, lower the deposit mark so it is not re-credited
        const hwk = depositHwKey(userId, SUI_TYPE_ARG);
        await redis.set(hwk, String(Math.max(0, Number((await redis.get(hwk)) ?? 0) - base)));
        await recordTx(redis, userId, { type: "withdraw", asset: "SUI", usd, at: Date.now(), ref: digest, to });
        const l = await getLedger(redis, userId);
        await publish(redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(userId));
        const result: WithdrawResult = { status: "done", digest, usd, to };
        await redis.set(wdKey(id), JSON.stringify(result));
        return result;
    } finally {
        await redis.del(lockKey(userId));
    }
}
