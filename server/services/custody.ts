import type Redis from "ioredis";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64, fromBase64 } from "@mysten/sui/utils";
import { env } from "../lib/env";
import { decrypt } from "../lib/crypto";
import { enokiClient } from "../lib/enoki";
import { getStoredUser } from "./user";

// move calls enoki is allowed to sponsor for proxies
function allowedTargets(): string[] {
    const p = env.predictPackage;
    return [
        `${p}::predict::create_manager`,
        `${p}::predict_manager::deposit`,
        `${p}::predict_manager::withdraw`,
    ];
}

// the ONLY place a proxy key is decrypted. build -> sponsor -> sign -> execute.
export class CustodyService {
    constructor(
        private redis: Redis,
        private client: SuiJsonRpcClient,
    ) {}

    async execute(
        userId: string,
        action: string,
        build: (tx: Transaction, proxy: string) => void,
        extraAddresses: string[] = [],
    ): Promise<string> {
        const stored = await getStoredUser(this.redis, userId);
        if (!stored) throw new Error("no proxy wallet");

        const tx = new Transaction();
        tx.setSender(stored.address);
        build(tx, stored.address);
        const kindBytes = await tx.build({ client: this.client, onlyTransactionKind: true });

        // enoki pays gas; the proxy never holds SUI
        const sponsored = await enokiClient().createSponsoredTransaction({
            network: "testnet",
            sender: stored.address,
            transactionKindBytes: toBase64(kindBytes),
            allowedMoveCallTargets: allowedTargets(),
            allowedAddresses: [stored.address, ...extraAddresses],
        });

        // decrypt in memory, sign, discard. the key is never returned or logged.
        const kp = Ed25519Keypair.fromSecretKey(decrypt(stored.enc));
        const { signature } = await kp.signTransaction(fromBase64(sponsored.bytes));

        const res = await enokiClient().executeSponsoredTransaction({
            digest: sponsored.digest,
            signature,
        });
        console.log(`[custody] ${action} ${userId} -> ${res.digest}`);
        return res.digest;
    }

    // non-sponsored: the proxy signs and pays its own gas, for plain transfers
    async executeSelf(
        userId: string,
        action: string,
        build: (tx: Transaction, proxy: string) => void,
    ): Promise<string> {
        const stored = await getStoredUser(this.redis, userId);
        if (!stored) throw new Error("no proxy wallet");

        const tx = new Transaction();
        tx.setSender(stored.address);
        build(tx, stored.address);

        // decrypt in memory, sign, discard. the key is never returned or logged.
        const kp = Ed25519Keypair.fromSecretKey(decrypt(stored.enc));
        const res = await this.client.signAndExecuteTransaction({ signer: kp, transaction: tx });
        console.log(`[custody] ${action} ${userId} -> ${res.digest}`);
        return res.digest;
    }
}
