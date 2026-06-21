"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { useMarkets } from "@/components/MarketsProvider";
import { useTrading } from "@/components/Trade/TradingProvider";
import { useAuth } from "@/components/AuthProvider";
import { useDeposit } from "@/components/Trade/DepositProvider";
import { useWithdraw } from "@/components/Trade/WithdrawProvider";
import { useNow } from "@/hooks/use-now";
import { liqYesFor, forwardForYes, nearExpiry, friendlyError } from "@/lib/bets";
import { Hint, HINTS } from "@/components/Trade/Hint";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

const UNIT = 1_000_000;

function Row({
    label,
    value,
    valueClass,
    hint,
}: {
    label: string;
    value: string;
    valueClass?: string;
    hint?: string;
}) {
    return (
        <div className="flex justify-between text-[12.5px]">
            <span className="text-pred-dim">{hint ? <Hint text={hint}>{label}</Hint> : label}</span>
            <span className={cn("font-semibold text-pred-text", valueClass)}>{value}</span>
        </div>
    );
}

const usd = (base: number) =>
    `$${(base / UNIT).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCents = (c: number | null) => (c == null ? "--" : c.toFixed(1));

export default function TradePanel() {
    const { selected, strike, setStrike, details } = useMarkets();
    const { account, quote, positions, activeSide, setActiveSide, placeBet, busy } = useTrading();
    const { token } = useAuth();
    const { open: openDeposit } = useDeposit();
    const { open: openWithdraw } = useWithdraw();

    const [amount, setAmount] = useState("100");
    const [leverage, setLeverage] = useState(1);
    const [err, setErr] = useState<string | null>(null);
    const now = useNow();

    // inside the cliff window leverage would be force-closed at once, so only 1x is offered there
    const nearExp = details ? nearExpiry(details.expiry, now) : false;
    const maxLev = nearExp ? 1 : (quote?.maxLeverage ?? 5);
    const lev = Math.min(Math.max(1, leverage), maxLev); // effective leverage, clamped

    // strike drives the odds and is the bet's limit
    const [draft, setDraft] = useState("");
    const [prevStrike, setPrevStrike] = useState(strike);
    if (strike !== prevStrike) {
        setPrevStrike(strike);
        setDraft(strike != null ? String(strike) : "");
    }
    const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (debounce.current) clearTimeout(debounce.current);
    }, []);
    const onStrike = (v: string) => {
        const clean = v.replace(/[^0-9.]/g, "");
        setDraft(clean);
        const n = Number(clean);
        if (n <= 0) return;
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => setStrike(n), 200);
    };
    const useSpot = () => {
        if (debounce.current) clearTimeout(debounce.current);
        if (details?.price) setStrike(Math.round(details.price.forward));
    };

    const paused = quote?.paused === true;
    const yesAsk = quote && !paused ? quote.yesAsk : null; // 0..1
    const noAsk = quote && !paused ? quote.noAsk : null;
    const yes = activeSide === "yes";
    const ask = yes ? yesAsk : noAsk;
    const priced = ask != null && ask > 0;

    const amt = parseFloat(amount) || 0;
    const notional = amt * lev;
    const borrowed = notional - amt;
    const contracts = priced ? notional / (ask as number) : 0;
    const payout = priced ? contracts - borrowed : 0; // net received on a win
    const profit = priced ? contracts - notional : 0;
    const retPct = priced && amt > 0 ? (profit / amt) * 100 : 0;

    // prospective liquidation: at open, fees are zero so owed = borrowed
    const liqYes = priced && borrowed > 0 ? liqYesFor(contracts, activeSide, borrowed) : null;
    const liqUsd =
        liqYes != null && strike != null && details?.svi && details.price
            ? forwardForYes(liqYes, strike, details.svi, details.price.spot)
            : null;

    const availableBase = account?.available ?? 0;
    const availableUsd = availableBase / UNIT;

    // existing position in this market on the chosen side
    const mine = positions.filter((p) => selected && p.oracleId === selected.oracleId && p.side === activeSide);
    const myShares = mine.reduce((s, p) => s + p.contracts, 0);

    // portfolio rollup across all open positions
    const equitySum = positions.reduce((s, p) => s + p.equity, 0);
    const valueSum = positions.reduce((s, p) => s + p.value, 0);
    const pnlSum = positions.reduce((s, p) => s + p.pnl, 0);
    const acctEquity = availableBase + equitySum;
    const marketsTraded = new Set(positions.map((p) => p.oracleId)).size;

    const tooBig = amt > availableUsd;
    const canPlace = priced && !!token && amt > 0 && !tooBig && !busy;
    const placeLabel = paused
        ? "Market paused"
        : !token
          ? "Log in to trade"
          : tooBig
            ? "Insufficient balance"
            : `Buy ${yes ? "Yes" : "No"} · ${fmtCents(ask == null ? null : ask * 100)}¢${lev > 1 ? ` · ${lev}x` : ""}`;

    const onPlace = async () => {
        setErr(null);
        const r = await placeBet({ side: activeSide, amount: amt, leverage: lev });
        if (!r.ok) setErr(friendlyError(r.error, "Couldn't place your bet. Please try again."));
    };

    return (
        <aside className="flex h-full w-full flex-col overflow-y-auto bg-pred-panel">
            <div className="p-3.5">
                {/* outcome */}
                <div className="mb-3.5 flex gap-2 pt-[1px]">
                    <Button
                        variant="outline"
                        onClick={() => setActiveSide("yes")}
                        className={cn(
                            "h-auto flex-1 justify-between rounded-lg px-3.5 py-2.75 border-pred-green/30 hover:border-pred-green",
                            yes
                                ? "bg-pred-green text-pred-ink hover:bg-pred-green border-pred-green hover:text-pred-ink"
                                : "bg-transparent text-pred-green hover:border-pred-green/60 hover:bg-transparent hover:text-pred-green",
                        )}
                    >
                        <span className="text-sm font-bold">YES</span>
                        <span className="text-[15px] font-bold">{fmtCents(yesAsk == null ? null : yesAsk * 100)}¢</span>
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setActiveSide("no")}
                        className={cn(
                            "h-auto flex-1 justify-between rounded-lg px-3.5 py-2.75 border-pred-red/50 hover:border-pred-red",
                            !yes
                                ? "bg-pred-red text-white hover:bg-pred-red border-pred-red hover:text-white"
                                : " bg-transparent text-pred-red hover:border-pred-red/60 hover:bg-transparent hover:text-pred-red",
                        )}
                    >
                        <span className="text-sm font-bold">NO</span>
                        <span className="text-[15px] font-bold">{fmtCents(noAsk == null ? null : noAsk * 100)}¢</span>
                    </Button>
                </div>

                {/* leverage */}
                <div className="mb-4">
                    <div className="mb-2.25 flex items-center justify-between">
                        <Hint text={HINTS.leverage} className="text-xs text-pred-dim">Leverage</Hint>
                        <span className="text-[15px] font-bold text-pred-white">{lev}x</span>
                    </div>
                    <Slider
                        min={1}
                        max={maxLev}
                        step={1}
                        value={[lev]}
                        disabled={nearExp}
                        onValueChange={(v) => setLeverage(v[0])}
                    />
                    <div className="mt-1.75 flex justify-between text-[10px] text-pred-dimmer">
                        <span>1x</span>
                        <span>{maxLev}x</span>
                    </div>
                    {nearExp && (
                        <p className="mt-1.5 text-[11px] text-pred-dim">
                            Near expiry: leverage is unavailable (it would be auto-closed). 1x rides to settlement.
                        </p>
                    )}
                </div>

                {/* strike, the bet's limit, drives the odds live */}
                <div className="mb-4">
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs text-pred-dim">Strike price</span>
                        <button
                            onClick={useSpot}
                            className="rounded-md border border-pred-edge/25 bg-pred-elevated px-2 py-0.5 text-[11px] font-semibold text-pred-dim hover:border-pred-edge/50 hover:text-pred-text"
                        >
                            Spot
                        </button>
                    </div>
                    <div className="flex h-[42px] items-center gap-2 rounded-[4px] border border-pred-edge/15 bg-pred-input px-3">
                        <span className="text-[13px] font-semibold whitespace-nowrap text-pred-dim">≥</span>
                        <Input
                            value={draft}
                            onChange={(e) => onStrike(e.target.value)}
                            inputMode="decimal"
                            placeholder="63000"
                            className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-pred-text shadow-none focus-visible:ring-0"
                        />
                    </div>
                </div>

                {/* amount */}
                <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-xs text-pred-dim">Amount</span>
                    <span className="text-[11px] text-pred-dim">
                        Balance: <span className="text-secondary-foreground">{usd(availableBase)}</span>
                    </span>
                </div>
                <div className="mb-4 flex h-[42px] items-center gap-2 rounded-[4px] border border-pred-edge/15 bg-pred-input px-3">
                    <span className="text-[15px] font-semibold text-pred-dim">$</span>
                    <Input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        inputMode="decimal"
                        className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-pred-text shadow-none focus-visible:ring-0"
                    />
                    <span className="text-xs font-semibold text-pred-dim">USDC</span>
                </div>

                {/* summary */}
                <div className="mb-4 flex flex-col gap-2.25">
                    <Row label="Position size" value={`$${notional.toFixed(2)}`} hint={HINTS.positionSize} />
                    <Row label="Avg price" value={`${fmtCents(ask == null ? null : ask * 100)}¢`} hint={HINTS.avgPrice} />
                    <Row label="Shares" value={priced ? contracts.toFixed(2) : "--"} hint={HINTS.shares} />
                    <Row label="Potential payout" value={priced ? `$${payout.toFixed(2)}` : "--"} hint={HINTS.payout} />
                    <Row
                        label="Potential return"
                        value={priced ? `${retPct >= 0 ? "+" : ""}${retPct.toFixed(1)}%` : "--"}
                        valueClass="text-pred-white"
                        hint={HINTS.return}
                    />
                    {lev > 1 && (
                        <Row
                            label="Borrow rate"
                            value={quote ? `${(quote.borrowRate * 100).toFixed(1)}% APR` : "--"}
                            hint={HINTS.borrowRate}
                        />
                    )}
                    <Row
                        label="Liq price"
                        value={
                            liqYes == null
                                ? "--"
                                : liqUsd != null
                                  ? `$${Math.round(liqUsd).toLocaleString()} (${(liqYes * 100).toFixed(1)}¢)`
                                  : `${(liqYes * 100).toFixed(1)}¢`
                        }
                        valueClass={liqYes == null ? undefined : "text-pred-red"}
                        hint={HINTS.liqPrice}
                    />
                </div>

                <Button
                    disabled={!canPlace}
                    onClick={onPlace}
                    className={cn(
                        "h-auto w-full rounded-lg py-3.25 text-sm font-bold text-white disabled:opacity-60",
                        yes ? "bg-pred-green hover:bg-pred-green/90" : "bg-pred-red hover:bg-pred-red/90",
                    )}
                >
                    {busy ? "Placing..." : placeLabel}
                </Button>
                {err && <p className="mt-2 text-center text-[12px] text-pred-red">{err}</p>}

                {/* account */}
                <Separator className="mt-4 bg-pred-edge/10" />
                <div className="mt-3.5 flex flex-col gap-2.25">
                    <Row label="Available to trade" value={`${usd(availableBase)} USDC`} />
                    <Row label="Your position" value={`${myShares.toFixed(2)} shares`} />
                </div>

                {/* deposit / withdraw */}
                <div className="mt-3.5 flex gap-2">
                    <Button
                        variant="outline"
                        onClick={openDeposit}
                        className="h-auto flex-1 rounded-[2px] border-pred-edge/20 bg-pred-elevated py-2.5 text-[13px] font-semibold text-secondary-foreground hover:border-pred-edge/40 hover:bg-pred-elevated hover:text-pred-text"
                    >
                        <ArrowDownToLine className="size-3.5" />
                        Deposit
                    </Button>
                    <Button
                        variant="outline"
                        onClick={openWithdraw}
                        className="h-auto flex-1 rounded-[2px] border-pred-edge/20 bg-pred-elevated py-2.5 text-[13px] font-semibold text-secondary-foreground hover:border-pred-edge/40 hover:bg-pred-elevated hover:text-pred-text"
                    >
                        <ArrowUpFromLine className="size-3.5" />
                        Withdraw
                    </Button>
                </div>

                {/* portfolio */}
                <Separator className="mt-4 bg-pred-edge/10" />
                <div className="mt-3.5">
                    <div className="mb-2.75 text-xs font-bold tracking-[0.02em] text-secondary-foreground">
                        Portfolio
                    </div>
                    <div className="flex flex-col gap-2.25">
                        <Row label="Account equity" value={usd(acctEquity)} hint={HINTS.accountEquity} />
                        <Row label="Cash (USDC)" value={usd(availableBase)} hint={HINTS.cash} />
                        <Row label="Positions value" value={usd(valueSum)} hint={HINTS.positionsValue} />
                        <Row
                            label="Open P&L"
                            value={`${pnlSum >= 0 ? "+" : "-"}${usd(Math.abs(pnlSum))}`}
                            valueClass={pnlSum >= 0 ? "text-pred-green" : "text-pred-red"}
                            hint={HINTS.openPnl}
                        />
                        <Row label="Markets traded" value={String(marketsTraded)} />
                    </div>
                </div>
            </div>
        </aside>
    );
}
