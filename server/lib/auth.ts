import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { env } from "./env";

const SESSION_TTL = "7d";

export type OidcProvider = "google" | "twitch";

function sessionKey(): Uint8Array {
    if (!env.sessionSecret) throw new Error("SESSION_SECRET not set");
    return new TextEncoder().encode(env.sessionSecret);
}

// sign a session token for a user
export async function issueSession(userId: string): Promise<string> {
    return new SignJWT({ uid: userId })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(SESSION_TTL)
        .sign(sessionKey());
}

// verify a session token, return the user id
export async function verifySession(token: string): Promise<string | null> {
    try {
        const { payload } = await jwtVerify(token, sessionKey());
        return (payload.uid as string) ?? null;
    } catch {
        return null;
    }
}

// OIDC config per provider
const PROVIDERS: Record<
    OidcProvider,
    { issuer: string[]; jwks: string; audience: () => string | undefined }
> = {
    google: {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        jwks: "https://www.googleapis.com/oauth2/v3/certs",
        audience: () => env.googleClientId,
    },
    twitch: {
        issuer: ["https://id.twitch.tv/oauth2"],
        jwks: "https://id.twitch.tv/oauth2/keys",
        audience: () => env.twitchClientId,
    },
};

const jwksCache = new Map<OidcProvider, ReturnType<typeof createRemoteJWKSet>>();
function jwksFor(p: OidcProvider) {
    let set = jwksCache.get(p);
    if (!set) {
        set = createRemoteJWKSet(new URL(PROVIDERS[p].jwks));
        jwksCache.set(p, set);
    }
    return set;
}

// verify an OIDC id_token, return its subject
export async function verifyProviderJwt(jwt: string, provider: OidcProvider): Promise<string> {
    const cfg = PROVIDERS[provider];
    const audience = cfg.audience();
    if (!audience) throw new Error(`${provider} client id not set`);
    const { payload } = await jwtVerify(jwt, jwksFor(provider), {
        issuer: cfg.issuer,
        audience,
    });
    if (!payload.sub) throw new Error("jwt missing sub");
    return payload.sub;
}
