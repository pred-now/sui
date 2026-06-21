"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { CandlestickChart, ChartLine, Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMarkets } from "@/components/MarketsProvider";
import { TIMEFRAMES } from "@/lib/odds";
import LineChartView from "@/components/Trade/LineChartView";
import TradingViewChart from "@/components/Trade/TradingViewChart";

const chartTypes = [
    { value: "line", label: "Line", icon: ChartLine },
    { value: "tradingview", label: "TradingView", icon: CandlestickChart },
] as const;

type ChartType = (typeof chartTypes)[number]["value"];

export default function PriceChart() {
    const [timeframe, setTimeframe] = useState("15m");
    const [chartType, setChartType] = useState<ChartType>("line");
    const isLine = chartType === "line";

    const { strike } = useMarkets();

    // fullscreen the chart area
    const chartRef = useRef<HTMLDivElement>(null);
    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else chartRef.current?.requestFullscreen();
    };

    return (
        <>
            {/* toolbar */}
            <div className="flex flex-none items-center gap-3.5 border-b border-pred-edge/10 px-4 py-2">
                {/* chart type */}
                <div className="flex items-center gap-0.5">
                    {chartTypes.map(({ value, label, icon: Icon }) => {
                        const on = value === chartType;
                        return (
                            <Button
                                key={value}
                                variant="ghost"
                                size="sm"
                                onClick={() => setChartType(value)}
                                className={
                                    on
                                        ? "h-auto gap-1.5 rounded-[5px] bg-pred-active px-2.5 py-1 text-xs font-semibold text-pred-text hover:bg-pred-active hover:text-pred-text"
                                        : "h-auto gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-semibold text-pred-dim hover:bg-transparent hover:text-pred-text"
                                }
                            >
                                <Icon className="size-3.5" />
                                {label}
                            </Button>
                        );
                    })}
                </div>

                {isLine && (
                    <>
                        <span className="h-4 w-px bg-pred-edge/15" />

                        <div className="flex items-center gap-0.5">
                            {TIMEFRAMES.map((t) => {
                                const on = t.label === timeframe;
                                return (
                                    <Button
                                        key={t.label}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setTimeframe(t.label)}
                                        className={
                                            on
                                                ? "h-auto rounded-[5px] bg-pred-active px-2 py-1 text-xs font-semibold text-pred-text hover:bg-pred-active hover:text-pred-text"
                                                : "h-auto rounded-[5px] px-2 py-1 text-xs font-semibold text-pred-dim hover:bg-transparent hover:text-pred-text"
                                        }
                                    >
                                        {t.label}
                                    </Button>
                                );
                            })}
                        </div>

                        <div className="ml-auto flex items-center gap-2.5 text-pred-dimmer">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={toggleFullscreen}
                                className="size-7 text-pred-dim hover:bg-transparent hover:text-pred-text"
                            >
                                <Maximize2 className="size-3.75" />
                            </Button>
                        </div>
                    </>
                )}
            </div>

            {/* chart */}
            <div ref={chartRef} className="relative min-h-0 flex-1 bg-pred-panel">
                {isLine ? (
                    <>
                        <Image
                            src="/text-logo.svg"
                            alt="Pred"
                            height={100}
                            width={100}
                            className="pointer-events-none absolute top-1/2 left-1/2 w-240 -translate-x-1/2 -translate-y-1/2 opacity-4 select-none"
                        />
                        <div className="absolute inset-0">
                            <LineChartView timeframe={timeframe} />
                        </div>
                    </>
                ) : (
                    <TradingViewChart />
                )}
            </div>
        </>
    );
}
