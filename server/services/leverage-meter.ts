import type Redis from "ioredis";
import { sleep } from "../lib/predict";
import { ElasticityMeter, recommend } from "../lib/elasticity-meter";
import { setDynamicK } from "../lib/leverage";

const POLL_MS = 60_000;
const MIN_SAMPLES = 200; // calibration period before acting
const MAX_STDERR = 0.05; // only retune once the estimate is tight

// reads the live elasticity meter and tunes dynamicK via the control law
export class LeverageMeterService {
    constructor(private redis: Redis) {}

    async start() {
        this.loop();
    }

    private async loop() {
        for (;;) {
            try {
                await this.tick();
            } catch (e: any) {
                console.error("meter:", e?.message ?? e);
            }
            await sleep(POLL_MS);
        }
    }

    async tick() {
        const raw = await this.redis.get("lev:meter");
        if (!raw) return;
        const m = JSON.parse(raw) as { sxx: number; sxy: number; n: number };
        if (m.n < MIN_SAMPLES) return;

        const meter = new ElasticityMeter();
        meter.restore(m);
        const e = meter.estimate();
        const se = meter.stderr();
        if (!Number.isFinite(e) || !Number.isFinite(se) || se > MAX_STDERR) return;

        const rec = recommend(e);
        await setDynamicK(this.redis, rec.dynamicK);
        console.log(`[meter] e=${e.toFixed(2)} ±${se.toFixed(3)} n=${m.n} -> dynamicK=${rec.dynamicK} (${rec.mode})`);
    }
}
