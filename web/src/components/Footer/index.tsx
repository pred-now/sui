"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useMarkets } from "@/components/MarketsProvider";

const DOCS_URL = "https://docs.pred.now";
const TWITTER_URL = "https://x.com/preddotnow";

// color the dot by connection quality
function dotClass(connected: boolean, ping: number | null) {
    if (!connected || ping == null) return "bg-pred-dimmer";
    if (ping <= 120) return "bg-pred-green";
    if (ping <= 350) return "bg-amber-400";
    return "bg-pred-red";
}

export default function Footer() {
    const { socket, connected } = useMarkets();
    const [ping, setPing] = useState<number | null>(null);

    // measure the live round trip to the server every second over the socket
    useEffect(() => {
        if (!socket) return;
        let alive = true;
        const measure = () => {
            const start = performance.now();
            socket.emit("ping:check", () => {
                if (alive) setPing(Math.round(performance.now() - start));
            });
        };
        measure();
        const t = setInterval(measure, 1000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [socket]);

    const live = connected && ping != null;

    return (
        <footer className="flex h-7 flex-none items-center border-t border-pred-edge/10 bg-pred-deep px-4 text-[11.5px] text-pred-dimmer">
            <span className="flex items-center gap-1.5" title="Live latency to the server">
                <span className={cn("size-1.5 rounded-full", dotClass(connected, ping))} />
                {live ? (
                    <span className="tabular-nums text-pred-dim">{ping} ms</span>
                ) : (
                    <span className="text-pred-dim">Offline</span>
                )}
            </span>

            <div className="ml-auto flex items-center gap-4">
                <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-pred-text"
                >
                    Docs
                </a>
                <a
                    href={TWITTER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-pred-text"
                >
                    Twitter
                </a>
            </div>
        </footer>
    );
}
