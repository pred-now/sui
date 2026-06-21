import type Redis from "ioredis";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { bcs } from "@mysten/sui/bcs";
import { env } from "../lib/env";
import { DUSDC } from "../lib/config";
import { CLOCK, DUSDC_UNIT } from "../lib/sui";
import { marketKey } from "../lib/vault";
import type { Side } from "../lib/quote";

const MANAGER_KEY = "platform:manager";
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

// platform wallet: signs from the admin key, holds the DUSDC reserve in one manager
export class TreasuryService {
    private kp: Ed25519Keypair;
    readonly address: string;
    private managerId: string | null;

    constructor(
        private redis: Redis,
        private client: SuiJsonRpcClient,
    ) {
        if (!env.adminSecretKey) throw new Error("ADMIN_SECRET_KEY not set");
        this.kp = Ed25519Keypair.fromSecretKey(env.adminSecretKey);
        this.address = this.kp.getPublicKey().toSuiAddress();
        this.managerId = env.platformManagerId ?? null;
    }

    // admin signs and pays its own gas
    async execute(action: string, build: (tx: Transaction) => void): Promise<string> {
        const tx = new Transaction();
        tx.setSender(this.address);
        build(tx);
        const res = await this.client.signAndExecuteTransaction({ signer: this.kp, transaction: tx });
        await this.client.waitForTransaction({ digest: res.digest });
        console.log(`[treasury] ${action} -> ${res.digest}`);
        return res.digest;
    }

    // the single manager id, created and funded on first boot
    async ensurePlatformManager(): Promise<string> {
        if (this.managerId) return this.managerId;
        const stored = await this.redis.get(MANAGER_KEY);
        if (stored) return (this.managerId = stored);

        // create the manager
        const tx = new Transaction();
        tx.setSender(this.address);
        tx.moveCall({ target: `${env.predictPackage}::predict::create_manager` });
        const res = await this.client.signAndExecuteTransaction({
            signer: this.kp,
            transaction: tx,
            options: { showObjectChanges: true },
        });
        await this.client.waitForTransaction({ digest: res.digest });
        const created = (res.objectChanges ?? []).find(
            (c: any) => c.type === "created" && String(c.objectType).includes("PredictManager"),
        ) as any;
        if (!created?.objectId) throw new Error("PredictManager not created");
        const id = created.objectId as string;

        // fund it with all of the admin's DUSDC
        const coins = await this.client.getCoins({ owner: this.address, coinType: DUSDC });
        const reserve = coins.data.reduce((s, c) => s + Number(c.balance), 0);
        if (reserve > 0) {
            await this.execute("fund_manager", tx2 => {
                tx2.moveCall({
                    target: `${env.predictPackage}::predict_manager::deposit`,
                    typeArguments: [DUSDC],
                    arguments: [tx2.object(id), coinWithBalance({ type: DUSDC, balance: BigInt(reserve) })],
                });
            });
        }

        await this.redis.set(MANAGER_KEY, id);
        this.managerId = id;
        console.log(`[treasury] manager ${id} funded ${reserve} dusdc. set PLATFORM_MANAGER_ID in .env`);
        return id;
    }

    // manager DUSDC balance, the reserve, read-only
    async reserveBalance(): Promise<number> {
        const id = this.managerId ?? (await this.redis.get(MANAGER_KEY));
        if (!id) return 0;
        const tx = new Transaction();
        tx.moveCall({
            target: `${env.predictPackage}::predict_manager::balance`,
            typeArguments: [DUSDC],
            arguments: [tx.object(id)],
        });
        const res = await this.client.devInspectTransactionBlock({ sender: ZERO, transactionBlock: tx });
        const rv = res.results?.[res.results.length - 1]?.returnValues;
        if (!rv?.length) return 0;
        return Number(bcs.u64().parse(Uint8Array.from(rv[0][0])));
    }

    // reserve guard for the bet endpoint
    async canCover(base: number): Promise<boolean> {
        return (await this.reserveBalance()) >= base;
    }

    // lay net exposure on the vault: mint `contracts` of `side` into the platform manager
    async mint(oracleId: string, expiryMs: number, strikeUsd: number, side: Side, contracts: number): Promise<string> {
        const id = await this.ensurePlatformManager();
        const qty = BigInt(Math.max(1, Math.round(contracts * DUSDC_UNIT)));
        return this.execute("mint", tx => {
            tx.moveCall({
                target: `${env.predictPackage}::predict::mint`,
                typeArguments: [DUSDC],
                arguments: [
                    tx.object(env.predictId),
                    tx.object(id),
                    tx.object(oracleId),
                    marketKey(tx, oracleId, expiryMs, strikeUsd, side),
                    tx.pure.u64(qty),
                    tx.object(CLOCK),
                ],
            });
        });
    }

    // unwind a vault hedge: redeem `contracts` of `side` back into the reserve
    async redeem(oracleId: string, expiryMs: number, strikeUsd: number, side: Side, contracts: number): Promise<string> {
        const id = await this.ensurePlatformManager();
        const qty = BigInt(Math.max(1, Math.round(contracts * DUSDC_UNIT)));
        return this.execute("redeem", tx => {
            tx.moveCall({
                target: `${env.predictPackage}::predict::redeem`,
                typeArguments: [DUSDC],
                arguments: [
                    tx.object(env.predictId),
                    tx.object(id),
                    tx.object(oracleId),
                    marketKey(tx, oracleId, expiryMs, strikeUsd, side),
                    tx.pure.u64(qty),
                    tx.object(CLOCK),
                ],
            });
        });
    }

    // send a coin from the admin float to a user, for withdrawal top-ups
    async payout(to: string, coinType: string, base: number): Promise<string> {
        return this.execute("payout", tx => {
            if (coinType === SUI_TYPE_ARG) {
                const [coin] = tx.splitCoins(tx.gas, [BigInt(base)]);
                tx.transferObjects([coin], to);
            } else {
                tx.transferObjects([coinWithBalance({ type: coinType, balance: BigInt(base) })], to);
            }
        });
    }
}
