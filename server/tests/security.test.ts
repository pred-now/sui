import { describe, it, expect } from "@jest/globals";
import express from "express";
import type { AddressInfo } from "net";
import { fakeRedis } from "./fake-redis";
import { createAuthRoutes } from "../routes/auth";
import { getOrCreateUser, getStoredUser } from "../services/user";
import { issueSession } from "../lib/auth";

// mount the auth router on an ephemeral port for a couple of requests
async function withServer(redis: any, fn: (base: string) => Promise<void>) {
    const app = express();
    app.use(express.json());
    app.use(createAuthRoutes(redis));
    const server = app.listen(0);
    try {
        const { port } = server.address() as AddressInfo;
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        server.close();
    }
}

describe("security: no key can leak", () => {
    it("the export route is gone (404)", async () => {
        await withServer(fakeRedis(), async base => {
            const post = await fetch(`${base}/wallet/export`, { method: "POST" });
            expect(post.status).toBe(404);
        });
    });

    it("/auth/me never returns a key field", async () => {
        const redis = fakeRedis();
        const u = await getOrCreateUser(redis, "google:1", "google");
        const token = await issueSession(u.userId);
        await withServer(redis, async base => {
            const res = await fetch(`${base}/auth/me`, {
                headers: { authorization: `Bearer ${token}` },
            });
            const body = await res.text();
            expect(res.status).toBe(200);
            expect(body).not.toContain("suiprivkey");
            expect(body).not.toMatch(/secret|\benc\b/i);
            expect(JSON.parse(body).address).toBe(u.address);
        });
    });

    it("the stored blob is ciphertext, not the raw key", async () => {
        const redis = fakeRedis();
        const u = await getOrCreateUser(redis, "slush:0xabc", "slush");
        const stored = await getStoredUser(redis, u.userId);
        const raw = await redis.get(`user:${u.userId}`);
        expect(raw).not.toContain("suiprivkey");
        expect(stored!.enc.data).not.toContain("suiprivkey");
        expect(stored!.enc.iv).toBeTruthy();
        expect(stored!.enc.tag).toBeTruthy();
    });

    it("the proxy key never appears in logs", async () => {
        const logs: string[] = [];
        const sink = (...a: any[]) => logs.push(a.map(String).join(" "));
        const orig = { log: console.log, warn: console.warn, error: console.error };
        console.log = sink;
        console.warn = sink;
        console.error = sink;
        try {
            const redis = fakeRedis();
            await getOrCreateUser(redis, "google:2", "google");
        } finally {
            console.log = orig.log;
            console.warn = orig.warn;
            console.error = orig.error;
        }
        expect(logs.join("\n")).not.toContain("suiprivkey");
    });
});
