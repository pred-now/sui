// live Phase-1 test against testnet + local redis.
//   tsx scripts/live-bet-test.ts          quote + internal bet + netting (no chain spend)
//   tsx scripts/live-bet-test.ts --hedge  also forces a real vault hedge mint
import "dotenv/config";
import { createRedis } from "../lib/redis";
import { createJsonRpc } from "../lib/sui";
import { getJson } from "../lib/predict";
import { toMarket } from "../lib/market";
import { MarketDetailsService } from "../services/market-details";
import { TreasuryService } from "../services/treasury";
import { BetEngine } from "../services/engine";
import { getOrCreateUser } from "../services/user";
import { getLedger, setLedger, available } from "../lib/ledger";
import { getBook, netExposure } from "../lib/book";
import { getLevBook, getLevOI } from "../lib/levbook";
import { tradeAmounts } from "../lib/vault";
import { crossCheck } from "../lib/pyth";
import { env } from "../lib/env";

const HEDGE = process.argv.includes("--hedge");
const LEVERAGE = process.argv.includes("--leverage");
const USER = "livetest:user";
const usd = (b: number) => "$" + (b / 1e6).toFixed(2);

async function main() {
    const redis = createRedis();
    const rpc = createJsonRpc();
    const treasury = new TreasuryService(redis, rpc);
    const details = new MarketDetailsService(redis);
    const engine = new BetEngine(redis, rpc, treasury);

    // 1. platform reserve
    const reserve = await treasury.reserveBalance();
    console.log(`\n[1] platform reserve = ${usd(reserve)} dusdc (manager ${env.platformManagerId?.slice(0, 10)}...)`);
    if (reserve <= 0) console.warn("    reserve is 0 — fund the platform manager to enable betting/hedging");

    // 2. find a live market with the most time to expiry (largest capacity band)
    const raw = await getJson(`/predicts/${env.predictId}/oracles`);
    const oracles = (Array.isArray(raw) ? raw : raw.oracles ?? []).map(toMarket);
    const now = Date.now();
    const live = oracles
        .filter((o: any) => o.status === "active" && o.expiry > now + 120_000)
        .sort((a: any, b: any) => b.expiry - a.expiry);
    if (!live.length) throw new Error("no live markets with >2min to expiry");
    const oracleId = live[0].oracleId;
    const d = await details.refresh(oracleId);
    if (!d?.price || !d.svi) throw new Error("no oracle price/svi yet");
    const strike = Math.round(d.price.forward);
    console.log(`\n[2] market ${oracleId.slice(0, 10)}... ${d.underlying} forward=${d.price.forward.toFixed(0)} strike=${strike} expires in ${Math.round((d.expiry - now) / 60000)}min`);

    // 2b. pyth cross-check: independent price vs the oracle spot (the liquidation guard)
    try {
        const cc = await crossCheck(d.underlying, d.price.spot, 100);
        console.log(`    pyth cross-check: oracle=${d.price.spot.toFixed(0)} pyth=${cc.pyth.toFixed(0)} divergence=${cc.bps.toFixed(1)}bps -> ${cc.ok ? "OK (liquidations allowed)" : "PAUSE"}`);
    } catch (e: any) {
        console.log(`    pyth cross-check unavailable: ${e?.message} -> liquidations pause (fail closed)`);
    }

    // 3. live vault quote (get_trade_amounts devInspect)
    const va = await tradeAmounts(rpc, oracleId, d.expiry, strike, "yes", 1).catch(e => {
        console.warn("    vault quote failed:", e?.message);
        return null;
    });
    if (va) console.log(`\n[3] vault get_trade_amounts(1 YES): mint=${usd(va.mintCost)} redeem=${usd(va.redeemPayout)} spread=${usd(va.mintCost - va.redeemPayout)}`);

    // 4. house quote (with live capacity)
    const q = await engine.getQuote(oracleId, strike, "yes");
    console.log(`\n[4] house quote: f=${q.f.toFixed(4)} h=${q.h.toFixed(4)} k=${q.k.toFixed(4)} yesAsk=${q.yesAsk.toFixed(4)} noAsk=${q.noAsk.toFixed(4)}`);
    console.log(`    invariant yesAsk+noAsk = ${(q.yesAsk + q.noAsk).toFixed(4)} vs 1+2h = ${(1 + 2 * q.h).toFixed(4)}`);
    console.log(`    capacity: band=${q.band.toFixed(1)} contracts, hardCap=${q.hardCap.toFixed(1)} contracts`);

    // size bets to the live band so they fit under the hard cap
    const stakeFor = (contracts: number, ask: number) => Math.max(500_000, Math.round(contracts * ask * 1e6));
    const yesStake = stakeFor(q.band * 0.4, q.yesAsk);
    const noStake = stakeFor(q.band * 0.3, q.noAsk);

    // 5. seed a test user with $200 and place internal bets that net
    await getOrCreateUser(redis, USER, "test");
    await setLedger(redis, USER, { balance: 200_000_000, locked: 0, debt: 0, fees: 0 });
    const fYes = await engine.placeBet(USER, oracleId, strike, "yes", yesStake, `live-yes-${Date.now()}`);
    console.log(`\n[5] bet ${usd(yesStake)} YES -> ${fYes.contracts.toFixed(2)} contracts @ ${fYes.ask.toFixed(4)}`);
    const fNo = await engine.placeBet(USER, oracleId, strike, "no", noStake, `live-no-${Date.now()}`);
    console.log(`    bet ${usd(noStake)} NO  -> ${fNo.contracts.toFixed(2)} contracts @ ${fNo.ask.toFixed(4)}`);
    const book = await getBook(redis, oracleId, strike);
    const l = await getLedger(redis, USER);
    console.log(`    book: yes=${book.internalYes.toFixed(2)} no=${book.internalNo.toFixed(2)} net=${netExposure(book).toFixed(2)} | ledger locked=${usd(l.locked)} available=${usd(available(l))}`);

    // 6. optional real hedge: bet across the band (under the hard cap) to mint on chain
    if (HEDGE) {
        if (reserve <= 0) throw new Error("cannot hedge with a zero reserve");
        const hedgeStake = stakeFor(q.band * 1.6, q.yesAsk); // crosses band, under 3x hardCap
        const f = await engine.placeBet(USER, oracleId, strike, "yes", hedgeStake, `live-hedge-${Date.now()}`);
        const b2 = await getBook(redis, oracleId, strike);
        console.log(`\n[6] bet ${usd(hedgeStake)} YES -> ${f.contracts.toFixed(2)} contracts; hedgedToVault=${b2.hedgedToVault.toFixed(2)} (non-zero means a real predict::mint fired)`);
    } else {
        console.log(`\n[6] skipped on-chain hedge (run with --hedge to force a real vault mint)`);
    }

    // 7. optional leverage: open a small 3x position, inspect, then close
    if (LEVERAGE) {
        const open = await engine.openLeverage(USER, oracleId, strike, "yes", 2_000_000, 3, `live-lev-${Date.now()}`);
        console.log(`\n[7] leverage open: margin ${usd(open.margin)} 3x -> notional ${usd(open.notional)} borrowed ${usd(open.borrowed)} ${open.contracts.toFixed(2)} contracts rate=${(open.rate * 100).toFixed(1)}%`);
        const lb = await getLevBook(redis, oracleId, strike);
        console.log(`    book: L=${usd(lb.L)} S=${usd(lb.S)} globalOI=${usd(await getLevOI(redis))}`);
        const close = await engine.closeLeverage(USER, oracleId, strike, "yes", `live-levclose-${Date.now()}`);
        console.log(`    close: mark=${close.mark.toFixed(4)} value=${usd(close.value)} returned=${usd(close.returned)} badDebt=${usd(close.badDebt)}`);
    } else {
        console.log(`\n[7] skipped leverage (run with --leverage to open + close a 3x position)`);
    }

    console.log("\ndone. cleaning up test state (on-chain hedge, if any, stays until settlement).");
    const tag = `${oracleId}:${strike}`;
    await redis.del(`ledger:${USER}`, `book:${oracleId}:${strike}`, `pos:${USER}:${oracleId}:${strike}`, `levbook:${oracleId}:${strike}`);
    await redis.srem(`positions:${oracleId}:${strike}`, USER);
    await redis.srem("markets:open", tag);
    await redis.srem(`umkts:${USER}`, tag);
    await redis.quit();
    process.exit(0);
}

main().catch(e => {
    console.error("\nFAILED:", e?.message ?? e);
    process.exit(1);
});
