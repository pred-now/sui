"use client";

import { useEffect, useState } from "react";

import { useAuth, API_URL } from "@/components/AuthProvider";
import { useTrading } from "@/components/Trade/TradingProvider";

// usd ledger balance, deposits credited 1:1 (USDC) or via pyth (SUI)
export default function Balances() {
    const { token } = useAuth();
    const { account } = useTrading();
    const [polled, setPolled] = useState<number | null>(null);

    // 15s poll catches credits from elsewhere (deposits); trading events drive `account` live
    useEffect(() => {
        if (!token) return;
        let alive = true;
        const load = () =>
            fetch(`${API_URL}/account`, { headers: { authorization: `Bearer ${token}` } })
                .then(r => (r.ok ? r.json() : null))
                .then(a => {
                    if (alive && a) setPolled(a.available / 1e6);
                })
                .catch(() => {});
        load();
        const t = setInterval(load, 15000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [token]);

    // prefer the live trading balance, fall back to the poll; blank when logged out
    const live = account ? account.available / 1e6 : null;
    const usd = !token ? null : (live ?? polled);

    return (
        <div className="h-full pr-3 border-r border-border flex items-center gap-1 text-md">
            <span className="font-semibold tabular-nums text-pred-text text-md">
                {usd == null
                    ? "$--"
                    : `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
        </div>
    );
}
