"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// plain-language explanations for the trading terms, keyed for reuse across panels
export const HINTS: Record<string, string> = {
    leverage:
        "Multiplies your exposure by borrowing from the pool. Higher leverage moves your liquidation level closer. A 1x bet borrows nothing and is never liquidated.",
    positionSize: "Your amount multiplied by leverage — the total size of the bet.",
    avgPrice: "Your average entry price per share, in cents. Each winning share pays out $1 at settlement.",
    shares: "The number of outcome shares you hold. Each pays $1 if your side wins, $0 if it loses.",
    payout: "What lands in your balance if your side wins, after repaying anything you borrowed.",
    return: "Your projected profit as a percentage of the amount you put in.",
    borrowRate: "Yearly interest charged on the borrowed part of a leveraged bet. A 1x bet borrows nothing, so it pays no interest.",
    liqPrice:
        "If the odds move to this level, a leveraged bet is automatically closed to repay the loan. Shown in cents (and the matching spot price). 1x bets never liquidate.",
    mark: "The current fair price per share from the oracle. Used to value your position and to decide liquidation — it can differ from your entry price.",
    value: "What your shares are worth right now (shares x mark price).",
    pnl: "Your unrealized profit or loss at the current mark, and the return on the amount you put in.",
    accountEquity: "Your cash plus the current value of every open position.",
    cash: "Idle USDC in your account, available to bet or withdraw.",
    positionsValue: "The combined current value of all your open positions.",
    openPnl: "Total unrealized profit or loss across your open positions right now.",
    entry: "The average price you opened the position at.",
    exit: "The price the position was closed at.",
    result: "How the position ended: you closed it, it was liquidated, deleveraged near expiry, or settled at the outcome.",
};

// a label with a dashed underline that reveals an explanation on hover (Binance-style)
export function Hint({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className={cn("cursor-help border-b border-dashed border-pred-edge/40", className)}>
                    {children}
                </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-[11px] leading-relaxed">{text}</TooltipContent>
        </Tooltip>
    );
}
