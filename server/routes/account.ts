import { Router } from "express";
import type Redis from "ioredis";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { randomUUID } from "crypto";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { DUSDC_UNIT, SUI_UNIT } from "../lib/sui";
import { getLedger, available } from "../lib/ledger";
import { listTx } from "../lib/txlog";
import { getUser } from "../services/user";
import { withdrawUsdc, withdrawSui } from "../services/withdrawals";
import type { CustodyService } from "../services/custody";
import type { TreasuryService } from "../services/treasury";
import { requireSession } from "./session";

const addrKey = (userId: string) => `withdrawAddr:${userId}`;

export function createAccountRoutes(
    redis: Redis,
    custody: CustodyService,
    treasury: TreasuryService | null,
    client: SuiJsonRpcClient,
): Router {
    const router = Router();

    // account overview: proxy address, withdrawal address, usd balance
    router.get("/account", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        const user = await getUser(redis, userId);
        if (!user) return res.status(404).json({ error: "not found" });
        const l = await getLedger(redis, userId);
        res.json({
            address: user.address,
            withdrawAddress: (await redis.get(addrKey(userId))) ?? null,
            balance: l.balance,
            available: available(l),
        });
    });

    // deposit and withdrawal history, newest first
    router.get("/transactions", requireSession, async (req, res) => {
        res.json(await listTx(redis, (req as any).userId as string));
    });

    // register or change the external withdrawal address. change needs confirm.
    router.post("/account/withdraw-address", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        const { address, confirm } = req.body ?? {};
        if (!address || !isValidSuiAddress(address)) {
            return res.status(400).json({ error: "bad address" });
        }
        const existing = await redis.get(addrKey(userId));
        if (existing && existing !== address && !confirm) {
            return res.status(409).json({ error: "confirm required to change address" });
        }
        await redis.set(addrKey(userId), address);
        res.json({ withdrawAddress: address });
    });

    // withdraw USDC to the registered address, amount in display USDC
    router.post("/withdraw", requireSession, async (req, res) => {
        if (!treasury) return res.status(503).json({ error: "treasury offline" });
        const userId = (req as any).userId as string;
        const { amount, id } = req.body ?? {};
        const base = Math.round(Number(amount) * DUSDC_UNIT); // usdc is 1e6, 1:1 with usd
        try {
            res.json(await withdrawUsdc(redis, treasury, userId, base, id ?? randomUUID()));
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "withdraw failed" });
        }
    });

    // withdraw SUI from the proxy wallet to the registered address, amount in display SUI
    router.post("/withdraw/sui", requireSession, async (req, res) => {
        const userId = (req as any).userId as string;
        const { amount, id } = req.body ?? {};
        const base = Math.round(Number(amount) * SUI_UNIT);
        try {
            res.json(await withdrawSui(redis, custody, client, userId, base, id ?? randomUUID()));
        } catch (e: any) {
            res.status(400).json({ error: e?.message ?? "withdraw failed" });
        }
    });

    return router;
}
