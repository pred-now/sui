import { Router } from "express";
import type Redis from "ioredis";
import { DUSDC_UNIT } from "../lib/sui";
import { LEV } from "../lib/leverage";
import { getLevOI } from "../lib/levbook";
import {
    getPool, getShares, getClaim, sharePrice, assetsForShares, freeCapital,
    stake, requestUnstake, claim, POOL,
} from "../lib/pool";
import { getLedger, available } from "../lib/ledger";
import { publish, userRoom } from "../lib/bus";
import { requireSession } from "./session";

// LP risk-capital vault: stake idle balance for a share of fees, unstake on a cooldown
export function createPoolRoutes(redis: Redis, enabled: boolean): Router {
    const router = Router();

    // push the user's live balance after a stake/claim moved their cash
    const pushBalance = async (userId: string) => {
        const l = await getLedger(redis, userId);
        await publish(redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(userId));
    };

    // pool overview: NAV, capacity, protocol cut
    router.get("/pool", async (_req, res) => {
        const p = await getPool(redis);
        const oi = await getLevOI(redis);
        res.json({
            assets: p.assets, shares: p.shares, sharePrice: sharePrice(p),
            protocol: p.protocol, hot: p.hot, supplied: p.supplied,
            leveragedOI: oi, maxOI: p.assets / LEV.poolToOI, freeCapital: await freeCapital(redis),
            stakerShare: POOL.stakerShare, cooldownMs: POOL.unstakeCooldownMs, enabled,
        });
    });

    // a staker's shares, current value, and any pending claim
    router.get("/pool/position", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        const p = await getPool(redis);
        const shares = await getShares(redis, userId);
        res.json({ shares, value: assetsForShares(p, shares), sharePrice: sharePrice(p), claim: await getClaim(redis, userId) });
    });

    if (!enabled) return router; // staking needs the treasury (the pool is seeded from the reserve)

    // stake display USD of idle balance, minting shares
    router.post("/pool/stake", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        const amount = Math.round(Number(req.body?.amount) * DUSDC_UNIT);
        try {
            const r = await stake(redis, userId, amount);
            await pushBalance(userId);
            await publish(redis, "pool:update", await getPool(redis));
            res.json(r);
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "stake failed" });
        }
    });

    // request to unstake a number of shares (starts the cooldown)
    router.post("/pool/unstake", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        const shares = Math.floor(Number(req.body?.shares));
        try {
            res.json(await requestUnstake(redis, userId, shares));
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "unstake failed" });
        }
    });

    // claim a matured unstake (re-checks the capital rule, pays at most free + hot)
    router.post("/pool/claim", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        try {
            const r = await claim(redis, userId);
            await pushBalance(userId);
            await publish(redis, "pool:update", await getPool(redis));
            res.json(r);
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "claim failed" });
        }
    });

    return router;
}
