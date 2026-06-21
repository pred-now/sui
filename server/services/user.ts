import type Redis from "ioredis";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { encrypt, type Encrypted } from "../lib/crypto";

export interface User {
    userId: string;
    provider: string;
    address: string;
    createdAt: number;
    managerId?: string; // PredictManager, created on first deposit
}

// stored form keeps the encrypted secret. never leaves the server.
export interface StoredUser extends User {
    enc: Encrypted;
}

const userKey = (userId: string) => `user:${userId}`;

// load or mint a custodial proxy wallet for an identity
export async function getOrCreateUser(
    redis: Redis,
    userId: string,
    provider: string,
): Promise<User> {
    const existing = await getStoredUser(redis, userId);
    if (existing) return strip(existing);

    const kp = Ed25519Keypair.generate();
    const stored: StoredUser = {
        userId,
        provider,
        address: kp.getPublicKey().toSuiAddress(),
        createdAt: Date.now(),
        enc: encrypt(kp.getSecretKey()),
    };
    await redis.set(userKey(userId), JSON.stringify(stored));
    return strip(stored);
}

// every minted user id, scanned from the user records (source of truth)
export async function listUserIds(redis: Redis): Promise<string[]> {
    const ids: string[] = [];
    let cursor = "0";
    do {
        const [next, keys] = await redis.scan(cursor, "MATCH", "user:*", "COUNT", 200);
        for (const k of keys) ids.push(k.slice("user:".length));
        cursor = next;
    } while (cursor !== "0");
    return ids;
}

// read a user without minting
export async function getUser(redis: Redis, userId: string): Promise<User | null> {
    const stored = await getStoredUser(redis, userId);
    return stored ? strip(stored) : null;
}

// full record incl. encrypted secret. ONLY the custody service may use this.
export async function getStoredUser(redis: Redis, userId: string): Promise<StoredUser | null> {
    const raw = await redis.get(userKey(userId));
    return raw ? (JSON.parse(raw) as StoredUser) : null;
}

// persist the user's PredictManager id once created
export async function setManagerId(redis: Redis, userId: string, managerId: string): Promise<void> {
    const stored = await getStoredUser(redis, userId);
    if (!stored) return;
    stored.managerId = managerId;
    await redis.set(userKey(userId), JSON.stringify(stored));
}

function strip(u: StoredUser): User {
    return {
        userId: u.userId,
        provider: u.provider,
        address: u.address,
        createdAt: u.createdAt,
        managerId: u.managerId,
    };
}
