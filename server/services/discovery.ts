import type Redis from "ioredis";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { env } from "../lib/env";
import { getJson, mapLimit, norm, oidOf, eventOracleId, sleep } from "../lib/predict";
import { Market, MARKETS_KEY, EVENTS_CHANNEL, toMarket } from "../lib/market";

// discovers live markets and tracks their lifecycle
export class DiscoveryService {
    private tracked = new Map<string, Market>();

    constructor(private grpc: SuiGrpcClient, private redis: Redis) {}

    async start() {
        await this.snapshot();
        this.stream();
    }

    // seed current markets from the REST list
    private async snapshot() {
        const data = await getJson(`/predicts/${env.predictId}/oracles`);
        let oracles: any[] = Array.isArray(data) ? data : data.oracles ?? [];
        console.log(`total oracles: ${oracles.length}`);

        // fetch per-oracle state once if the list is sparse
        if (oracles[0] && oracles[0].underlying_asset === undefined) {
            console.log("list is sparse, fetching per-oracle state...");
            oracles = await mapLimit(oracles, 8, async o => {
                const { oracle } = await getJson(`/oracles/${oidOf(o)}/state`);
                return oracle;
            });
        }

        const now = Date.now();
        const live = oracles.filter(o => Number(o.expiry) > now);

        await this.redis.del(MARKETS_KEY);
        for (const o of live) {
            const m = toMarket(o);
            this.tracked.set(norm(m.oracleId), m);
            await this.redis.hset(MARKETS_KEY, m.oracleId, JSON.stringify(m));
        }

        const active = live.filter(o => o.status === "active").length;
        console.log(`tracking ${live.length} markets, ${active} active`);
    }

    // gRPC checkpoint loop, reconnect with backoff
    private async stream() {
        let delay = 1000;
        for (;;) {
            try {
                await this.streamOnce();
                delay = 1000;
            } catch (e: any) {
                console.error("stream error:", e?.code ?? "", e?.message ?? e);
                delay = Math.min(delay * 2, 15000);
            }
            await sleep(delay);
        }
    }

    private async streamOnce() {
        const call = this.grpc.subscriptionService.subscribeCheckpoints({
            readMask: { paths: ["sequence_number", "transactions"] },
        });
        console.log("listening for activations / settlements...");

        for await (const res of call.responses) {
            const cp = res.checkpoint;
            if (!cp) continue;
            for (const tx of cp.transactions ?? []) {
                for (const ev of tx.events?.events ?? []) {
                    const et = ev.eventType ?? "";
                    const [pkgOf, modOf] = et.split("::");
                    if (!pkgOf || norm(pkgOf) !== norm(env.predictPackage) || modOf !== "oracle") continue;

                    const oid = eventOracleId(ev.contents?.value);
                    if (et.endsWith("::OracleActivated")) {
                        await this.onActivated(oid);
                    } else if (et.endsWith("::OracleSettled")) {
                        await this.onSettled(oid);
                    }
                }
            }
        }
    }

    // OracleActivated has no underlying, look it up
    private async onActivated(oracleId: string) {
        try {
            const { oracle } = await getJson(`/oracles/${oracleId}/state`);
            const m = toMarket(oracle);
            this.tracked.set(norm(oracleId), m);
            await this.writeMarket(m);
            const mins = Math.round((m.expiry - Date.now()) / 60000);
            console.log(`[NEW] ${m.underlying} ${oracleId} expires in ${mins} min`);
        } catch (e: any) {
            console.error("activated lookup failed:", e?.message ?? e);
        }
    }

    private async onSettled(oracleId: string) {
        const m = this.tracked.get(norm(oracleId));
        if (!m) return;
        this.tracked.delete(norm(oracleId));
        await this.removeMarket(m);
        console.log(`[SETTLED] ${m.underlying} ${oracleId} ended`);
    }

    private async writeMarket(m: Market) {
        await this.redis.hset(MARKETS_KEY, m.oracleId, JSON.stringify(m));
        await this.redis.publish(EVENTS_CHANNEL, JSON.stringify({ type: "market:new", data: m }));
    }

    private async removeMarket(m: Market) {
        await this.redis.hdel(MARKETS_KEY, m.oracleId);
        await this.redis.publish(EVENTS_CHANNEL, JSON.stringify({ type: "market:settled", data: m }));
    }
}
