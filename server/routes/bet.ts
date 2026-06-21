import { Router } from "express";
import type Redis from "ioredis";
import { randomUUID } from "crypto";
import { DUSDC_UNIT } from "../lib/sui";
import { getDetails } from "../lib/market";
import { fairYes } from "../lib/pricing";
import { getLedger, available } from "../lib/ledger";
import { LEV, borrowRate, markFor, accrueInterest, liqYesFor, getDynamicK } from "../lib/leverage";
import { getLevBook, levUserKey, type LevPosition } from "../lib/levbook";
import { listHistory } from "../lib/history";
import { requireSession } from "./session";
import type { BetEngine } from "../services/engine";
import type { Side } from "../lib/quote";

// mark a stored position with the live surface: value, equity, unrealized pnl, liquidation level
async function markPosition(redis: Redis, p: LevPosition) {
    const d = await getDetails(redis, p.oracleId);
    const f = d?.price && d.svi ? fairYes(d.price.forward, p.strike, d.svi) : null;
    const mark = f == null ? p.entryAsk : markFor(p.side, f);
    const now = Date.now();
    const fees = p.fees + accrueInterest(p.borrowed, p.rate, now - p.accruedAt);
    const owed = p.borrowed + fees;
    const value = Math.round(p.contracts * mark * DUSDC_UNIT);
    const equity = value - owed;
    return {
        oracleId: p.oracleId, strike: p.strike, side: p.side,
        underlying: d?.underlying ?? "", expiry: p.expiry,
        leverage: p.margin > 0 ? (p.margin + p.borrowed) / p.margin : 1,
        contracts: p.contracts, margin: p.margin, borrowed: p.borrowed,
        entryAsk: p.entryAsk, rate: p.rate, fees, openedAt: p.openedAt,
        mark, value, equity, pnl: equity - p.margin,
        liqYes: liqYesFor(p.contracts, p.side, owed, DUSDC_UNIT),
    };
}

export function createBetRoutes(redis: Redis, engine: BetEngine | null): Router {
    const router = Router();

    // read-only quote for one (oracleId, strike): house odds plus leverage knobs
    router.get("/bet/quote", async (req, res) => {
        if (!engine) return res.status(503).json({ error: "betting offline" });
        const oracleId = String(req.query.oracleId ?? "");
        const strike = Number(req.query.strike);
        const side = (req.query.side === "no" ? "no" : "yes") as Side;
        if (!oracleId || !Number.isFinite(strike)) return res.status(400).json({ error: "bad params" });
        try {
            const q = await engine.getQuote(oracleId, strike, side);
            const lb = await getLevBook(redis, oracleId, strike);
            const dynamicK = await getDynamicK(redis);
            res.json({ ...q, maxLeverage: LEV.maxLeverage, borrowRate: borrowRate(side, lb.L, lb.S, dynamicK) });
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "quote failed" });
        }
    });

    // place a bet: amount (display USD) is the margin, leverage defaults to 1 (no borrow, no liq)
    router.post("/bet", requireSession, async (req, res) => {
        if (!engine) return res.status(503).json({ error: "betting offline" });
        const userId = (req as any).userId as string;
        const { oracleId, strike, side, amount, leverage, id } = req.body ?? {};
        if (!oracleId || !Number.isFinite(Number(strike)) || (side !== "yes" && side !== "no")) {
            return res.status(400).json({ error: "bad params" });
        }
        const margin = Math.round(Number(amount) * DUSDC_UNIT);
        const lev = Number(leverage) >= 1 ? Number(leverage) : 1;
        try {
            res.json(await engine.openLeverage(userId, oracleId, Number(strike), side, margin, lev, id ?? randomUUID()));
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "bet failed" });
        }
    });

    // close a bet at the current mark
    router.post("/bet/close", requireSession, async (req, res) => {
        if (!engine) return res.status(503).json({ error: "betting offline" });
        const userId = (req as any).userId as string;
        const { oracleId, strike, side, id } = req.body ?? {};
        if (!oracleId || !Number.isFinite(Number(strike)) || (side !== "yes" && side !== "no")) {
            return res.status(400).json({ error: "bad params" });
        }
        try {
            res.json(await engine.closeLeverage(userId, oracleId, Number(strike), side, id ?? randomUUID()));
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "close failed" });
        }
    });

    // the user's open positions (marked live) and current balance
    router.get("/positions", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        const keys = await redis.smembers(levUserKey(userId));
        const positions = [];
        for (const k of keys) {
            const raw = await redis.get(k);
            if (raw) positions.push(await markPosition(redis, JSON.parse(raw) as LevPosition));
        }
        const l = await getLedger(redis, userId);
        res.json({ positions, balance: l.balance, available: available(l) });
    });

    // the user's closed bets: user close, liquidation, cliff, or settlement
    router.get("/history", requireSession, async (req, res) => {
        res.json(await listHistory(redis, (req as any).userId as string));
    });

    return router;
}
