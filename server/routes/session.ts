import type { Request, Response, NextFunction } from "express";
import { verifySession } from "../lib/auth";

// guard a route with a Bearer session, sets req.userId
export async function requireSession(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const uid = token ? await verifySession(token) : null;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    (req as any).userId = uid;
    next();
}
