"use client";

import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/Trade/Hint";
import { useAuth } from "@/components/AuthProvider";
import { useMarkets } from "@/components/MarketsProvider";
import { useTrading } from "@/components/Trade/TradingProvider";
import { useNow } from "@/hooks/use-now";
import { friendlyError } from "@/lib/bets";
import {
    getPool,
    getPoolPosition,
    poolStake,
    poolUnstake,
    poolClaim,
    type PoolInfo,
    type PoolPosition,
} from "@/lib/pool";

const UNIT = 1_000_000;
const usd = (base: number) =>
    `$${(base / UNIT).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// a readable duration ("1 day" / "23h" / "30m"), not a DD.HH.MM.SS countdown
function humanDuration(ms: number): string {
    if (ms <= 0) return "now";
    const d = Math.floor(ms / 86_400_000);
    if (d >= 1) return `${d} day${d > 1 ? "s" : ""}`;
    const h = Math.floor(ms / 3_600_000);
    if (h >= 1) return `${h}h`;
    const m = Math.floor(ms / 60_000);
    if (m >= 1) return `${m}m`;
    return `${Math.floor(ms / 1000)}s`;
}

const HINT = {
    tvl: "Total USDC backing Pred's risk. It rises with fees and stake, and falls when the pool covers a loss.",
    sharePrice:
        "Value of one pool share. It starts at $1.00 and grows as fee revenue accrues. Your yield is this number rising.",
    capacity:
        "Leveraged open interest the pool currently backs, versus the most it can back (pool / 0.14). More stake raises the cap.",
    free: "Capital not currently backing open risk. This is the most that can be unstaked right now.",
    stakerShare: "Share of every Pred fee that flows to stakers as NAV. The rest funds the protocol.",
    cooldown:
        "After requesting an unstake, your funds wait this long before they can be claimed. This protects the pool during stress.",
    value: "What your shares are worth right now, at the current share price.",
};

function Stat({
    label,
    value,
    hint,
    valueClass,
}: {
    label: string;
    value: string;
    hint?: string;
    valueClass?: string;
}) {
    return (
        <div className="flex items-center justify-between py-1.5 text-[13px]">
            <span className="text-pred-dim">{hint ? <Hint text={hint}>{label}</Hint> : label}</span>
            <span className={cn("font-semibold tabular-nums text-pred-text", valueClass)}>{value}</span>
        </div>
    );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("rounded-xl border border-pred-edge/10 bg-pred-panel p-4", className)}>
            {title && (
                <div className="mb-2 text-xs font-bold tracking-[0.02em] text-secondary-foreground">{title}</div>
            )}
            {children}
        </div>
    );
}

export default function EarnPage() {
    const { token } = useAuth();
    const { socket } = useMarkets();
    const { account, refresh: refreshAccount } = useTrading();
    const now = useNow();

    const [pool, setPool] = useState<PoolInfo | null>(null);
    const [pos, setPos] = useState<PoolPosition | null>(null);
    const [tab, setTab] = useState<"stake" | "unstake">("stake");
    const [amount, setAmount] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    const refresh = useCallback(() => {
        getPool()
            .then(setPool)
            .catch(() => {});
        if (token)
            getPoolPosition(token)
                .then(setPos)
                .catch(() => {});
    }, [token]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // keep the NAV fresh: poll, plus the server's pool:update broadcast
    useEffect(() => {
        const t = setInterval(refresh, 20000);
        return () => clearInterval(t);
    }, [refresh]);
    useEffect(() => {
        if (!socket) return;
        const on = () => refresh();
        socket.on("pool:update", on);
        return () => {
            socket.off("pool:update", on);
        };
    }, [socket, refresh]);

    const sharePrice = pool?.sharePrice ?? 1;
    const util = pool && pool.maxOI > 0 ? Math.min(1, pool.leveragedOI / pool.maxOI) : 0;
    const idle = account?.available ?? 0;
    const amt = parseFloat(amount) || 0;

    const myValue = token ? (pos?.value ?? 0) : 0;
    const myShares = token ? (pos?.shares ?? 0) : 0;
    const claim = token ? (pos?.claim ?? null) : null;
    const claimReadyAt = claim ? claim.requestedAt + (pool?.cooldownMs ?? 0) : 0;
    const claimMatured = !!claim && now >= claimReadyAt;

    // stake preview: shares received ~ amount / sharePrice; unstake: shares for the requested value
    const sharesReceived = amt > 0 ? amt / sharePrice : 0;
    const unstakeShares = Math.min(myShares, Math.round((amt * UNIT) / sharePrice));

    const run = async (fn: () => Promise<unknown>, ok: string) => {
        setErr(null);
        setMsg(null);
        setBusy(true);
        try {
            await fn();
            setMsg(ok);
            setAmount("");
            refresh();
            refreshAccount(); // staking moved cash; update the header balance now
        } catch (e: any) {
            setErr(friendlyError(e?.message));
        } finally {
            setBusy(false);
        }
    };

    const staking = tab === "stake";
    const tooBig = staking ? amt * UNIT > idle : amt * UNIT > myValue;
    const canAct = !!token && pool?.enabled && amt > 0 && !tooBig && !busy;

    const actionLabel = !token
        ? "Log in to earn"
        : !pool?.enabled
          ? "Staking unavailable"
          : tooBig
            ? staking
                ? "Insufficient balance"
                : "Not enough staked"
            : staking
              ? `Stake ${usd(amt * UNIT)}`
              : `Unstake ${usd(amt * UNIT)}`;

    return (
        <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex-none px-4 py-2.5">
                <div className="mx-auto max-w-4xl">
                    <h1 className="text-base font-semibold text-pred-white">Earn</h1>
                    <p className="text-[11px] text-pred-dimmer">
                        Provide the risk capital behind Pred and earn a share of every fee. Stakers bear the tail.
                    </p>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[1fr_360px]">
                    {/* left: pool + your position */}
                    <div className="flex flex-col gap-4">
                        <Card title="Pool">
                            <Stat label="Total value locked" value={pool ? usd(pool.assets) : "--"} hint={HINT.tvl} />
                            <Stat
                                label="Share price"
                                value={pool ? `$${sharePrice.toFixed(4)}` : "--"}
                                hint={HINT.sharePrice}
                                valueClass="text-pred-green"
                            />
                            <Stat
                                label="Stakers earn"
                                value={pool ? `${Math.round(pool.stakerShare * 100)}% of fees` : "--"}
                                hint={HINT.stakerShare}
                            />
                            <Separator className="my-1.5 bg-pred-edge/10" />
                            <Stat
                                label="Capacity used"
                                value={pool ? `${usd(pool.leveragedOI)} / ${usd(pool.maxOI)}` : "--"}
                                hint={HINT.capacity}
                            />
                            <div className="my-1 h-1.5 overflow-hidden rounded-full bg-pred-elevated">
                                <div className="h-full rounded-full bg-pred-green" style={{ width: `${util * 100}%` }} />
                            </div>
                            <Stat label="Free to unstake" value={pool ? usd(pool.freeCapital) : "--"} hint={HINT.free} />
                            {pool && pool.supplied > 0 && <Stat label="Earning in Margin" value={usd(pool.supplied)} />}
                            <Stat label="Protocol revenue" value={pool ? usd(pool.protocol) : "--"} />
                        </Card>

                        <Card title="Your position">
                            {!token ? (
                                <p className="py-2 text-[13px] text-pred-dimmer">Log in to stake and track your earnings.</p>
                            ) : (
                                <>
                                    <Stat label="Staked value" value={usd(myValue)} hint={HINT.value} />
                                    <Stat label="Shares" value={(myShares / UNIT).toFixed(2)} />
                                    {claim && (
                                        <>
                                            <Separator className="my-1.5 bg-pred-edge/10" />
                                            <Stat label="Unstaking" value={usd(Math.round(claim.shares * sharePrice))} />
                                            <div className="mt-1 flex items-center justify-between">
                                                <span className="text-[12px] text-pred-dim">
                                                    {claimMatured
                                                        ? "Ready to claim"
                                                        : `Ready in ${humanDuration(claimReadyAt - now)}`}
                                                </span>
                                                <Button
                                                    size="sm"
                                                    disabled={!claimMatured || busy}
                                                    onClick={() => run(() => poolClaim(token), "Claimed")}
                                                    className="h-auto rounded-md bg-pred-green px-3 py-1 text-[12px] font-semibold text-pred-ink hover:bg-pred-green/90 disabled:opacity-50"
                                                >
                                                    Claim
                                                </Button>
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </Card>
                    </div>

                    {/* right: stake / unstake */}
                    <Card title="" className="flex flex-col">
                        <div className="-mt-1 mb-3 flex border-b border-pred-edge/10">
                            {(["stake", "unstake"] as const).map(t => (
                                <button
                                    key={t}
                                    onClick={() => {
                                        setTab(t);
                                        setAmount("");
                                        setErr(null);
                                        setMsg(null);
                                    }}
                                    className={cn(
                                        "-mb-px flex-1 border-b-2 py-2 text-[13px] font-bold capitalize",
                                        tab === t
                                            ? "border-pred-white text-pred-text"
                                            : "border-transparent text-pred-dim hover:text-pred-text",
                                    )}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>

                        <div className="mb-1.5 flex items-baseline justify-between">
                            <span className="text-xs text-pred-dim">Amount</span>
                            <button
                                onClick={() => setAmount(String(((staking ? idle : myValue) / UNIT).toFixed(2)))}
                                className="text-[11px] text-pred-dim hover:text-pred-text"
                            >
                                {staking ? "Balance" : "Staked"}:{" "}
                                <span className="text-secondary-foreground">{usd(staking ? idle : myValue)}</span>
                            </button>
                        </div>
                        <div className="mb-3 flex h-[42px] items-center gap-2 rounded-md border border-pred-edge/15 bg-pred-input px-3">
                            <span className="text-[15px] font-semibold text-pred-dim">$</span>
                            <Input
                                value={amount}
                                onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                                inputMode="decimal"
                                placeholder="0.00"
                                className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-pred-text shadow-none focus-visible:ring-0"
                            />
                            <span className="text-xs font-semibold text-pred-dim">USDC</span>
                        </div>

                        <div className="mb-3 flex flex-col gap-1.5">
                            {staking ? (
                                <Stat label="You receive" value={amt > 0 ? `${sharesReceived.toFixed(2)} shares` : "--"} />
                            ) : (
                                <Stat label="Cooldown" value={pool ? humanDuration(pool.cooldownMs) : "--"} hint={HINT.cooldown} />
                            )}
                            <Stat label="Share price" value={`$${sharePrice.toFixed(4)}`} />
                        </div>

                        <div className="flex flex-1 flex-col justify-end">
                            <Button
                                disabled={!canAct}
                                onClick={() =>
                                    staking
                                        ? run(() => poolStake(token!, amt), `Staked ${usd(amt * UNIT)}`)
                                        : run(() => poolUnstake(token!, unstakeShares), "Unstake requested")
                                }
                                className="h-auto w-full rounded-lg bg-pred-green py-3 text-sm font-bold text-pred-ink hover:bg-pred-green/90 disabled:opacity-60"
                            >
                                {busy ? "Processing..." : actionLabel}
                            </Button>
                            {!staking && pool?.enabled && (
                                <p className="mt-2 text-center text-[11px] text-pred-dimmer">
                                    Unstaking is a request, not instant. After a {humanDuration(pool.cooldownMs)} cooldown,
                                    claim your USDC back to your balance.
                                </p>
                            )}
                            {err && <p className="mt-2 text-center text-[12px] text-pred-red">{err}</p>}
                            {msg && <p className="mt-2 text-center text-[12px] text-pred-green">{msg}</p>}
                        </div>
                    </Card>
                </div>
            </div>
        </section>
    );
}
