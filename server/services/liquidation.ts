import type Redis from "ioredis";
import { getDetails, type MarketDetails } from "../lib/market";
import { fairYes } from "../lib/pricing";
import { sleep } from "../lib/predict";
import { DUSDC_UNIT } from "../lib/sui";
import { ECON } from "../lib/econ";
import { LEV, equityOf } from "../lib/leverage";
import { LEV_POSITIONS, type LevPosition } from "../lib/levbook";
import { crossCheck } from "../lib/pyth";
import type { BetEngine } from "./engine";

const POLL_MS = 5_000;
const crossKey = (key: string) => `lev:cross:${key}`;

// marks leveraged positions off the surface; liquidates underwater ones and runs the cliff
export class LiquidationService {
    constructor(
        private redis: Redis,
        private engine: BetEngine,
    ) {}

    async start() {
        this.loop();
    }

    private async loop() {
        for (;;) {
            try {
                await this.tick();
            } catch (e: any) {
                console.error("liquidation:", e?.message ?? e);
            }
            await sleep(POLL_MS);
        }
    }

    // one pass over every open leveraged position
    async tick() {
        const keys = await this.redis.smembers(LEV_POSITIONS);
        for (const key of keys) {
            const raw = await this.redis.get(key);
            if (!raw) {
                await this.redis.srem(LEV_POSITIONS, key);
                continue;
            }
            await this.evaluate(key, JSON.parse(raw) as LevPosition);
        }
    }

    private async evaluate(key: string, pos: LevPosition) {
        const d = await getDetails(this.redis, pos.oracleId);
        if (!d?.price || !d.svi) return;
        // a 1x bet borrows nothing: it can never go underwater and has no leverage to shed at the
        // cliff. it rides to settlement (closed at the binary outcome there) and stays user-closeable.
        if (pos.borrowed <= 0) return;
        const now = Date.now();

        // deleverage cliff: in the final minute force-close, so the resolution jump never hits leverage
        if (d.expiry - now <= LEV.cliffMs) {
            await this.engine.forceUnwind(pos.userId, pos.oracleId, pos.strike, pos.side, "cliff");
            await this.redis.del(crossKey(key));
            return;
        }

        // never liquidate on a stale oracle or when the pyth cross-check fails
        if (now - d.price.timestampMs > ECON.stalenessMs) return;
        if (!(await this.pythOk(d))) return;

        const f = fairYes(d.price.forward, pos.strike, d.svi);
        if (f == null) return;
        const { value, equity } = equityOf(pos.contracts, pos.side, pos.borrowed, pos.rate, pos.fees, pos.accruedAt, f, now, DUSDC_UNIT);
        const under = equity < LEV.maintenance * value;

        if (!under) {
            await this.redis.del(crossKey(key));
            return;
        }
        // 30s delay: liquidatable only after staying underwater past liqDelayMs (deny single-update manipulation)
        const crossedAt = Number((await this.redis.get(crossKey(key))) ?? 0);
        if (!crossedAt) {
            await this.redis.set(crossKey(key), String(now));
            return;
        }
        if (now - crossedAt < LEV.liqDelayMs) return;
        await this.redis.del(crossKey(key));
        await this.engine.forceUnwind(pos.userId, pos.oracleId, pos.strike, pos.side, "liquidation");
    }

    // oracle vs independent pyth cross-check. fail closed: never liquidate on a mark we cannot
    // verify (oracle manipulation, pyth outage, stale pyth, or an unmapped asset all pause it).
    // the deleverage cliff still force-closes before expiry, so a prolonged pause is backstopped.
    private async pythOk(d: MarketDetails): Promise<boolean> {
        if (!d.price) return false;
        try {
            const { ok, bps } = await crossCheck(d.underlying, d.price.spot, LEV.pythDivergenceBps);
            if (!ok) console.warn(`[liquidation] paused ${d.underlying} ${d.oracleId.slice(0, 10)}: oracle vs pyth ${bps.toFixed(0)}bps`);
            return ok;
        } catch (e: any) {
            console.warn(`[liquidation] pyth unavailable for ${d.underlying}, pausing: ${e?.message ?? e}`);
            return false;
        }
    }
}
