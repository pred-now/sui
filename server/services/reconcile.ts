import type Redis from "ioredis";
import { sleep } from "../lib/predict";
import { getLedger } from "../lib/ledger";
import { getPool, sharePrice, freeCapital } from "../lib/pool";
import { listUserIds } from "./user";
import type { TreasuryService } from "./treasury";

const RECONCILE_MS = 60_000;

// reports the platform DUSDC reserve against total user liabilities
export class ReconcileService {
    constructor(
        private redis: Redis,
        private treasury: TreasuryService,
    ) {}

    async start() {
        this.loop();
    }

    private async loop() {
        for (;;) {
            try {
                const reserve = await this.treasury.reserveBalance();
                const ids = await listUserIds(this.redis);
                let liabilities = 0;
                let locked = 0;
                for (const id of ids) {
                    const l = await getLedger(this.redis, id);
                    liabilities += l.balance;
                    locked += l.locked;
                }
                const pool = await getPool(this.redis);
                const free = await freeCapital(this.redis);
                const usd = (n: number) => (n / 1e6).toFixed(2);
                // platform claims (liabilities + pool + protocol) net to the reserve + supplied, off by
                // the outstanding vault hedge value (open mints not yet redeemed)
                const drift = liabilities + pool.assets + pool.protocol - reserve - pool.supplied;
                console.log(
                    `[reconcile] reserve=${usd(reserve)} dusdc liabilities=${usd(liabilities)} usd ` +
                        `openBets=${usd(locked)} usd users=${ids.length} | ` +
                        `pool=${usd(pool.assets)} share=${sharePrice(pool).toFixed(4)} free=${usd(free)} ` +
                        `protocol=${usd(pool.protocol)} drift=${usd(drift)}`,
                );
            } catch (e: any) {
                console.error("reconcile:", e?.message ?? e);
            }
            await sleep(RECONCILE_MS);
        }
    }
}
