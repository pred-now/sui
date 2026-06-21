"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/components/AuthProvider";
import { getTransactions, type Tx } from "@/lib/account";

function timeAgo(ms: number): string {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export default function TransactionsModal({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const { token } = useAuth();
    const [txs, setTxs] = useState<Tx[] | null>(null);

    useEffect(() => {
        if (!open || !token) return;
        let alive = true;
        (async () => {
            setTxs(null);
            try {
                const t = await getTransactions(token);
                if (alive) setTxs(t);
            } catch {
                if (alive) setTxs([]);
            }
        })();
        return () => {
            alive = false;
        };
    }, [open, token]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Transactions</DialogTitle>
                    <DialogDescription>Your deposits and withdrawals.</DialogDescription>
                </DialogHeader>

                <div className="flex max-h-[55vh] flex-col gap-0.5 overflow-y-auto">
                    {txs == null ? (
                        <p className="py-6 text-center text-[12.5px] text-pred-dimmer">Loading…</p>
                    ) : txs.length === 0 ? (
                        <p className="py-6 text-center text-[12.5px] text-pred-dimmer">
                            No transactions yet.
                        </p>
                    ) : (
                        txs.map((t, i) => <Row key={i} tx={t} />)
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Row({ tx }: { tx: Tx }) {
    const deposit = tx.type === "deposit";
    const usd = (tx.usd / 1e6).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return (
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-pred-input">
            <div
                className={cn(
                    "flex size-8 flex-none items-center justify-center rounded-full",
                    deposit ? "bg-pred-green/10 text-pred-green" : "bg-pred-red/10 text-pred-red",
                )}
            >
                {deposit ? (
                    <ArrowDownLeft className="size-4" />
                ) : (
                    <ArrowUpRight className="size-4" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-pred-text">
                    {deposit ? "Deposit" : "Withdraw"} {tx.asset}
                </div>
                <div className="text-[11px] text-pred-dimmer">{timeAgo(tx.at)}</div>
            </div>
            <div
                className={cn(
                    "text-[13px] font-semibold tabular-nums",
                    deposit ? "text-pred-green" : "text-pred-text",
                )}
            >
                {deposit ? "+" : "-"}${usd}
            </div>
            {!deposit && tx.ref && (
                <a
                    href={`https://suiscan.xyz/testnet/tx/${tx.ref}`}
                    target="_blank"
                    rel="noopener"
                    className="flex-none text-pred-dim hover:text-pred-text"
                >
                    <ExternalLink className="size-3.5" />
                </a>
            )}
        </div>
    );
}
