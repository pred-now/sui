"use client";

import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";

import { useAuth } from "@/components/AuthProvider";
import { type Market, type MarketDetails, type Snapshot } from "@/lib/markets";
import { fiftyStrike, yesProbability } from "@/lib/odds";
import { nearExpiry } from "@/lib/bets";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

interface MarketsContextValue {
    markets: Market[];
    selected: Market | null;
    setSelected: (m: Market) => void;
    connected: boolean;
    details: MarketDetails | null; // details for the selected market
    strike: number | null; // user-chosen strike in USD
    setStrike: (n: number) => void;
    yesPrice: number | null; // YES probability 0..1 at the chosen strike
    socket: Socket | null; // authed when logged in, for trading + user events
}

const MarketsContext = createContext<MarketsContextValue | null>(null);

export function useMarkets(): MarketsContextValue {
    const ctx = useContext(MarketsContext);
    if (!ctx) throw new Error("useMarkets must be used within MarketsProvider");
    return ctx;
}

// flatten grouped snapshot, earliest expiry first
function flatten(snap: Snapshot): Market[] {
    return Object.values(snap)
        .flat()
        .sort((a, b) => a.expiry - b.expiry);
}

export default function MarketsProvider({ children }: { children: ReactNode }) {
    const { token } = useAuth();
    const [markets, setMarkets] = useState<Market[]>([]);
    const [connected, setConnected] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detailsMap, setDetailsMap] = useState<Record<string, MarketDetails>>(
        {},
    );
    const [socket, setSocket] = useState<Socket | null>(null);
    const requested = useRef<Set<string>>(new Set());

    // one socket, re-created when the session token changes so user-room events arrive
    useEffect(() => {
        const s: Socket = io(SOCKET_URL, {
            transports: ["websocket"],
            auth: token ? { token } : {},
        });
        setSocket(s);

        s.on("connect", () => setConnected(true));
        s.on("disconnect", () => setConnected(false));

        s.on("markets:snapshot", (snap: Snapshot) => {
            setMarkets(flatten(snap));
        });
        s.on("market:details", (d: MarketDetails) => {
            setDetailsMap((prev) => ({ ...prev, [d.oracleId]: d }));
        });
        s.on("market:new", (m: Market) => {
            setMarkets((prev) =>
                [...prev.filter((x) => x.oracleId !== m.oracleId), m].sort(
                    (a, b) => a.expiry - b.expiry,
                ),
            );
        });
        s.on("market:settled", (m: Market) => {
            setMarkets((prev) => prev.filter((x) => x.oracleId !== m.oracleId));
        });

        return () => {
            s.disconnect();
            setSocket(null);
        };
    }, [token]);

    // fetch details for the selected market if not seen yet
    useEffect(() => {
        if (!socket || !selectedId) return;
        if (detailsMap[selectedId] || requested.current.has(selectedId)) return;
        requested.current.add(selectedId);
        socket.emit(
            "market:details:get",
            selectedId,
            (d: MarketDetails | null) => {
                if (d) setDetailsMap((prev) => ({ ...prev, [d.oracleId]: d }));
            },
        );
    }, [selectedId, detailsMap, socket]);

    // default to earliest active, keep if still present
    useEffect(() => {
        if (markets.length === 0) {
            setSelectedId(null);
            return;
        }
        setSelectedId((prev) => {
            if (prev && markets.some((m) => m.oracleId === prev)) return prev;
            // prefer the soonest active market that still has leverage runway (outside the cliff window);
            // a near-expiry default would force-close any leveraged bet at once
            const now = Date.now();
            const tradeable = markets.find(
                (m) => m.status === "active" && !nearExpiry(m.expiry, now),
            );
            const active = markets.find((m) => m.status === "active");
            return (tradeable ?? active ?? markets[0]).oracleId;
        });
    }, [markets]);

    const selected = markets.find((m) => m.oracleId === selectedId) ?? null;
    const setSelected = (m: Market) => setSelectedId(m.oracleId);

    const details = selectedId ? (detailsMap[selectedId] ?? null) : null;

    // user-chosen strike, defaults to the 50% strike per market
    const [strike, setStrikeState] = useState<number | null>(null);
    const strikeOracle = useRef<string | null>(null);
    useEffect(() => {
        // reset on market change so the default recomputes
        setStrikeState(null);
        strikeOracle.current = null;
    }, [selectedId]);
    useEffect(() => {
        if (!selectedId || !details || details.oracleId !== selectedId) return;
        if (strikeOracle.current === selectedId) return;
        if (details.price && details.svi) {
            strikeOracle.current = selectedId;
            setStrikeState(Math.round(fiftyStrike(details.price.forward, details.svi)));
        }
    }, [selectedId, details]);
    const setStrike = (n: number) => setStrikeState(n);

    let yesPrice: number | null = null;
    if (strike != null && details && details.price && details.svi) {
        yesPrice = yesProbability(details.price.forward, strike, details.svi);
    }

    return (
        <MarketsContext.Provider
            value={{
                markets,
                selected,
                setSelected,
                connected,
                details,
                strike,
                setStrike,
                yesPrice,
                socket,
            }}
        >
            {children}
        </MarketsContext.Provider>
    );
}
