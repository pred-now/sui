import { EnokiClient } from "@mysten/enoki";
import { env } from "./env";

let client: EnokiClient | null = null;

// server enoki client, sponsors proxy gas
export function enokiClient(): EnokiClient {
    if (!env.enokiApiKey) throw new Error("ENOKI_API_KEY not set");
    return (client ??= new EnokiClient({ apiKey: env.enokiApiKey }));
}
