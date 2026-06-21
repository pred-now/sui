import { Router } from "express";
import type Redis from "ioredis";
import { listUserIds, getUser } from "../services/user";
import { getLedger } from "../lib/ledger";
import { getTotals } from "../lib/txlog";
import { mapLimit } from "../lib/predict";

const CACHE_KEY = "leaderboard:top";
const CACHE_TTL_S = 10;
const MIN_DEPOSITED = 1_000_000; // $1 floor, keeps roi honest
const TOP_N = 20;
const CONCURRENCY = 4;

interface Row {
    wallet: string;
    earnings: number; // usd
    roi: number; // percent
}

// shorten a sui address, full address never leaves the server
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// public leaderboard: top wallets by roi, earnings shown alongside
export function createLeaderboardRoutes(redis: Redis): Router {
    const router = Router();

    router.get("/leaderboard", async (_req, res) => {
        try {
            const cached = await redis.get(CACHE_KEY);
            if (cached) return res.json(JSON.parse(cached) as Row[]);

            const ids = await listUserIds(redis);
            const rows = await mapLimit(ids, CONCURRENCY, id => entryFor(redis, id));

            const top = rows
                .filter((r): r is Row => r !== null)
                .sort((a, b) => b.roi - a.roi)
                .slice(0, TOP_N);

            await redis.set(CACHE_KEY, JSON.stringify(top), "EX", CACHE_TTL_S);
            res.json(top);
        } catch (e: any) {
            res.status(500).json({ error: e?.message ?? "leaderboard failed" });
        }
    });

    return router;
}

// one wallet's earnings and roi, null if it never funded
async function entryFor(redis: Redis, userId: string): Promise<Row | null> {
    const user = await getUser(redis, userId);
    if (!user) return null;

    const { deposited, withdrawn } = await getTotals(redis, userId);
    if (deposited < MIN_DEPOSITED) return null;

    const l = await getLedger(redis, userId);
    // net realized pnl, withdrawals added back
    const earnings = l.balance + withdrawn - deposited;
    const roi = earnings / deposited;

    return {
        wallet: shortAddr(user.address),
        earnings: Math.round((earnings / 1e6) * 100) / 100,
        roi: Math.round(roi * 1000) / 10,
    };
}
