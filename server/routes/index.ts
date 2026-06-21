import { Router } from "express";
import type Redis from "ioredis";
import { groupedSnapshot } from "../lib/market";
import type { Range } from "../lib/surface";
import type { MarketDetailsService } from "../services/market-details";
import type { CandlesService } from "../services/candles";
import type { SurfaceService } from "../services/surface";

export function createRoutes(
    redis: Redis,
    details: MarketDetailsService,
    candles: CandlesService,
    surface: SurfaceService,
): Router {
    const router = Router();

    router.get("/health", (_req, res) => {
        res.json({ ok: true });
    });

    // current markets grouped by underlying
    router.get("/markets", async (_req, res) => {
        const snapshot = await groupedSnapshot(redis);
        res.json(snapshot);
    });

    // full details for one market
    router.get("/markets/:oracleId", async (req, res) => {
        const d = await details.get(req.params.oracleId);
        if (!d) return res.status(404).json({ error: "not found" });
        res.json(d);
    });

    // OHLC candles for one market
    router.get("/markets/:oracleId/candles", async (req, res) => {
        const q = req.query.type;
        const type = q === "contract" ? "contract" : q === "prob" ? "prob" : "spot";
        const side = req.query.side === "NO" ? "NO" : "YES";
        const interval = String(req.query.interval ?? "1m");
        try {
            const data = await candles.getCandles(req.params.oracleId, type, side, interval);
            res.json(data);
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "bad request" });
        }
    });

    // raw per-write series for one market
    router.get("/markets/:oracleId/series", async (req, res) => {
        const q = req.query.type;
        const type = q === "contract" ? "contract" : q === "prob" ? "prob" : "spot";
        const side = req.query.side === "NO" ? "NO" : "YES";
        const data = await candles.getSeries(req.params.oracleId, type, side);
        res.json(data);
    });

    // merged forward + svi surface, for client-side odds repricing
    router.get("/markets/:oracleId/surface", async (req, res) => {
        const r = String(req.query.range ?? "1d");
        const range = (["1h", "6h", "1d", "all"].includes(r) ? r : "1d") as Range;
        const points = Math.min(5000, Math.max(100, Number(req.query.points) || 2000));
        try {
            const data = await surface.getSurface(req.params.oracleId, range, points);
            res.json(data);
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "bad request" });
        }
    });

    return router;
}
