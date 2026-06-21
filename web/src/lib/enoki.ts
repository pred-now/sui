import { EnokiFlow } from "@mysten/enoki";

export const enokiOn = !!process.env.NEXT_PUBLIC_ENOKI_API_KEY;
export const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
export const twitchClientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID ?? "";

let flow: EnokiFlow | null = null;

// lazy, browser only, no provider needed
export function getEnokiFlow(): EnokiFlow | null {
    if (!enokiOn || typeof window === "undefined") return null;
    return (flow ??= new EnokiFlow({ apiKey: process.env.NEXT_PUBLIC_ENOKI_API_KEY! }));
}
