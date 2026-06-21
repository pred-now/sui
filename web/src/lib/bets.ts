import { DUSDC_UNIT } from "@/lib/account";
import { yesProbability, type Svi } from "@/lib/odds";
import type { MarketDetails } from "@/lib/markets";

export type Side = "yes" | "no";

// leverage is force-closed in the final minute before expiry (mirrors server LEV.cliffMs)
export const CLIFF_MS = 60_000;

// true when a market is close enough to expiry that leverage would be auto-closed
export const nearExpiry = (expiry: number, now: number) => expiry - now <= CLIFF_MS;

// turn a raw engine/socket error into something a trader can actually act on
const ERROR_MAP: [RegExp, string][] = [
    [/insufficient/i, "You don't have enough balance for this. Lower the amount or deposit more."],
    [/too close to expiry/i, "This market is about to settle, so leverage is off. You can still place a 1x bet."],
    [/leverage capacity/i, "Leverage is maxed out on this market right now. Lower your leverage or try again shortly."],
    [/imbalance ceiling/i, "Too much leverage is stacked on this side. Try the other side or reduce your leverage."],
    [/market at capacity/i, "This market has hit its size limit. Try a smaller amount or another market."],
    [/leverage must be/i, "Leverage must be between 1x and 5x."],
    [/unpriceable/i, "We can't price this strike right now. Pick a strike closer to the current price."],
    [/market paused|no oracle data/i, "This market is paused while we wait for fresh prices. Try again in a moment."],
    [/market not active|unknown market/i, "This market isn't open for trading."],
    [/account busy/i, "You have another action in progress. Give it a second and try again."],
    [/no position/i, "That position is no longer open."],
    [/cooldown/i, "Your unstake is still in its cooldown window. Try again once it ends."],
    [/capital backing open risk/i, "That capital is currently backing open positions. You can claim more once it frees up."],
    [/no pending unstake/i, "You don't have a pending unstake to claim."],
    [/insufficient shares|amount too small/i, "Enter a valid amount."],
    [/bad (amount|margin|shares)/i, "Enter a valid amount."],
    [/betting offline/i, "Trading is temporarily unavailable. Please try again shortly."],
    [/unauthorized|not connected|no market/i, "Please log in and pick a market to trade."],
];

export function friendlyError(raw?: string, fallback = "Something went wrong. Please try again."): string {
    if (!raw) return fallback;
    for (const [re, msg] of ERROR_MAP) if (re.test(raw)) return msg;
    return fallback;
}

// a quote for one (oracleId, strike): house odds plus the leverage knobs
export interface Quote {
    oracleId: string;
    strike: number;
    f: number;
    h: number;
    k: number;
    yesAsk: number;
    noAsk: number;
    expiry: number;
    band: number;
    hardCap: number;
    net: number;
    paused?: boolean;
    maxLeverage: number;
    borrowRate: number; // annual, for the quoted side
}

// an open position, marked live (base units for money, 0..1 for marks)
export interface UiPosition {
    oracleId: string;
    strike: number;
    side: Side;
    underlying: string;
    expiry: number;
    leverage: number;
    contracts: number;
    margin: number;
    borrowed: number;
    entryAsk: number;
    rate: number;
    fees: number;
    openedAt: number;
    mark: number;
    value: number;
    equity: number;
    pnl: number;
    liqYes: number | null;
}

// a closed bet, however it ended
export interface HistItem {
    oracleId: string;
    strike: number;
    side: Side;
    leverage: number;
    reason: string; // close | liquidation | cliff | settle
    contracts: number;
    margin: number;
    borrowed: number;
    entryAsk: number;
    mark: number;
    value: number;
    returned: number;
    badDebt: number;
    pnl: number;
    openedAt: number;
    closedAt: number;
}

// value per contract for a side, off the YES probability
export const markFor = (side: Side, yesProb: number) => (side === "yes" ? yesProb : 1 - yesProb);

// YES probability at which a position liquidates. null when nothing is borrowed.
export function liqYesFor(contracts: number, side: Side, owed: number, maintenance = 0.07): number | null {
    if (owed <= 0 || contracts <= 0) return null;
    const markLiq = owed / ((1 - maintenance) * contracts * DUSDC_UNIT);
    const clamped = Math.min(1, Math.max(0, markLiq));
    return side === "yes" ? clamped : 1 - clamped;
}

// re-mark a position against the live surface (only mark moves second-to-second; fees drift is negligible)
export function recompute(p: UiPosition, details: MarketDetails | null): UiPosition {
    if (!details?.price || !details.svi) return p;
    const yesProb = yesProbability(details.price.forward, p.strike, details.svi);
    if (yesProb == null) return p;
    const mark = markFor(p.side, yesProb);
    const owed = p.borrowed + p.fees;
    const value = Math.round(p.contracts * mark * DUSDC_UNIT);
    const equity = value - owed;
    return { ...p, mark, value, equity, pnl: equity - p.margin, liqYes: liqYesFor(p.contracts, p.side, owed) };
}

// invert the surface: the underlying forward where YES = targetYes (monotonic increasing in forward)
export function forwardForYes(targetYes: number, strike: number, svi: Svi, spot: number): number | null {
    if (targetYes <= 0 || targetYes >= 1) return null;
    let lo = strike * 0.2;
    let hi = strike * 5;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const p = yesProbability(mid, strike, svi);
        if (p == null) return null;
        if (p < targetYes) lo = mid;
        else hi = mid;
    }
    void spot;
    return (lo + hi) / 2;
}
