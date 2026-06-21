"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { getLeaderboard, type LeaderRow } from "@/lib/leaderboard";

const cols = ["Rank", "Wallet", "Earnings", "ROI"];

const usd = (n: number) =>
    `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

export default function Leaderboard() {
    const [rows, setRows] = useState<LeaderRow[] | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const r = await getLeaderboard();
                if (alive) setRows(r);
            } catch {
                if (alive) setRows([]);
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    return (
        <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex-none px-4 py-2.5">
                <div className="mx-auto max-w-4xl">
                    <h1 className="text-base font-semibold text-pred-white">Leaderboard</h1>
                    <p className="text-[11px] text-pred-dimmer">Top traders by ROI</p>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-4xl">
                    <Table>
                    <TableHeader>
                        <TableRow className="border-pred-edge/6 hover:bg-transparent">
                            {cols.map((c, i) => (
                                <TableHead
                                    key={c}
                                    className={cn(
                                        "h-auto px-4 py-2 text-[11px] font-normal text-pred-dimmer",
                                        i >= 2 ? "text-right" : "text-left",
                                    )}
                                >
                                    {c}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows == null ? (
                            <TableRow className="border-0 hover:bg-transparent">
                                <TableCell
                                    colSpan={cols.length}
                                    className="h-27.5 text-center text-[13px] text-pred-dimmer"
                                >
                                    Loading…
                                </TableCell>
                            </TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow className="border-0 hover:bg-transparent">
                                <TableCell
                                    colSpan={cols.length}
                                    className="h-27.5 text-center text-[13px] text-pred-dimmer"
                                >
                                    No traders yet
                                </TableCell>
                            </TableRow>
                        ) : (
                            rows.map((r, i) => (
                                <TableRow
                                    key={r.wallet + i}
                                    className="border-pred-edge/6 text-[12.5px] hover:bg-transparent"
                                >
                                    <TableCell className="px-4 py-2 text-pred-dim">{i + 1}</TableCell>
                                    <TableCell className="px-4 py-2 font-mono text-pred-text">
                                        {r.wallet}
                                    </TableCell>
                                    <TableCell
                                        className={cn(
                                            "px-4 py-2 text-right font-semibold",
                                            r.earnings >= 0 ? "text-pred-green" : "text-pred-red",
                                        )}
                                    >
                                        {usd(r.earnings)}
                                    </TableCell>
                                    <TableCell
                                        className={cn(
                                            "px-4 py-2 text-right font-semibold",
                                            r.roi >= 0 ? "text-pred-green" : "text-pred-red",
                                        )}
                                    >
                                        {r.roi >= 0 ? "+" : ""}
                                        {r.roi.toFixed(1)}%
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                    </Table>
                </div>
            </div>
        </section>
    );
}
