import { describe, it, expect } from "@jest/globals";
import { encrypt, decrypt } from "../lib/crypto";
import { getOrCreateUser } from "../services/user";
import { fakeRedis } from "./fake-redis";

describe("crypto", () => {
    it("round-trips a secret", () => {
        const enc = encrypt("suiprivkey1example");
        expect(enc.data).not.toContain("suiprivkey");
        expect(decrypt(enc)).toBe("suiprivkey1example");
    });

    it("rejects a tampered tag", () => {
        const enc = encrypt("secret");
        const tag = Buffer.from(enc.tag, "base64");
        tag[0] ^= 0xff;
        expect(() => decrypt({ ...enc, tag: tag.toString("base64") })).toThrow();
    });
});

describe("proxy wallet", () => {
    it("mints once and returns a stable sui address", async () => {
        const redis = fakeRedis();
        const a = await getOrCreateUser(redis, "google:123", "google");
        const b = await getOrCreateUser(redis, "google:123", "google");
        expect(a.address).toBe(b.address);
        expect(a.address).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("never exposes the secret on the public user shape", async () => {
        const redis = fakeRedis();
        const u = await getOrCreateUser(redis, "google:123", "google");
        expect(JSON.stringify(u)).not.toContain("suiprivkey");
        expect((u as any).enc).toBeUndefined();
    });
});
