import { env } from "./env";

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// strip 0x and leading zeros for comparison
export const norm = (id: string) => id.toLowerCase().replace(/^0x0*/, "");

export const oidOf = (o: any) => o.oracle_id ?? o.id;

// REST get with 429 backoff
export async function getJson<T = any>(path: string, attempt = 0): Promise<T> {
    const res = await fetch(`${env.predictServerUrl}${path}`);
    if (res.status === 429 && attempt < 5) {
        await sleep(500 * 2 ** attempt);
        return getJson<T>(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json() as Promise<T>;
}

// every oracle event starts with oracle_id, first 32 bytes
export function eventOracleId(bytes?: Uint8Array): string {
    if (!bytes || bytes.length < 32) return "";
    return "0x" + Buffer.from(bytes.slice(0, 32)).toString("hex");
}

// concurrency-limited map for sparse oracle lists
export async function mapLimit<T, R>(items: T[], limit: number, job: (x: T) => Promise<R>) {
    const out: R[] = new Array(items.length);
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const k = i++;
            out[k] = await job(items[k]);
        }
    }
    await Promise.all(Array.from({ length: limit }, worker));
    return out;
}
