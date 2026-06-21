"use client";

import { useEffect, useRef, useState } from "react";
import {
    createChart,
    CandlestickSeries,
    ColorType,
    CrosshairMode,
    type IChartApi,
    type CandlestickData,
    type UTCTimestamp,
} from "lightweight-charts";

import { useMarkets } from "@/components/MarketsProvider";
import { fetchCandles, type Candle } from "@/lib/candles";

const REFRESH_MS = 10_000;

// our spot OHLC rendered in TradingView's lightweight-charts
export default function TradingViewChart() {
    const ref = useRef<HTMLDivElement>(null);
    const { selected } = useMarkets();
    const [phase, setPhase] = useState<"loading" | "empty" | "ready">("loading");

    useEffect(() => {
        const el = ref.current;
        if (!el || !selected) return;

        const chart: IChartApi = createChart(el, {
            layout: {
                background: { type: ColorType.Solid, color: "#04201c" },
                textColor: "#7fc8b9",
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: "rgba(127, 200, 185, 0.07)" },
                horzLines: { color: "rgba(127, 200, 185, 0.07)" },
            },
            crosshair: { mode: CrosshairMode.Normal },
            timeScale: { timeVisible: true, borderColor: "rgba(127, 200, 185, 0.15)" },
            rightPriceScale: { borderColor: "rgba(127, 200, 185, 0.15)" },
            autoSize: true,
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#3fd68b",
            downColor: "#e5484d",
            wickUpColor: "#3fd68b",
            wickDownColor: "#e5484d",
            borderVisible: false,
        });

        let alive = true;
        const load = async () => {
            try {
                const candles = await fetchCandles(selected.oracleId, "spot", "YES", "1m");
                if (!alive) return;
                series.setData(candles.map(toBar));
                if (candles.length) chart.timeScale().fitContent();
                setPhase(candles.length ? "ready" : "empty");
            } catch {
                // ignore transient fetch errors
            }
        };
        load();
        const timer = setInterval(load, REFRESH_MS);

        return () => {
            alive = false;
            clearInterval(timer);
            chart.remove();
        };
    }, [selected]);

    return (
        <div className="relative size-full">
            <div ref={ref} className="size-full" />
            {phase !== "ready" && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-pred-dimmer">
                    {phase === "loading" ? "Loading..." : "No price data for this market yet"}
                </div>
            )}
            <div className="pointer-events-none absolute top-2.5 left-3.5 text-[11px] font-semibold tracking-wide text-pred-dim/40">
                {selected?.underlying ?? "BTC"} spot · 1m
            </div>
        </div>
    );
}

// ms candle -> lightweight-charts bar (seconds)
function toBar(c: Candle): CandlestickData {
    return {
        time: (c.time / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
    };
}
