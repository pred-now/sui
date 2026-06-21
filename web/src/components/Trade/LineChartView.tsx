"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { useMarkets } from "@/components/MarketsProvider";
import { useTrading } from "@/components/Trade/TradingProvider";
import {
    fetchSurface,
    yesProbability,
    TIMEFRAMES,
    type SurfacePoint,
    type Timeframe,
} from "@/lib/odds";

const RED = "#f0616d";
const GREEN = "#3fd68b";
const WHITE = "#ffffff";

interface Mark {
    t: number;
    y: number;
    side: "yes" | "no";
}

const REBASE_MS = 30_000; // re-pull history occasionally, socket drives the tail
const MAX_TAIL = 1200;
const YES_COLOR = "#3fd68b";

function timeLabel(tf: Timeframe, t: number): string {
    const d = new Date(t);
    if (tf.lookbackMs <= 900_000)
        return d.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
    if (tf.lookbackMs <= 86_400_000)
        return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface TipPoint {
    t: number;
    yes: number;
    spot: number;
}

// chart hover card, styled like the app surfaces
function ChartTooltip({
    tf,
    active,
    payload,
}: {
    tf: Timeframe;
    active?: boolean;
    payload?: { payload: TipPoint }[];
}) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="rounded-lg border border-pred-edge/15 bg-pred-elevated/95 px-3 py-2 shadow-lg backdrop-blur-sm">
            <div className="mb-1.5 text-[11px] font-medium tabular-nums text-pred-dimmer">
                {timeLabel(tf, d.t)}
            </div>
            <div className="flex flex-col gap-1 text-[12px]">
                <div className="flex items-center justify-between gap-6">
                    <span className="flex items-center gap-1.5 text-pred-dim">
                        <span className="inline-block w-2.5 border-t border-dashed border-pred-dim" />
                        Spot
                    </span>
                    <span className="font-semibold tabular-nums text-pred-text">
                        ${Math.round(d.spot).toLocaleString()}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-6">
                    <span className="flex items-center gap-1.5 text-pred-dim">
                        <span className="inline-block h-[2px] w-2.5 rounded-full bg-pred-green" />
                        YES
                    </span>
                    <span className="font-semibold tabular-nums text-pred-green">
                        {d.yes.toFixed(1)}%
                    </span>
                </div>
            </div>
        </div>
    );
}

export default function LineChartView({ timeframe }: { timeframe: string }) {
    const { selected, strike, details } = useMarkets();
    const { positions, history } = useTrading();
    const [surface, setSurface] = useState<SurfacePoint[]>([]);
    const [tail, setTail] = useState<SurfacePoint[]>([]);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const tf =
        TIMEFRAMES.find((x) => x.label === timeframe) ??
        TIMEFRAMES.find((x) => x.label === "1D")!;

    // fetch history for the timeframe's range, drop the tail it covers
    useEffect(() => {
        if (!selected) return;
        let alive = true;
        const load = async () => {
            try {
                const s = await fetchSurface(selected.oracleId, tf.range);
                if (!alive) return;
                setSurface(s);
                const lastT = s.length ? s[s.length - 1].t : 0;
                setTail((prev) => prev.filter((p) => p.t > lastT));
            } catch {
                // ignore transient fetch errors
            }
        };
        load();
        const timer = setInterval(load, REBASE_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [selected, tf.range]);

    // reset the tail when the market changes
    useEffect(() => {
        setTail([]);
    }, [selected?.oracleId]);

    // live points pushed over the socket on every oracle write
    useEffect(() => {
        if (!selected || !details || details.oracleId !== selected.oracleId) return;
        if (!details.price || !details.svi) return;
        const p = details.price;
        const v = details.svi;
        const pt: SurfacePoint = {
            t: p.timestampMs,
            forward: p.forward,
            a: v.a,
            b: v.b,
            rho: v.rho,
            m: v.m,
            sigma: v.sigma,
        };
        setTail((prev) => {
            if (prev.length && prev[prev.length - 1].t >= pt.t) return prev;
            const next = [...prev, pt];
            return next.length > MAX_TAIL ? next.slice(-MAX_TAIL) : next;
        });
    }, [selected, details]);

    // reprice the strike, windowed to the timeframe. instant on strike change
    const data = useMemo(() => {
        if (strike == null) return [];
        const lastT = surface.length ? surface[surface.length - 1].t : -Infinity;
        const merged = [...surface, ...tail.filter((p) => p.t > lastT)];
        if (!merged.length) return [];
        const maxT = merged[merged.length - 1].t;
        const cutoff = tf.lookbackMs === Infinity ? -Infinity : maxT - tf.lookbackMs;
        const out: { t: number; yes: number; spot: number }[] = [];
        for (const s of merged) {
            if (s.t < cutoff) continue;
            const prob = yesProbability(s.forward, strike, s);
            if (prob != null) out.push({ t: s.t, yes: Math.round(prob * 1000) / 10, spot: s.forward });
        }
        return out;
    }, [surface, tail, strike, tf.lookbackMs]);

    // my open/close markers and liq lines for this exact market + strike, mapped onto the chart
    const markers = useMemo(() => {
        const empty = { opens: [] as Mark[], closes: [] as Mark[], liqs: [] as number[] };
        if (!selected || strike == null || data.length === 0) return empty;
        const minT = data[0].t;
        const maxT = data[data.length - 1].t;
        const within = (t: number) => t >= minT && t <= maxT;
        const yesPct = (side: "yes" | "no", mark: number) => (side === "yes" ? mark : 1 - mark) * 100;
        // pin to the market, not the live strike, so markers persist as the strike changes
        const here = (o: string) => o === selected.oracleId;
        return {
            opens: positions
                .filter((p) => here(p.oracleId) && within(p.openedAt))
                .map((p) => ({ t: p.openedAt, y: yesPct(p.side, p.entryAsk), side: p.side })),
            closes: history
                .filter((h) => here(h.oracleId) && within(h.closedAt))
                .map((h) => ({ t: h.closedAt, y: yesPct(h.side, h.mark), side: h.side })),
            liqs: positions
                .filter((p) => here(p.oracleId) && p.liqYes != null)
                .map((p) => (p.liqYes as number) * 100),
        };
    }, [positions, history, selected, strike, data]);

    if (!mounted) return null;

    if (data.length === 0) {
        return (
            <div className="grid size-full place-items-center text-xs text-pred-dimmer">
                waiting for odds history…
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart
                data={data}
                margin={{ top: 16, right: 8, bottom: 22, left: 8 }}
                accessibilityLayer={false}
            >
                <CartesianGrid vertical={false} stroke="var(--pred-edge)" strokeOpacity={0.07} />
                <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    scale="time"
                    tickFormatter={(t) => timeLabel(tf, t)}
                    tick={{ fill: "var(--pred-dimmer)", fontSize: 10.5 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={48}
                />
                <YAxis
                    yAxisId="yes"
                    orientation="right"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: "var(--pred-dimmer)", fontSize: 10.5 }}
                    tickLine={false}
                    axisLine={false}
                    width={42}
                />
                <YAxis
                    yAxisId="spot"
                    orientation="left"
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                    tick={{ fill: "var(--pred-dim)", fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                />
                <Tooltip
                    cursor={{ stroke: "var(--pred-edge)", strokeWidth: 1, strokeDasharray: "3 3", strokeOpacity: 0.6 }}
                    content={<ChartTooltip tf={tf} />}
                />
                <Line
                    yAxisId="spot"
                    type="monotone"
                    dataKey="spot"
                    stroke="var(--pred-dim)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--pred-dim)", stroke: "var(--pred-panel)", strokeWidth: 2 }}
                    isAnimationActive={false}
                />
                <Line
                    yAxisId="yes"
                    type="monotone"
                    dataKey="yes"
                    stroke={YES_COLOR}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3.5, fill: YES_COLOR, stroke: "var(--pred-panel)", strokeWidth: 2 }}
                    isAnimationActive={false}
                />
                {markers.liqs.map((y, i) => (
                    <ReferenceLine
                        key={`liq${i}`}
                        yAxisId="yes"
                        y={y}
                        stroke={RED}
                        strokeDasharray="4 3"
                        strokeWidth={1}
                        ifOverflow="extendDomain"
                        label={{ value: `Liq ${y.toFixed(0)}%`, fill: RED, fontSize: 10, position: "insideBottomRight" }}
                    />
                ))}
                {markers.opens.flatMap((m, i) => [
                    <ReferenceLine
                        key={`openY${i}`}
                        yAxisId="yes"
                        y={m.y}
                        stroke={WHITE}
                        strokeDasharray="4 3"
                        strokeWidth={1}
                        ifOverflow="extendDomain"
                        label={{ value: `${m.side === "yes" ? "YES" : "NO"} ${m.y.toFixed(0)}%`, fill: WHITE, fontSize: 10, position: "insideTopRight" }}
                    />,
                    <ReferenceLine
                        key={`openX${i}`}
                        yAxisId="yes"
                        x={m.t}
                        stroke={WHITE}
                        strokeDasharray="4 3"
                        strokeWidth={1}
                        ifOverflow="extendDomain"
                        label={{ value: timeLabel(tf, m.t), fill: WHITE, fontSize: 10, position: "top" }}
                    />,
                ])}
                {markers.closes.map((m, i) => {
                    const c = m.side === "yes" ? GREEN : RED;
                    const text = `Close ${m.side === "yes" ? "YES" : "NO"} ${m.y.toFixed(0)}%`;
                    // vertical time line only, label below the x-axis ticks
                    return (
                        <ReferenceLine
                            key={`close${i}`}
                            yAxisId="yes"
                            x={m.t}
                            stroke={c}
                            strokeDasharray="2 3"
                            strokeWidth={1}
                            label={({ viewBox }: { viewBox: { x: number; y: number; height: number } }) => (
                                <text
                                    x={viewBox.x}
                                    y={viewBox.y + viewBox.height + 30}
                                    fill={c}
                                    fontSize={10}
                                    textAnchor="middle"
                                >
                                    {text}
                                </text>
                            )}
                        />
                    );
                })}
            </LineChart>
        </ResponsiveContainer>
    );
}
