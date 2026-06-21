import type Redis from "ioredis";
import { sleep } from "../lib/predict";
import { env } from "../lib/env";
import { genesis, getPool, rebalanceMargin, POOL } from "../lib/pool";
import { publish } from "../lib/bus";
import type { TreasuryService } from "./treasury";

const TICK_MS = 30_000;

// seeds the pool from the platform reserve and runs the DeepBook Margin water marks (mainnet only)
export class PoolService {
    constructor(
        private redis: Redis,
        private treasury: TreasuryService,
    ) {}

    async start() {
        // Pred seeds the pool with its existing reserve as first-loss capital, so capacity is continuous
        const reserve = await this.treasury.reserveBalance().catch(() => 0);
        await genesis(this.redis, reserve);
        const p = await getPool(this.redis);
        console.log(`[pool] genesis assets=${(p.assets / 1e6).toFixed(2)} shares=${p.shares}`);
        this.loop();
    }

    private async loop() {
        for (;;) {
            try {
                await this.tick();
            } catch (e: any) {
                console.error("pool:", e?.message ?? e);
            }
            await sleep(TICK_MS);
        }
    }

    // keep `hot` inside the water marks; supply the excess to Margin, pull back when low.
    // gated off on testnet (mock DUSDC has no Margin pool); on mainnet, pair each move with the
    // on-chain supply/withdraw of our own funds before applying the accounting via rebalanceMargin.
    private async tick() {
        const p = await getPool(this.redis);
        if (env.marginEnabled && p.assets > 0) {
            const hotFrac = p.hot / p.assets;
            if (hotFrac > POOL.marginHighFrac) {
                const excess = Math.round(p.hot - POOL.marginHighFrac * p.assets);
                // mainnet: await this.treasury.supplyMargin(excess) of our own USDC, then:
                await rebalanceMargin(this.redis, Math.min(excess, p.hot));
            } else if (hotFrac < POOL.marginLowFrac) {
                const need = Math.round(POOL.marginHighFrac * p.assets - p.hot);
                // mainnet: await this.treasury.withdrawMargin(need) of our own USDC, then:
                await rebalanceMargin(this.redis, -Math.min(need, p.supplied));
            }
        }
        await publish(this.redis, "pool:update", await getPool(this.redis));
    }
}
