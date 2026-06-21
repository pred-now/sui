import { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { bcs } from "@mysten/sui/bcs";
import { env } from "./env";
import { CLOCK, DUSDC_UNIT } from "./sui";
import { PRICE_SCALE } from "./market";
import type { Side } from "./quote";

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

// market_key::up = YES, down = NO. strike in usd, expiry in ms.
export function marketKey(tx: Transaction, oracleId: string, expiryMs: number, strikeUsd: number, side: Side) {
    return tx.moveCall({
        target: `${env.predictPackage}::market_key::${side === "yes" ? "up" : "down"}`,
        arguments: [
            tx.pure.id(oracleId),
            tx.pure.u64(BigInt(expiryMs)),
            tx.pure.u64(BigInt(Math.round(strikeUsd * PRICE_SCALE))),
        ],
    });
}

export interface TradeAmounts {
    mintCost: number; // usd base units to buy `contracts`
    redeemPayout: number; // usd base units to sell `contracts` back
}

// read-only vault quote for `contracts` contracts of `side`.
export async function tradeAmounts(
    client: SuiJsonRpcClient,
    oracleId: string,
    expiryMs: number,
    strikeUsd: number,
    side: Side,
    contracts: number,
): Promise<TradeAmounts> {
    const tx = new Transaction();
    tx.moveCall({
        target: `${env.predictPackage}::predict::get_trade_amounts`,
        arguments: [
            tx.object(env.predictId),
            tx.object(oracleId),
            marketKey(tx, oracleId, expiryMs, strikeUsd, side),
            tx.pure.u64(BigInt(Math.max(1, Math.round(contracts * DUSDC_UNIT)))),
            tx.object(CLOCK),
        ],
    });
    const res = await client.devInspectTransactionBlock({ sender: ZERO, transactionBlock: tx });
    const rv = res.results?.[res.results.length - 1]?.returnValues;
    if (!rv || rv.length < 2) throw new Error("get_trade_amounts failed");
    return {
        mintCost: Number(bcs.u64().parse(Uint8Array.from(rv[0][0]))),
        redeemPayout: Number(bcs.u64().parse(Uint8Array.from(rv[1][0]))),
    };
}

// live vault half-spread per contract, in usd (0..1). used as the hedgeFloor.
export async function vaultHalfSpread(
    client: SuiJsonRpcClient,
    oracleId: string,
    expiryMs: number,
    strikeUsd: number,
    side: Side,
    contracts: number,
): Promise<number> {
    const { mintCost, redeemPayout } = await tradeAmounts(client, oracleId, expiryMs, strikeUsd, side, contracts);
    const c = Math.max(1, contracts);
    return (mintCost - redeemPayout) / 2 / (c * DUSDC_UNIT);
}
