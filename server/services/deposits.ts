import type Redis from "ioredis";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { USDC } from "../lib/config";
import { sleep, mapLimit } from "../lib/predict";
import { SUI_UNIT } from "../lib/sui";
import { getLedger, setLedger, available, depositHwKey } from "../lib/ledger";
import { publish, userRoom } from "../lib/bus";
import { recordTx } from "../lib/txlog";
import { getSuiUsd } from "../lib/pyth";
import { getUser, listUserIds } from "./user";

const POLL_MS = 10_000;
const CONCURRENCY = 4;

// serializes concurrent deposit scans so a delta is never credited twice
const depLock = (userId: string) => `lock:dep:${userId}`;

// watches proxy address balances for USDC and SUI, credits the USD ledger.
// usdc/sui arrive as fungible address balances, not coin objects, so we track
// a high-water mark per asset and credit any increase.
export class DepositWatcher {
    constructor(
        private redis: Redis,
        private client: SuiJsonRpcClient,
    ) {}

    async start() {
        this.loop();
    }

    // one pass over all users, credits any new balance
    async tick() {
        const ids = await listUserIds(this.redis);
        await mapLimit(ids, CONCURRENCY, id => this.check(id));
    }

    private async loop() {
        for (;;) {
            try {
                await this.tick();
            } catch (e: any) {
                console.error("deposit watch:", e?.message ?? e);
            }
            await sleep(POLL_MS);
        }
    }

    private async check(userId: string) {
        const user = await getUser(this.redis, userId);
        if (!user) return;

        const got = await this.redis.set(depLock(userId), "1", "EX", 30, "NX");
        if (!got) return; // another tick is scanning this user
        try {
            const usdc = await this.balance(user.address, USDC);
            await this.creditDelta(userId, USDC, "USDC", usdc, d => d);

            const sui = await this.balance(user.address, SUI_TYPE_ARG);
            const price = sui > 0 ? await getSuiUsd() : 0;
            await this.creditDelta(userId, SUI_TYPE_ARG, "SUI", sui, d =>
                Math.round((d / SUI_UNIT) * price * 1e6),
            );
        } catch (e: any) {
            console.error("deposit check:", userId, e?.message ?? e);
        } finally {
            await this.redis.del(depLock(userId));
        }
    }

    private async balance(owner: string, coinType: string): Promise<number> {
        return Number((await this.client.getBalance({ owner, coinType })).totalBalance);
    }

    // credit any increase over the high-water mark, then advance it
    private async creditDelta(
        userId: string,
        coinType: string,
        asset: string,
        current: number,
        toUsd: (delta: number) => number,
    ) {
        const key = depositHwKey(userId, coinType);
        const hw = Number((await this.redis.get(key)) ?? 0);
        if (current > hw) {
            const usd = toUsd(current - hw);
            if (usd > 0) {
                const l = await getLedger(this.redis, userId);
                l.balance += usd;
                await setLedger(this.redis, userId, l);
                await recordTx(this.redis, userId, { type: "deposit", asset, usd, at: Date.now() });
                // push the new balance to the user's socket
                await publish(this.redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(userId));
                console.log(`[deposit] ${userId} ${asset} +$${(usd / 1e6).toFixed(2)}`);
            }
        }
        await this.redis.set(key, String(current));
    }
}
