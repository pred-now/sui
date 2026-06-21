"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useTrading } from "@/components/Trade/TradingProvider";
import { useNow } from "@/hooks/use-now";
import { formatCountdown, formatExpiryShort } from "@/lib/markets";
import { friendlyError, type UiPosition, type HistItem, type Side } from "@/lib/bets";
import { Hint, HINTS } from "@/components/Trade/Hint";

const UNIT = 1_000_000;
const tabs = ["Positions", "Trade History"] as const;
type Tab = (typeof tabs)[number];

const cents = (p: number) => `${(p * 100).toFixed(1)}¢`;
const signedUsd = (base: number) =>
    `${base >= 0 ? "+" : "-"}$${(Math.abs(base) / UNIT).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const reasonLabel: Record<string, string> = {
    close: "Closed",
    liquidation: "Liquidated",
    cliff: "Deleveraged",
    settle: "Settled",
};

function Outcome({ side, leverage }: { side: Side; leverage: number }) {
    return (
        <span className="flex items-center gap-1.5">
            <span
                className={cn(
                    "font-semibold",
                    side === "yes" ? "text-pred-green" : "text-pred-red",
                )}
            >
                {side === "yes" ? "YES" : "NO"}
            </span>
            {leverage > 1.0001 && (
                <span className="rounded-[3px] bg-pred-elevated px-1 py-px text-[10px] font-semibold text-pred-dim">
                    {leverage.toFixed(0)}x
                </span>
            )}
        </span>
    );
}

function market(underlying: string, strike: number, expiry: number) {
    const u = underlying || "BTC";
    return `${u} ≥ $${strike.toLocaleString("en-US")} - ${formatExpiryShort(expiry)}`;
}

const posCols = ["Market", "Outcome", "Shares", "Avg", "Value", "Current", "PnL (ROI)", "Liq", "Expires", ""];
const histCols = ["Market", "Outcome", "Shares", "Entry", "Exit", "Result", "PnL", "Closed"];

// column headers that get a hover explanation
const colHint: Record<string, string> = {
    Shares: HINTS.shares,
    Avg: HINTS.avgPrice,
    Value: HINTS.value,
    Current: HINTS.mark,
    "PnL (ROI)": HINTS.pnl,
    Liq: HINTS.liqPrice,
    Entry: HINTS.entry,
    Exit: HINTS.exit,
    Result: HINTS.result,
    PnL: HINTS.pnl,
};

function PositionsTable({
    positions,
    onClose,
    closing,
}: {
    positions: UiPosition[];
    onClose: (p: UiPosition) => void;
    closing: string | null;
}) {
    const now = useNow();
    return (
        <Table>
            <TableHeader>
                <TableRow className="border-pred-edge/6 hover:bg-transparent">
                    {posCols.map((c, i) => (
                        <TableHead
                            key={c || i}
                            className={cn(
                                "h-auto px-4 py-2 text-[11px] font-normal text-pred-dimmer",
                                i >= 2 ? "text-right" : "text-left",
                            )}
                        >
                            {colHint[c] ? <Hint text={colHint[c]}>{c}</Hint> : c}
                        </TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {positions.length === 0 ? (
                    <TableRow className="border-0 hover:bg-transparent">
                        <TableCell
                            colSpan={posCols.length}
                            className="h-27.5 text-center text-[13px] text-pred-dimmer"
                        >
                            No open positions yet
                        </TableCell>
                    </TableRow>
                ) : (
                    positions.map(p => {
                        const key = `${p.oracleId}:${p.strike}:${p.side}`;
                        const roi = p.margin > 0 ? (p.pnl / p.margin) * 100 : 0;
                        const up = p.pnl >= 0;
                        return (
                            <TableRow
                                key={key}
                                className="border-pred-edge/6 text-[12.5px] hover:bg-transparent"
                            >
                                <TableCell className="px-4 py-2 text-pred-text">
                                    {market(p.underlying, p.strike, p.expiry)}
                                </TableCell>
                                <TableCell className="px-4 py-2">
                                    <Outcome side={p.side} leverage={p.leverage} />
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-text">
                                    {p.contracts.toFixed(2)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-dim">
                                    {cents(p.entryAsk)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-text">
                                    ${(p.value / UNIT).toFixed(2)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-text">
                                    {cents(p.mark)}
                                </TableCell>
                                <TableCell
                                    className={cn(
                                        "px-4 py-2 text-right font-semibold",
                                        up ? "text-pred-green" : "text-pred-red",
                                    )}
                                >
                                    {signedUsd(p.pnl)} ({roi >= 0 ? "+" : ""}
                                    {roi.toFixed(1)}%)
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-red">
                                    {p.liqYes == null ? "—" : cents(p.liqYes)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right tabular-nums text-pred-text">
                                    {formatCountdown(p.expiry - now)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={closing === key}
                                        onClick={() => onClose(p)}
                                        className="h-auto rounded-[5px] border-pred-edge/20 bg-pred-elevated px-2.5 py-1 text-[11px] font-semibold text-pred-text hover:border-pred-edge/40 hover:bg-pred-elevated"
                                    >
                                        {closing === key ? "Closing…" : "Close"}
                                    </Button>
                                </TableCell>
                            </TableRow>
                        );
                    })
                )}
            </TableBody>
        </Table>
    );
}

function HistoryTable({ history }: { history: HistItem[] }) {
    return (
        <Table>
            <TableHeader>
                <TableRow className="border-pred-edge/6 hover:bg-transparent">
                    {histCols.map((c, i) => (
                        <TableHead
                            key={c}
                            className={cn(
                                "h-auto px-4 py-2 text-[11px] font-normal text-pred-dimmer",
                                i >= 2 ? "text-right" : "text-left",
                            )}
                        >
                            {colHint[c] ? <Hint text={colHint[c]}>{c}</Hint> : c}
                        </TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {history.length === 0 ? (
                    <TableRow className="border-0 hover:bg-transparent">
                        <TableCell
                            colSpan={histCols.length}
                            className="h-27.5 text-center text-[13px] text-pred-dimmer"
                        >
                            No closed bets yet
                        </TableCell>
                    </TableRow>
                ) : (
                    history.map((h, i) => {
                        const up = h.pnl >= 0;
                        const when = new Date(h.closedAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                        });
                        return (
                            <TableRow
                                key={`${h.closedAt}:${i}`}
                                className="border-pred-edge/6 text-[12.5px] hover:bg-transparent"
                            >
                                <TableCell className="px-4 py-2 text-pred-text">
                                    {market("", h.strike, h.openedAt)}
                                </TableCell>
                                <TableCell className="px-4 py-2">
                                    <Outcome side={h.side} leverage={h.leverage} />
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-text">
                                    {h.contracts.toFixed(2)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-dim">
                                    {cents(h.entryAsk)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-dim">
                                    {cents(h.mark)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-text">
                                    {reasonLabel[h.reason] ?? h.reason}
                                </TableCell>
                                <TableCell
                                    className={cn(
                                        "px-4 py-2 text-right font-semibold",
                                        up ? "text-pred-green" : "text-pred-red",
                                    )}
                                >
                                    {signedUsd(h.pnl)}
                                </TableCell>
                                <TableCell className="px-4 py-2 text-right text-pred-dim">
                                    {when}
                                </TableCell>
                            </TableRow>
                        );
                    })
                )}
            </TableBody>
        </Table>
    );
}

export default function PositionsPanel() {
    const { positions, history, closeBet } = useTrading();
    const [tab, setTab] = useState<Tab>("Positions");
    const [closing, setClosing] = useState<string | null>(null);
    const [closeErr, setCloseErr] = useState<string | null>(null);

    const onClose = async (p: UiPosition) => {
        const key = `${p.oracleId}:${p.strike}:${p.side}`;
        setClosing(key);
        setCloseErr(null);
        const r = await closeBet({ oracleId: p.oracleId, strike: p.strike, side: p.side });
        setClosing(null);
        if (!r.ok) setCloseErr(friendlyError(r.error, "Couldn't close the position. Please try again."));
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex flex-none items-center border-b border-pred-edge/10 px-4">
                {tabs.map((t, i) => {
                    const on = t === tab;
                    const count = t === "Positions" ? positions.length : history.length;
                    return (
                        <Button
                            key={t}
                            variant="ghost"
                            onClick={() => setTab(t)}
                            className={cn(
                                "px-2 py-2.75 focus-visible:ring-0 hover:bg-transparent hover:text-pred-text h-auto rounded-none border-0 border-b-2",
                                on
                                    ? "border-pred-white text-[13px] font-semibold text-pred-text"
                                    : "border-transparent text-[13px] font-semibold text-pred-dim",
                                i === 0 && "pl-0",
                                i === tabs.length - 1 && "pr-0",
                            )}
                        >
                            {t}
                            {count > 0 && <span className="text-pred-dimmer">{count}</span>}
                        </Button>
                    );
                })}
                {closeErr && (
                    <span className="ml-auto truncate text-[12px] text-pred-red" title={closeErr}>
                        {closeErr}
                    </span>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "Positions" ? (
                    <PositionsTable positions={positions} onClose={onClose} closing={closing} />
                ) : (
                    <HistoryTable history={history} />
                )}
            </div>
        </div>
    );
}
