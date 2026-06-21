"use client";

import Image from "next/image";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMarkets } from "@/components/MarketsProvider";
import { useNow } from "@/hooks/use-now";
import {
    formatCountdown,
    formatExpiryShort,
    formatUsd,
    strikeText,
    toCents,
} from "@/lib/markets";

export default function MarketHeader() {
    const { markets, selected, setSelected, connected, details, strike, yesPrice } =
        useMarkets();
    const now = useNow();

    const question = selected
        ? `Will ${selected.underlying} close ${strikeText(strike ?? 0)} on ${formatExpiryShort(selected.expiry)}?`
        : "No market selected";
    const resolution = selected ? formatCountdown(selected.expiry - now) : "--.--";

    const yesC = yesPrice == null ? "--" : toCents(yesPrice);
    const noC = yesPrice == null ? "--" : toCents(1 - yesPrice);
    const spot = details?.price ? formatUsd(details.price.spot) : "--";

    // volume/liquidity/OI are placeholders until the engine reports them
    const stats = [
        { label: "Yes Price", value: yesC, className: "text-sm font-semibold text-pred-green" },
        { label: "No Price", value: noC, className: "text-sm font-semibold text-pred-red" },
        { label: "Spot", value: spot, className: "text-sm font-semibold text-pred-text" },
        { label: "24h Volume", value: "$4,182,540", className: "text-sm font-semibold text-pred-text" },
        { label: "Liquidity", value: "$1,284,900", className: "text-sm font-semibold text-pred-text" },
        { label: "Open Interest", value: "$9,420,118", className: "text-sm font-semibold text-pred-text" },
    ];

    return (
        <div className="flex flex-none items-center border-b border-pred-edge/10 px-4 py-2.5">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button className="group flex cursor-pointer items-center gap-3 pr-5.5 text-left outline-none">
                        <Image
                            src="/btc.svg"
                            alt="BTC"
                            width={32}
                            height={32}
                            className="shrink-0"
                        />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-base font-semibold whitespace-nowrap text-pred-text">
                                    {question}
                                </span>
                                <ChevronDown className="size-[13px] shrink-0 text-pred-dim transition-transform group-data-[state=open]:rotate-180" />
                            </div>
                        </div>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    className="max-h-[60vh] w-[340px] border border-pred-edge/15"
                >
                    <DropdownMenuLabel className="text-pred-dimmer">
                        Markets
                    </DropdownMenuLabel>
                    {markets.length === 0 && (
                        <div className="px-2 py-6 text-center text-[12.5px] text-pred-dimmer">
                            {connected
                                ? "No markets available"
                                : "Connecting to markets..."}
                        </div>
                    )}
                    {markets.map((m) => {
                        const active = selected?.oracleId === m.oracleId;
                        return (
                            <DropdownMenuItem
                                key={m.oracleId}
                                onSelect={() => setSelected(m)}
                                className={cn(
                                    "cursor-pointer gap-2.5 px-2 py-2",
                                    active && "bg-pred-active",
                                )}
                            >
                                <Image
                                    src="/btc.svg"
                                    alt=""
                                    width={26}
                                    height={26}
                                    className="size-[26px] shrink-0"
                                />
                                <div className="min-w-0">
                                    <div className="text-[13px] font-semibold text-pred-text">
                                        BTC
                                    </div>
                                    <div className="text-[11px] text-pred-dimmer">
                                        expires {formatExpiryShort(m.expiry)}
                                    </div>
                                </div>
                                <span className="ml-auto text-[13px] font-semibold tabular-nums text-pred-text">
                                    {formatCountdown(m.expiry - now)}
                                </span>
                                {active && (
                                    <Check className="size-3.5 shrink-0 text-pred-white" />
                                )}
                            </DropdownMenuItem>
                        );
                    })}
                </DropdownMenuContent>
            </DropdownMenu>

            <Separator orientation="vertical" className="h-10 bg-pred-edge/10" />

            <div className="flex items-center gap-7.5 overflow-hidden pl-5.5">
                {stats.map((stat) => (
                    <div key={stat.label}>
                        <div className="mb-[3px] text-[11px] text-pred-dimmer">
                            {stat.label}
                        </div>
                        <div className={stat.className}>{stat.value}</div>
                    </div>
                ))}
                <div>
                    <div className="mb-[3px] text-[11px] text-pred-dimmer">
                        Resolution
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-pred-text">
                        {resolution}
                    </div>
                </div>
            </div>
        </div>
    );
}
