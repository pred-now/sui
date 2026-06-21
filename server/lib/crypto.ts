import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export interface Encrypted {
    iv: string;
    tag: string;
    data: string;
}

let keyProvider = (): Buffer => {
    const raw = process.env.WALLET_MASTER_KEY;
    if (!raw) throw new Error("WALLET_MASTER_KEY not set");
    const key = Buffer.from(raw, raw.length === 64 ? "hex" : "base64");
    if (key.length !== 32) throw new Error("WALLET_MASTER_KEY must be 32 bytes");
    return key;
};

// override the KEK source (e.g. a KMS-backed provider)
export function setKeyProvider(provider: () => Buffer): void {
    keyProvider = provider;
}

function masterKey(): Buffer {
    return keyProvider();
}

// AES-256-GCM encrypt
export function encrypt(plaintext: string): Encrypted {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
    };
}

// AES-256-GCM decrypt
export function decrypt(enc: Encrypted): string {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(enc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    const out = Buffer.concat([decipher.update(Buffer.from(enc.data, "base64")), decipher.final()]);
    return out.toString("utf8");
}
