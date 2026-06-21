"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

import { useAuth } from "@/components/AuthProvider";
import { useMarkets } from "@/components/MarketsProvider";
import { getAccount, getPositions, getHistory } from "@/lib/account";
import { recompute, type Quote, type Side, type UiPosition, type HistItem } from "@/lib/bets";

interface Account {
    balance: number; // base units
    available: number;
}

interface PlaceArgs {
    side: Side;
    amount: number; // display USD margin
    leverage: number;
}

interface TradingContextValue {
    account: Account | null;
    positions: UiPosition[]; // marked live for the selected market
    history: HistItem[];
    quote: Quote | null; // for the selected market/strike/side
    activeSide: Side;
    setActiveSide: (s: Side) => void;
    placeBet: (a: PlaceArgs) => Promise<{ ok: boolean; error?: string }>;
    closeBet: (p: { oracleId: string; strike: number; side: Side }) => Promise<{ ok: boolean; error?: string }>;
    busy: boolean;
    refresh: () => void;
}

const Ctx = createContext<TradingContextValue | null>(null);

export function useTrading(): TradingContextValue {
    const v = useContext(Ctx);
    if (!v) throw new Error("useTrading must be used within TradingProvider");
    return v;
}

const uuid = () =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);

export default function TradingProvider({ children }: { children: ReactNode }) {
    const { token } = useAuth();
    const { socket, selected, strike, details } = useMarkets();

    const [account, setAccount] = useState<Account | null>(null);
    const [rawPositions, setRawPositions] = useState<UiPosition[]>([]);
    const [history, setHistory] = useState<HistItem[]>([]);
    const [quote, setQuote] = useState<Quote | null>(null);
    const [activeSide, setActiveSide] = useState<Side>("yes");
    const [busy, setBusy] = useState(false);

    const oracleId = selected?.oracleId ?? null;

    // pull the authoritative snapshot from REST
    const refresh = useCallback(() => {
        if (!token) return;
        getAccount(token).then((a) => setAccount({ balance: a.balance, available: a.available })).catch(() => {});
        getPositions(token).then((r) => {
            setAccount({ balance: r.balance, available: r.available });
            setRawPositions(r.positions);
        }).catch(() => {});
        getHistory(token).then(setHistory).catch(() => {});
    }, [token]);

    // seed on login; logged-out values are gated at the context boundary below
    useEffect(() => {
        if (token) refresh();
    }, [token, refresh]);

    // keep account/positions/history live off user-room events
    useEffect(() => {
        if (!socket || !token) return;
        const onAccount = (a: Account) => setAccount(a);
        const onChange = () => refresh();
        socket.on("account:update", onAccount);
        socket.on("fill", onChange);
        socket.on("bet:open", onChange);
        socket.on("bet:closed", onChange);
        socket.on("settlement", onChange);
        return () => {
            socket.off("account:update", onAccount);
            socket.off("fill", onChange);
            socket.off("bet:open", onChange);
            socket.off("bet:closed", onChange);
            socket.off("settlement", onChange);
        };
    }, [socket, token, refresh]);

    // live quote for the selected market/strike/side: one-shot for the leverage knobs, then stream odds
    useEffect(() => {
        if (!socket || !oracleId || strike == null) return;
        let alive = true;
        socket.emit("bet:subscribe", { oracleId, strike });
        socket.emit("bet:quote", { oracleId, strike, side: activeSide }, (q: Quote & { error?: string }) => {
            if (alive && q && !q.error) setQuote(q);
        });
        const onUpdate = (q: Quote) => {
            if (q.oracleId !== oracleId || q.strike !== strike) return;
            // keep the leverage knobs from the one-shot, refresh the live odds
            setQuote((prev) => (prev ? { ...prev, ...q, maxLeverage: prev.maxLeverage, borrowRate: prev.borrowRate } : q));
        };
        socket.on("quote:update", onUpdate);
        return () => {
            alive = false;
            socket.emit("bet:unsubscribe", { oracleId, strike });
            socket.off("quote:update", onUpdate);
        };
    }, [socket, oracleId, strike, activeSide]);

    // re-fetch the side-specific borrow rate when the book shifts under us
    const lastOpen = useRef(0);
    useEffect(() => {
        if (!socket) return;
        const onOpen = () => {
            lastOpen.current = Date.now();
            if (oracleId && strike != null)
                socket.emit("bet:quote", { oracleId, strike, side: activeSide }, (q: Quote & { error?: string }) => {
                    if (q && !q.error) setQuote((prev) => (prev ? { ...prev, maxLeverage: q.maxLeverage, borrowRate: q.borrowRate } : q));
                });
        };
        socket.on("bet:open", onOpen);
        return () => {
            socket.off("bet:open", onOpen);
        };
    }, [socket, oracleId, strike, activeSide]);

    // mark the selected market's positions against the live surface
    const positions = useMemo(
        () => rawPositions.map((p) => (selected && p.oracleId === selected.oracleId ? recompute(p, details) : p)),
        [rawPositions, selected, details],
    );

    const placeBet = useCallback(
        async ({ side, amount, leverage }: PlaceArgs): Promise<{ ok: boolean; error?: string }> => {
            if (!socket || !token) return { ok: false, error: "not connected" };
            if (!oracleId || strike == null) return { ok: false, error: "no market" };
            setBusy(true);
            try {
                const res = await new Promise<any>((resolve) =>
                    socket.emit("bet:place", { oracleId, strike, side, amount, leverage, id: uuid() }, resolve),
                );
                if (res?.error) return { ok: false, error: res.error };
                refresh();
                return { ok: true };
            } finally {
                setBusy(false);
            }
        },
        [socket, token, oracleId, strike, refresh],
    );

    const closeBet = useCallback(
        async (p: { oracleId: string; strike: number; side: Side }): Promise<{ ok: boolean; error?: string }> => {
            if (!socket || !token) return { ok: false, error: "not connected" };
            setBusy(true);
            try {
                const res = await new Promise<any>((resolve) =>
                    socket.emit("bet:close", { ...p, id: uuid() }, resolve),
                );
                if (res?.error) return { ok: false, error: res.error };
                refresh();
                return { ok: true };
            } finally {
                setBusy(false);
            }
        },
        [socket, token, refresh],
    );

    // gate logged-out / no-market state here rather than clearing via effects
    const sameMarket = quote && oracleId && quote.oracleId === oracleId && quote.strike === strike;
    return (
        <Ctx.Provider
            value={{
                account: token ? account : null,
                positions: token ? positions : [],
                history: token ? history : [],
                quote: sameMarket ? quote : null,
                activeSide,
                setActiveSide,
                placeBet,
                closeBet,
                busy,
                refresh,
            }}
        >
            {children}
        </Ctx.Provider>
    );
}
