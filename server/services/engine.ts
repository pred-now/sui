import type Redis from "ioredis";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { randomUUID } from "crypto";
import { getDetails, type MarketDetails } from "../lib/market";
import { fairYes } from "../lib/pricing";
import { quote, askFor, type Quote, type Side } from "../lib/quote";
import { vaultHalfSpread, tradeAmounts } from "../lib/vault";
import { ECON } from "../lib/econ";
import { DUSDC_UNIT } from "../lib/sui";
import { getBook, setBook, netExposure, decayedVelocity, type Book } from "../lib/book";
import { getPosition, addFill, posKey, posIndex } from "../lib/positions";
import { getLedger, lockStake, settlePosition, available } from "../lib/ledger";
import { LEV, borrowRate, imbalanceFraction, maxOI, breachesCeiling, accrueInterest, markFor, getDynamicK } from "../lib/leverage";
import {
    getLevBook, setLevBook, reserveCohortOI, releaseCohortOI, cohortOf,
    getLevPosition, setLevPosition, delLevPosition, type LevPosition,
} from "../lib/levbook";
import { publish, userRoom, marketRoom } from "../lib/bus";
import { recordClose, type HistRecord } from "../lib/history";
import { getPool, creditFee, debitLoss } from "../lib/pool";
import type { TreasuryService } from "./treasury";

const hedgeCostKey = (o: string, s: number) => `mkt:hedgecost:${o}:${s}`;

const lockBook = (o: string, s: number) => `lock:book:${o}:${s}`;
const lockUser = (u: string) => `lock:user:${u}`;
const betKey = (id: string) => `bet:${id}`;

export interface QuoteResult {
    oracleId: string;
    strike: number;
    f: number;
    h: number;
    k: number;
    yesAsk: number;
    noAsk: number;
    expiry: number;
    band: number; // contracts the house carries before hedging
    hardCap: number; // contracts at which exposing bets are refused
    net: number; // current net exposure, yes-positive
    paused?: boolean;
}

export interface Fill {
    id: string;
    oracleId: string;
    strike: number;
    side: Side;
    stakeUsd: number;
    contracts: number;
    ask: number;
    ts: number;
}

export interface LevOpen {
    id: string;
    oracleId: string;
    strike: number;
    side: Side;
    margin: number;
    borrowed: number;
    notional: number;
    contracts: number;
    ask: number;
    rate: number;
    ts: number;
}

export interface LevClose {
    oracleId: string;
    strike: number;
    side: Side;
    reason: string;
    mark: number;
    value: number;
    returned: number;
    margin: number;
    badDebt: number; // real unrecovered principal
    interestPaid: number; // real interest collected by the pool
    ts: number;
}

// (expiry - now) / (expiry - activatedAt), clamped to [0,1]
function timeFraction(d: MarketDetails, now: number): number {
    const span = d.expiry - d.activatedAt;
    if (!(span > 0)) return 1;
    return Math.min(1, Math.max(0, (d.expiry - now) / span));
}

// the house engine: prices, matches/nets internally, hedges the residual on the vault
export class BetEngine {
    private chains = new Map<string, Promise<unknown>>();
    private reserve = { value: 0, ts: 0 };

    constructor(
        private redis: Redis,
        private client: SuiJsonRpcClient,
        private treasury: TreasuryService,
    ) {}

    // serialize work per market in this process (single writer)
    private serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = (this.chains.get(key) ?? Promise.resolve()).catch(() => {});
        const next = prev.then(fn);
        this.chains.set(key, next.catch(() => {}));
        return next;
    }

    // the capital number for the 0.14 rule + the band: the LP pool, falling back to the raw reserve
    // until genesis seeds it. one number shared with the pool so capacity and stake stay consistent.
    private async reserveDollars(): Promise<number> {
        if (Date.now() - this.reserve.ts < 5_000) return this.reserve.value;
        const pool = await getPool(this.redis).catch(() => null);
        const base = pool && pool.assets > 0
            ? pool.assets
            : await this.treasury.reserveBalance().catch(() => this.reserve.value * DUSDC_UNIT);
        this.reserve = { value: base / DUSDC_UNIT, ts: Date.now() };
        return this.reserve.value;
    }

    // full quote context for a market, throws if not tradeable
    private async context(oracleId: string, strike: number, side: Side, probeContracts: number) {
        const d = await getDetails(this.redis, oracleId);
        if (!d) throw new Error("unknown market");
        if (d.status !== "active") throw new Error("market not active");
        if (!d.price || !d.svi) throw new Error("no oracle data");
        if (Date.now() - d.price.timestampMs > ECON.stalenessMs) throw new Error("market paused");

        const f = fairYes(d.price.forward, strike, d.svi);
        if (f == null || f <= 0 || f >= 1) throw new Error("unpriceable strike");

        const T = timeFraction(d, Date.now());
        const reserve = await this.reserveDollars();
        const band = ECON.riskFraction * reserve * T;
        const hardCap = ECON.hardCapMult * band;
        const hedgeFloor = await vaultHalfSpread(this.client, oracleId, d.expiry, strike, side, probeContracts).catch(
            () => ECON.hedgeFloor,
        );
        const book = await getBook(this.redis, oracleId, strike);
        const q = quote(f, T, Math.max(0, d.svi.sigma), decayedVelocity(book), hedgeFloor, netExposure(book), band);
        return { d, q, book, band, hardCap };
    }

    // read-only quote for a side; contracts is a probe size for the vault spread
    async getQuote(oracleId: string, strike: number, side: Side = "yes", contracts = 1): Promise<QuoteResult> {
        try {
            const { d, q, book, band, hardCap } = await this.context(oracleId, strike, side, contracts);
            return {
                oracleId, strike, f: q.f, h: q.h, k: q.k, yesAsk: q.yesAsk, noAsk: q.noAsk,
                expiry: d.expiry, band, hardCap, net: netExposure(book),
            };
        } catch (e: any) {
            if (e?.message === "market paused") {
                return { oracleId, strike, f: 0, h: 0, k: 0, yesAsk: 0, noAsk: 0, expiry: 0, band: 0, hardCap: 0, net: 0, paused: true };
            }
            throw e;
        }
    }

    // place a bet of stakeUsd (base units) on a side. idempotent on id.
    placeBet(userId: string, oracleId: string, strike: number, side: Side, stakeUsd: number, id: string = randomUUID()): Promise<Fill> {
        return this.serialized(`${oracleId}:${strike}`, () => this.doPlace(userId, oracleId, strike, side, stakeUsd, id));
    }

    private async doPlace(userId: string, oracleId: string, strike: number, side: Side, stakeUsd: number, id: string): Promise<Fill> {
        if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) throw new Error("bad amount");

        const prior = await this.redis.get(betKey(id));
        if (prior) return JSON.parse(prior) as Fill;

        const gotUser = await this.redis.set(lockUser(userId), "1", "EX", 15, "NX");
        if (!gotUser) throw new Error("account busy");
        await this.redis.set(lockBook(oracleId, strike), "1", "EX", 15, "NX");
        try {
            const probe = Math.max(1, stakeUsd / DUSDC_UNIT);
            const { d, q, book, band, hardCap } = await this.context(oracleId, strike, side, probe);
            const ask = askFor(q, side);
            if (ask <= 0) throw new Error("unpriceable");

            const contracts = stakeUsd / (ask * DUSDC_UNIT);
            const imbBefore = book.internalYes - book.internalNo;
            const imbAfter = imbBefore + (side === "yes" ? contracts : -contracts);
            const exposing = Math.abs(imbAfter) > Math.abs(imbBefore);
            if (exposing && Math.abs(imbAfter) > hardCap) throw new Error("market at capacity");

            // commit: lock stake, record position, update book, store fill
            await lockStake(this.redis, userId, stakeUsd); // throws if insufficient
            const pos = addFill(await getPosition(this.redis, userId, oracleId, strike), side, contracts, stakeUsd);
            await this.redis.set(posKey(userId, oracleId, strike), JSON.stringify(pos));
            await this.redis.sadd(posIndex(oracleId, strike), userId);
            await this.redis.sadd("markets:open", `${oracleId}:${strike}`);
            await this.redis.sadd(`umkts:${userId}`, `${oracleId}:${strike}`);

            await this.applyExposure(oracleId, strike, d.expiry, side, contracts, book, band);

            const fill: Fill = { id, oracleId, strike, side, stakeUsd, contracts, ask, ts: Date.now() };
            await this.redis.set(betKey(id), JSON.stringify(fill));
            await this.emitFill(userId, oracleId, strike, fill, book);
            return fill;
        } finally {
            await this.redis.del(lockBook(oracleId, strike));
            await this.redis.del(lockUser(userId));
        }
    }

    // add (or remove, if negative) directional exposure and re-hedge the residual
    private async applyExposure(oracleId: string, strike: number, expiry: number, side: Side, contracts: number, book: Book, band: number) {
        if (side === "yes") book.internalYes += contracts;
        else book.internalNo += contracts;
        book.velocity = decayedVelocity(book) + (side === "yes" ? contracts : -contracts);
        book.velTs = Date.now();
        book.updatedAt = Date.now();
        await setBook(this.redis, oracleId, strike, book);
        await this.hedge(oracleId, strike, expiry, book, band);
    }

    // lay the net residual off on the vault, pulling it back to the band
    private async hedge(oracleId: string, strike: number, expiry: number, book: Book, band: number) {
        try {
            const residual = netExposure(book);
            if (Math.abs(residual) <= band) return;
            const side: Side = residual > 0 ? "yes" : "no";
            const qty = Math.abs(residual) - band;
            // record what the vault charges so settlement can net the hedge P&L into the pool
            const cost = await tradeAmounts(this.client, oracleId, expiry, strike, side, qty)
                .then(a => a.mintCost)
                .catch(() => 0);
            await this.treasury.mint(oracleId, expiry, strike, side, qty);
            if (cost > 0) await this.redis.incrbyfloat(hedgeCostKey(oracleId, strike), cost);
            book.hedgedToVault += residual > 0 ? qty : -qty;
            await setBook(this.redis, oracleId, strike, book);
            console.log(`[engine] hedged ${qty.toFixed(2)} ${side} on ${oracleId}@${strike}`);
        } catch (e: any) {
            console.error("[engine] hedge failed:", e?.message ?? e);
        }
    }

    // open a leveraged position: lock margin, borrow the rest, buy contracts, steer + gate
    openLeverage(userId: string, oracleId: string, strike: number, side: Side, marginUsd: number, leverage: number, id: string = randomUUID()): Promise<LevOpen> {
        return this.serialized(`${oracleId}:${strike}`, () => this.doOpenLev(userId, oracleId, strike, side, marginUsd, leverage, id));
    }

    private async doOpenLev(userId: string, oracleId: string, strike: number, side: Side, marginUsd: number, leverage: number, id: string): Promise<LevOpen> {
        if (!Number.isFinite(marginUsd) || marginUsd <= 0) throw new Error("bad margin");
        if (!(leverage >= 1) || leverage > LEV.maxLeverage) throw new Error(`leverage must be 1..${LEV.maxLeverage}`);

        const prior = await this.redis.get(betKey(id));
        if (prior) return JSON.parse(prior) as LevOpen;

        const gotUser = await this.redis.set(lockUser(userId), "1", "EX", 15, "NX");
        if (!gotUser) throw new Error("account busy");
        await this.redis.set(lockBook(oracleId, strike), "1", "EX", 15, "NX");
        try {
            const notional = Math.round(marginUsd * leverage);
            const borrowed = notional - marginUsd;
            const { d, q, book, band, hardCap } = await this.context(oracleId, strike, side, Math.max(1, notional / DUSDC_UNIT));
            const ask = askFor(q, side);
            if (ask <= 0) throw new Error("unpriceable");
            const contracts = notional / (ask * DUSDC_UNIT);

            // a 1x bet borrows nothing, so it carries no default risk and skips the lending gates
            // (imbalance ceiling, cohort capital cap, elasticity). it is still a closeable position.
            const lev = borrowed > 0;
            // refuse leverage inside the deleverage-cliff window: it would be force-closed at once. 1x is fine.
            if (lev && d.expiry - Date.now() <= LEV.cliffMs) throw new Error("too close to expiry for leverage");
            const lb = await getLevBook(this.redis, oracleId, strike);
            if (lev) {
                const crowding = (side === "yes" && lb.L >= lb.S) || (side === "no" && lb.S >= lb.L);
                if (crowding && breachesCeiling(lb.L, lb.S, side, notional, 6 * marginUsd)) throw new Error("imbalance ceiling");
            }

            const imbBefore = book.internalYes - book.internalNo;
            const imbAfter = imbBefore + (side === "yes" ? contracts : -contracts);
            if (Math.abs(imbAfter) > Math.abs(imbBefore) && Math.abs(imbAfter) > hardCap) throw new Error("market at capacity");

            // capital gate: atomically reserve this position's NOTIONAL (the leveraged open interest)
            // against the cohort's OI cap (the 0.14 rule, calibrated on notional). 1x reserves nothing.
            const cohort = cohortOf(d.underlying, d.expiry);
            const reservedOI = lev ? notional : 0;
            if (lev) {
                const reserveBase = (await this.reserveDollars()) * DUSDC_UNIT;
                if (!(await reserveCohortOI(this.redis, cohort, reservedOI, maxOI(reserveBase)))) throw new Error("leverage capacity reached");
            }

            try {
                const dynamicK = await getDynamicK(this.redis);
                const rate = lev ? borrowRate(side, lb.L, lb.S, dynamicK) : 0;

                await lockStake(this.redis, userId, marginUsd); // may throw on insufficient balance
                if (lev) {
                    // instrument elasticity: did this opener take the cheaper balancing side?
                    const imb0 = imbalanceFraction(lb.L, lb.S);
                    const incentive = Math.min(1, Math.abs(imb0) * dynamicK);
                    const balancing = imb0 !== 0 && ((imb0 > 0 && side === "no") || (imb0 < 0 && side === "yes"));
                    await this.recordElasticity(incentive, balancing ? 1 : 0);
                }
                const now = Date.now();
                const existing = await getLevPosition(this.redis, userId, oracleId, strike, side);
                const fees = existing ? existing.fees + accrueInterest(existing.borrowed, existing.rate, now - existing.accruedAt) : 0;
                const pos: LevPosition = {
                    userId, oracleId, strike, expiry: d.expiry, side, cohort,
                    contracts: (existing?.contracts ?? 0) + contracts,
                    margin: (existing?.margin ?? 0) + marginUsd,
                    borrowed: (existing?.borrowed ?? 0) + borrowed,
                    reservedOI: (existing?.reservedOI ?? 0) + reservedOI,
                    entryAsk: ask, rate, fees,
                    openedAt: existing?.openedAt ?? now,
                    accruedAt: now,
                };
                await setLevPosition(this.redis, pos);
                if (side === "yes") lb.L += notional;
                else lb.S += notional;
                lb.updatedAt = now;
                await setLevBook(this.redis, oracleId, strike, lb);
                await this.redis.sadd("markets:open", `${oracleId}:${strike}`);
                await this.redis.sadd(`umkts:${userId}`, `${oracleId}:${strike}`);

                await this.applyExposure(oracleId, strike, d.expiry, side, contracts, book, band);

                const open: LevOpen = { id, oracleId, strike, side, margin: marginUsd, borrowed, notional, contracts, ask, rate, ts: now };
                await this.redis.set(betKey(id), JSON.stringify(open));
                const l = await getLedger(this.redis, userId);
                await publish(this.redis, "bet:open", open, userRoom(userId));
                await publish(this.redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(userId));
                return open;
            } catch (e) {
                if (reservedOI > 0) await releaseCohortOI(this.redis, cohort, reservedOI); // roll back the reservation
                throw e;
            }
        } finally {
            await this.redis.del(lockBook(oracleId, strike));
            await this.redis.del(lockUser(userId));
        }
    }

    // user-initiated close of a leveraged position at the current mark
    closeLeverage(userId: string, oracleId: string, strike: number, side: Side, id: string = randomUUID()): Promise<LevClose> {
        return this.serialized(`${oracleId}:${strike}`, async () => {
            const prior = await this.redis.get(betKey(id));
            if (prior) return JSON.parse(prior) as LevClose;
            await this.redis.set(lockBook(oracleId, strike), "1", "EX", 15, "NX");
            try {
                const pos = await getLevPosition(this.redis, userId, oracleId, strike, side);
                if (!pos) throw new Error("no position");
                const result = await this.unwind(pos, "close");
                await this.redis.set(betKey(id), JSON.stringify(result));
                return result;
            } finally {
                await this.redis.del(lockBook(oracleId, strike));
            }
        });
    }

    // accumulate the elasticity meter's running sums (Sxx, Sxy, n) for the control loop
    private async recordElasticity(incentive: number, flipped: number) {
        const raw = await this.redis.get("lev:meter");
        const m = raw ? (JSON.parse(raw) as { sxx: number; sxy: number; n: number }) : { sxx: 0, sxy: 0, n: 0 };
        m.sxx += incentive * incentive;
        m.sxy += incentive * flipped;
        m.n += 1;
        await this.redis.set("lev:meter", JSON.stringify(m));
    }

    // serialized unwind for liquidation / cliff / settlement. re-reads the position under the
    // market lock so it never races a concurrent open. fairOverride forces the settlement mark.
    forceUnwind(userId: string, oracleId: string, strike: number, side: Side, reason: string, fairOverride?: number): Promise<LevClose | null> {
        return this.serialized(`${oracleId}:${strike}`, async () => {
            await this.redis.set(lockBook(oracleId, strike), "1", "EX", 15, "NX");
            try {
                const pos = await getLevPosition(this.redis, userId, oracleId, strike, side);
                if (!pos) return null;
                return await this.unwind(pos, reason, fairOverride);
            } finally {
                await this.redis.del(lockBook(oracleId, strike));
            }
        });
    }

    // close a leveraged position at the current mark: repay the loan, return equity, unwind the
    // books. shared by close, liquidation, cliff, settlement. caller serializes the market.
    async unwind(pos: LevPosition, reason: string, fairOverride?: number): Promise<LevClose> {
        const d = await getDetails(this.redis, pos.oracleId);
        const f = fairOverride ?? (d?.price && d.svi ? fairYes(d.price.forward, pos.strike, d.svi) : null);
        const mark = f == null ? pos.entryAsk : markFor(pos.side, f);
        const now = Date.now();
        const fees = pos.fees + accrueInterest(pos.borrowed, pos.rate, now - pos.accruedAt);
        const value = Math.round(pos.contracts * mark * DUSDC_UNIT);
        const owed = pos.borrowed + fees;
        const returned = Math.max(0, value - owed);
        // route real cash to the pool: interest it can cover above principal, and unrecovered principal
        const interestPaid = Math.max(0, Math.min(fees, value - pos.borrowed));
        const badDebt = Math.max(0, pos.borrowed - value);

        await settlePosition(this.redis, pos.userId, pos.margin, returned);
        await delLevPosition(this.redis, pos);

        const tag = `${pos.userId}:${pos.oracleId}:${pos.strike}:${pos.side}:${pos.openedAt}`;
        if (interestPaid > 0) await creditFee(this.redis, interestPaid, `intr:${tag}`);
        if (badDebt > 0) await debitLoss(this.redis, badDebt, `bdbt:${tag}`);

        const notional = pos.margin + pos.borrowed;
        const lb = await getLevBook(this.redis, pos.oracleId, pos.strike);
        if (pos.side === "yes") lb.L = Math.max(0, lb.L - notional);
        else lb.S = Math.max(0, lb.S - notional);
        lb.updatedAt = now;
        await setLevBook(this.redis, pos.oracleId, pos.strike, lb);
        const reservedOI = pos.reservedOI ?? 0; // release exactly what this position reserved
        if (reservedOI > 0) await releaseCohortOI(this.redis, pos.cohort, reservedOI);
        if (badDebt > 0) {
            const tot = Number((await this.redis.get("lev:baddebt")) ?? 0) + badDebt;
            await this.redis.set("lev:baddebt", String(tot));
        }

        // remove the directional exposure and re-hedge
        const book = await getBook(this.redis, pos.oracleId, pos.strike);
        const reserve = await this.reserveDollars();
        const T = d ? Math.max(0, Math.min(1, (d.expiry - now) / Math.max(1, d.expiry - d.activatedAt))) : 1;
        await this.applyExposure(pos.oracleId, pos.strike, pos.expiry, pos.side, -pos.contracts, book, ECON.riskFraction * reserve * T);

        // persist a trade-history record, however the position ended
        const leverage = pos.margin > 0 ? (pos.margin + pos.borrowed) / pos.margin : 1;
        const rec: HistRecord = {
            oracleId: pos.oracleId, strike: pos.strike, side: pos.side, leverage, reason,
            contracts: pos.contracts, margin: pos.margin, borrowed: pos.borrowed, entryAsk: pos.entryAsk,
            mark, value, returned, badDebt, pnl: returned - pos.margin, openedAt: pos.openedAt, closedAt: now,
        };
        await recordClose(this.redis, pos.userId, rec);

        const l = await getLedger(this.redis, pos.userId);
        const result: LevClose = { oracleId: pos.oracleId, strike: pos.strike, side: pos.side, reason, mark, value, returned, margin: pos.margin, badDebt, interestPaid, ts: now };
        await publish(this.redis, "bet:closed", result, userRoom(pos.userId));
        await publish(this.redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(pos.userId));
        if (reason !== "close") {
            console.log(`[engine] ${reason} ${pos.side} value=${(value / 1e6).toFixed(2)} returned=${(returned / 1e6).toFixed(2)} badDebt=${(badDebt / 1e6).toFixed(2)}`);
        }
        return result;
    }

    private async emitFill(userId: string, oracleId: string, strike: number, fill: Fill, book: Book) {
        const l = await getLedger(this.redis, userId);
        await publish(this.redis, "fill", fill, userRoom(userId));
        await publish(this.redis, "account:update", { balance: l.balance, available: available(l) }, userRoom(userId));
        await publish(
            this.redis,
            "book:update",
            { oracleId, strike, net: book.internalYes - book.internalNo, updatedAt: book.updatedAt },
            marketRoom(oracleId, strike),
        );
    }
}
