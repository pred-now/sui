import { Router } from "express";
import type Redis from "ioredis";
import { randomBytes } from "crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { PrivyClient } from "@privy-io/server-auth";
import { env } from "../lib/env";
import { issueSession, verifyProviderJwt } from "../lib/auth";
import { requireSession } from "./session";
import { getOrCreateUser, getUser } from "../services/user";

const NONCE_TTL = 300;
const nonceKey = (n: string) => `nonce:${n}`;

let privy: PrivyClient | null = null;
function privyClient(): PrivyClient {
    if (!env.privyAppId || !env.privyAppSecret) throw new Error("privy not configured");
    return (privy ??= new PrivyClient(env.privyAppId, env.privyAppSecret));
}

export function createAuthRoutes(redis: Redis): Router {
    const router = Router();

    // issue a single-use nonce for the slush challenge
    router.post("/auth/challenge", async (_req, res) => {
        const nonce = randomBytes(16).toString("hex");
        await redis.set(nonceKey(nonce), "1", "EX", NONCE_TTL);
        res.json({ nonce });
    });

    // slush wallet: verify a signed nonce, mint proxy
    router.post("/auth/slush", async (req, res) => {
        try {
            const { address, signature, nonce } = req.body ?? {};
            if (!address || !signature || !nonce) return res.status(400).json({ error: "bad request" });
            const consumed = await redis.del(nonceKey(nonce));
            if (!consumed) return res.status(400).json({ error: "bad or expired nonce" });
            const message = new TextEncoder().encode(`Sign in to Pred: ${nonce}`);
            await verifyPersonalMessageSignature(message, signature, { address });
            const user = await getOrCreateUser(redis, `slush:${address}`, "slush");
            res.json({ token: await issueSession(user.userId), address: user.address, provider: "slush" });
        } catch (e: any) {
            res.status(401).json({ error: e?.message ?? "auth failed" });
        }
    });

    // google / twitch via enoki: verify the oidc jwt, mint proxy
    router.post("/auth/enoki", async (req, res) => {
        try {
            const { jwt, provider } = req.body ?? {};
            if (provider !== "google" && provider !== "twitch") return res.status(400).json({ error: "bad provider" });
            const sub = await verifyProviderJwt(jwt, provider);
            const user = await getOrCreateUser(redis, `${provider}:${sub}`, provider);
            res.json({ token: await issueSession(user.userId), address: user.address, provider });
        } catch (e: any) {
            res.status(401).json({ error: e?.message ?? "auth failed" });
        }
    });

    // email via privy: verify the access token, mint proxy
    router.post("/auth/privy", async (req, res) => {
        try {
            const { token } = req.body ?? {};
            const claims = await privyClient().verifyAuthToken(token);
            const user = await getOrCreateUser(redis, `email:${claims.userId}`, "email");
            res.json({ token: await issueSession(user.userId), address: user.address, provider: "email" });
        } catch (e: any) {
            res.status(401).json({ error: e?.message ?? "auth failed" });
        }
    });

    // current session user
    router.get("/auth/me", requireSession, async (req, res) => {
        const user = await getUser(redis, (req as any).userId);
        if (!user) return res.status(404).json({ error: "not found" });
        res.json({ userId: user.userId, provider: user.provider, address: user.address });
    });

    return router;
}
