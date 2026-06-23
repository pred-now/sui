import type { Server } from "socket.io";
import type Redis from "ioredis";
import { EVENTS_CHANNEL, groupedSnapshot } from "../lib/market";
import { verifySession } from "../lib/auth";
import { marketRoom, userRoom } from "../lib/bus";
import { DUSDC_UNIT } from "../lib/sui";
import { LEV, borrowRate, getDynamicK } from "../lib/leverage";
import { getLevBook } from "../lib/levbook";
import type { MarketDetailsService } from "../services/market-details";
import type { BetEngine } from "../services/engine";

type Ack = (r: unknown) => void;
const SUBS = "quotes:subs";

// wire socket.io to the redis pub/sub fan-out and the bet engine
export function setupSockets(
    io: Server,
    redis: Redis,
    sub: Redis,
    details: MarketDetailsService,
    engine: BetEngine | null,
) {
    io.on("connection", async socket => {
        // optional auth via handshake token; authed sockets join their user room
        const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
        const userId = token ? await verifySession(token) : null;
        if (userId) {
            socket.data.userId = userId;
            socket.join(userRoom(userId));
        }

        socket.emit("markets:snapshot", await groupedSnapshot(redis));

        // round-trip latency probe: ack immediately so the client can time the socket
        socket.on("ping:check", (ack?: Ack) => ack?.(1));

        socket.on("market:details:get", async (oracleId: string, ack?: Ack) => {
            const d = await details.get(oracleId);
            if (ack) ack(d);
        });

        // one-shot quote: house odds plus the leverage knobs (max leverage, side borrow rate)
        socket.on("bet:quote", async (p: any, ack?: Ack) => {
            if (!ack) return;
            if (!engine) return ack({ error: "betting offline" });
            const side = p.side === "no" ? "no" : "yes";
            try {
                const q = await engine.getQuote(p.oracleId, Number(p.strike), side);
                const lb = await getLevBook(redis, p.oracleId, Number(p.strike));
                const dynamicK = await getDynamicK(redis);
                ack({ ...q, maxLeverage: LEV.maxLeverage, borrowRate: borrowRate(side, lb.L, lb.S, dynamicK) });
            } catch (e: any) {
                ack({ error: e?.message ?? "quote failed" });
            }
        });

        // live quote updates for a market/strike
        socket.on("bet:subscribe", async (p: any) => {
            const strike = Number(p.strike);
            if (!p.oracleId || !Number.isFinite(strike)) return;
            socket.join(marketRoom(p.oracleId, strike));
            await redis.sadd(SUBS, `${p.oracleId}:${strike}`);
            if (engine) {
                const q = await engine.getQuote(p.oracleId, strike, "yes").catch(() => null);
                if (q) socket.emit("quote:update", q);
            }
        });
        socket.on("bet:unsubscribe", (p: any) => {
            socket.leave(marketRoom(p.oracleId, Number(p.strike)));
        });

        // place a bet (auth required). amount is the margin, leverage defaults to 1 (no borrow, no liq)
        socket.on("bet:place", async (p: any, ack?: Ack) => {
            if (!engine) return ack?.({ error: "betting offline" });
            const uid = socket.data.userId as string | undefined;
            if (!uid) return ack?.({ error: "unauthorized" });
            try {
                const margin = Math.round(Number(p.amount) * DUSDC_UNIT);
                const lev = Number(p.leverage) >= 1 ? Number(p.leverage) : 1;
                ack?.(await engine.openLeverage(uid, p.oracleId, Number(p.strike), p.side === "no" ? "no" : "yes", margin, lev, p.id));
            } catch (e: any) {
                ack?.({ error: e?.message ?? "bet failed" });
            }
        });

        // close a bet at the current mark (auth required)
        socket.on("bet:close", async (p: any, ack?: Ack) => {
            if (!engine) return ack?.({ error: "betting offline" });
            const uid = socket.data.userId as string | undefined;
            if (!uid) return ack?.({ error: "unauthorized" });
            try {
                ack?.(await engine.closeLeverage(uid, p.oracleId, Number(p.strike), p.side === "no" ? "no" : "yes", p.id));
            } catch (e: any) {
                ack?.({ error: e?.message ?? "close failed" });
            }
        });
    });

    // fan out redis events; room-targeted events go to a room, else broadcast
    sub.subscribe(EVENTS_CHANNEL);
    sub.on("message", (_channel, raw) => {
        const { type, data, room } = JSON.parse(raw);
        if (room) io.to(room).emit(type, data);
        else io.emit(type, data);
        // refresh quotes for subscribed markets when their oracle moves
        if (type === "market:details" && engine && data?.oracleId) {
            pushQuotes(io, redis, engine, data.oracleId).catch(() => {});
        }
    });
}

// recompute and push quotes to every subscribed room of one oracle
async function pushQuotes(io: Server, redis: Redis, engine: BetEngine, oracleId: string) {
    const tags = await redis.smembers(SUBS);
    for (const tag of tags) {
        const i = tag.lastIndexOf(":");
        if (tag.slice(0, i) !== oracleId) continue;
        const strike = Number(tag.slice(i + 1));
        const q = await engine.getQuote(oracleId, strike, "yes").catch(() => null);
        if (q) io.to(marketRoom(oracleId, strike)).emit("quote:update", q);
    }
}
