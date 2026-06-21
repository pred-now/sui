import type Redis from "ioredis";
import { getDetails, type MarketDetails } from "../lib/market";
import { sleep } from "../lib/predict";
import { DUSDC_UNIT } from "../lib/sui";
import { getPosition, posKey, posIndex, payoutOf } from "../lib/positions";
import { getBook } from "../lib/book";
import { LEV_POSITIONS, type LevPosition } from "../lib/levbook";
import { settlePosition, getLedger, available } from "../lib/ledger";
import { creditFee, debitLoss } from "../lib/pool";
import { publish, userRoom, marketRoom } from "../lib/bus";
import type { Side } from "../lib/quote";
import type { TreasuryService } from "./treasury";
import type { BetEngine } from "./engine";
import type { MarketDetailsService } from "./market-details";

const OPEN_SET = "markets:open";
const POLL_MS = 15_000;

// settles resolved markets: pays user positions, closes leftover leverage, redeems platform hedges
export class SettlementService {
    constructor(
        private redis: Redis,
        private treasury: TreasuryService,
        private engine: BetEngine,
        private details?: MarketDetailsService,
    ) {}

    async start() {
        this.loop();
    }

    // one settlement pass over all open markets
    async tick() {
        const tags = await this.redis.smembers(OPEN_SET);
        for (const tag of tags) await this.trySettle(tag);
    }

    private async loop() {
        for (;;) {
            try {
                await this.tick();
            } catch (e: any) {
                console.error("settlement:", e?.message ?? e);
            }
            await sleep(POLL_MS);
        }
    }

    private async trySettle(tag: string) {
        const idx = tag.lastIndexOf(":");
        const oracleId = tag.slice(0, idx);
        const strike = Number(tag.slice(idx + 1));
        let d = await getDetails(this.redis, oracleId);
        // the active-only details loop stops refreshing a market once discovery drops it from
        // MARKETS_KEY, so the settlement price may never reach the cache. for a past-expiry market
        // that still looks unresolved, fetch fresh state directly rather than wait forever.
        const expired = !d || Date.now() > d.expiry;
        if (expired && (!d || d.settlementPrice == null) && this.details) {
            d = await this.details.refresh(oracleId);
        }
        if (!d || d.settlementPrice == null) return; // not resolved yet
        await this.settleMarket(tag, oracleId, strike, d);
    }

    private async settleMarket(tag: string, oracleId: string, strike: number, d: MarketDetails) {
        const yesWon = (d.settlementPrice as number) >= strike;
        const users = await this.redis.smembers(posIndex(oracleId, strike));

        // accumulate the house's book result for the pool: stakes kept minus payouts, plus hedge,
        // minus the lending P&L already routed at each close (interest gained, principal lost)
        let bettorNet = 0;
        let interestRouted = 0;
        let badDebtRouted = 0;

        for (const userId of users) {
            const once = await this.redis.set(`settled:${tag}:${userId}`, "1", "NX");
            if (!once) continue; // already paid
            const pos = await getPosition(this.redis, userId, oracleId, strike);
            const payout = payoutOf(pos, yesWon, DUSDC_UNIT);
            bettorNet += pos.cost - payout;
            await settlePosition(this.redis, userId, pos.cost, payout);
            await this.redis.del(posKey(userId, oracleId, strike));
            await this.redis.srem(`umkts:${userId}`, tag);
            const l = await getLedger(this.redis, userId);
            await publish(this.redis, "settlement", { oracleId, strike, yesWon, payout }, userRoom(userId));
            await publish(this.redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(userId));
        }

        // safety net: close any leftover leveraged positions at the outcome (the cliff should have already)
        const levKeys = await this.redis.smembers(LEV_POSITIONS);
        for (const key of levKeys) {
            const raw = await this.redis.get(key);
            if (!raw) continue;
            const lp = JSON.parse(raw) as LevPosition;
            if (lp.oracleId !== oracleId || lp.strike !== strike) continue;
            const res = await this.engine.forceUnwind(lp.userId, oracleId, strike, lp.side, "settle", yesWon ? 1 : 0);
            if (res) {
                bettorNet += res.margin - res.returned;
                interestRouted += res.interestPaid;
                badDebtRouted += res.badDebt;
            }
        }

        // redeem the platform's vault hedge for this market, once, and net its P&L
        const book = await getBook(this.redis, oracleId, strike);
        let hedgeNet = 0;
        if (book.hedgedToVault !== 0) {
            const hedgeSide: Side = book.hedgedToVault > 0 ? "yes" : "no";
            const hedgeQty = Math.abs(book.hedgedToVault);
            const hedgeWon = (hedgeSide === "yes") === yesWon; // the vault pays $1/contract for the winning side
            const hedgePayoff = hedgeWon ? Math.round(hedgeQty * DUSDC_UNIT) : 0;
            const hedgeCost = Number((await this.redis.get(`mkt:hedgecost:${oracleId}:${strike}`)) ?? 0);
            hedgeNet = hedgePayoff - hedgeCost;
            const fresh = await this.redis.set(`settled:hedge:${tag}`, "1", "NX");
            if (fresh) {
                try {
                    await this.treasury.redeem(oracleId, d.expiry, strike, hedgeSide, hedgeQty);
                } catch (e: any) {
                    await this.redis.del(`settled:hedge:${tag}`); // allow retry
                    console.error("[settlement] hedge redeem failed:", e?.message ?? e);
                }
            }
        }

        // the bookmaker spread, net of hedge and of lending already routed -> fee (split) or loss (full)
        const bookResult = Math.round(bettorNet + hedgeNet - (interestRouted - badDebtRouted));
        if (bookResult > 0) await creditFee(this.redis, bookResult, `book:${tag}`);
        else if (bookResult < 0) await debitLoss(this.redis, -bookResult, `book:${tag}`);

        await this.redis.srem(OPEN_SET, tag);
        await publish(this.redis, "market:settled", { oracleId, strike, yesWon }, marketRoom(oracleId, strike));
        console.log(`[settlement] ${oracleId}@${strike} -> ${yesWon ? "YES" : "NO"} (${users.length} users)`);
    }
}
