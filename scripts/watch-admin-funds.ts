import { config } from "dotenv";
import { fileURLToPath } from "url";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";

// read the admin key and contract ids from the server env
config({ path: fileURLToPath(new URL("../server/.env", import.meta.url)) });

// on-chain coin types (testnet), mirror server/lib/config.ts
const DUSDC =
    "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
const USDC =
    "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

const ZERO = "0x" + "0".repeat(64);
const POLL_MS = 10_000;

const PKG = process.env.PREDICT_PACKAGE!;
const MANAGER_ID = process.env.PLATFORM_MANAGER_ID ?? "";

const client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl("testnet"),
    network: "testnet",
});
const kp = Ed25519Keypair.fromSecretKey(process.env.ADMIN_SECRET_KEY!);
const ADMIN = kp.getPublicKey().toSuiAddress();

// decimals + symbol for the coins we care about
function coinInfo(type: string): { sym: string; dec: number } {
    if (type === SUI_TYPE_ARG || type.endsWith("::sui::SUI")) return { sym: "SUI", dec: 9 };
    if (type === DUSDC) return { sym: "DUSDC", dec: 6 };
    if (type === USDC) return { sym: "USDC", dec: 6 };
    return { sym: type.split("::").pop() ?? type, dec: 0 };
}

// base units -> human string, trailing zeros stripped
function fmt(base: bigint, dec: number): string {
    const neg = base < 0n;
    const b = neg ? -base : base;
    const d = 10n ** BigInt(dec);
    let out = (b / d).toString();
    if (dec > 0) {
        const frac = (b % d).toString().padStart(dec, "0").replace(/0+$/, "");
        if (frac) out += "." + frac;
    }
    return (neg ? "-" : "") + out;
}

function delta(a: bigint, b: bigint, dec: number): string {
    const diff = b - a;
    return (diff >= 0n ? "+" : "") + fmt(diff, dec);
}

interface Snapshot {
    wallet: Map<string, bigint>; // coinType -> base units in the admin wallet
    reserve: bigint; // dusdc base units inside the platform manager
}

// all coin balances held by the admin address
async function walletBalances(): Promise<Map<string, bigint>> {
    const all = await client.getAllBalances({ owner: ADMIN });
    return new Map(all.map((b) => [b.coinType, BigInt(b.totalBalance)]));
}

// dusdc balance locked in the deepbook predict manager, read-only
async function reserveBalance(): Promise<bigint> {
    if (!MANAGER_ID) return 0n;
    const tx = new Transaction();
    tx.moveCall({
        target: `${PKG}::predict_manager::balance`,
        typeArguments: [DUSDC],
        arguments: [tx.object(MANAGER_ID)],
    });
    const res = await client.devInspectTransactionBlock({ sender: ZERO, transactionBlock: tx });
    const rv = res.results?.[res.results.length - 1]?.returnValues;
    if (!rv?.length) return 0n;
    return BigInt(bcs.u64().parse(Uint8Array.from(rv[0][0])));
}

async function snapshot(): Promise<Snapshot> {
    const [wallet, reserve] = await Promise.all([walletBalances(), reserveBalance()]);
    return { wallet, reserve };
}

function ts(): string {
    return new Date().toLocaleTimeString();
}

function logInitial(s: Snapshot) {
    console.log(`[${ts()}] admin ${ADMIN}`);
    console.log(`[${ts()}] manager ${MANAGER_ID || "(none)"}`);
    for (const [type, base] of s.wallet) {
        const { sym, dec } = coinInfo(type);
        console.log(`  wallet ${sym}: ${fmt(base, dec)}`);
    }
    console.log(`  contract DUSDC: ${fmt(s.reserve, 6)}`);
    console.log(`[${ts()}] watching, polling every ${POLL_MS / 1000}s`);
}

function logChanges(prev: Snapshot, cur: Snapshot) {
    const types = new Set([...prev.wallet.keys(), ...cur.wallet.keys()]);
    for (const type of types) {
        const a = prev.wallet.get(type) ?? 0n;
        const b = cur.wallet.get(type) ?? 0n;
        if (a === b) continue;
        const { sym, dec } = coinInfo(type);
        console.log(`[${ts()}] wallet ${sym}: ${fmt(a, dec)} -> ${fmt(b, dec)} (${delta(a, b, dec)})`);
    }
    if (prev.reserve !== cur.reserve) {
        console.log(
            `[${ts()}] contract DUSDC: ${fmt(prev.reserve, 6)} -> ${fmt(cur.reserve, 6)} (${delta(prev.reserve, cur.reserve, 6)})`,
        );
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    let prev = await snapshot();
    logInitial(prev);
    for (;;) {
        await sleep(POLL_MS);
        try {
            const cur = await snapshot();
            logChanges(prev, cur);
            prev = cur;
        } catch (e) {
            console.error(`[${ts()}] poll error:`, e instanceof Error ? e.message : e);
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
