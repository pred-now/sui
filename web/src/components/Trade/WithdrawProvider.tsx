"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import WithdrawModal from "@/components/Trade/WithdrawModal";

const Ctx = createContext<{ open: () => void } | null>(null);

export function useWithdraw() {
    const v = useContext(Ctx);
    if (!v) throw new Error("useWithdraw must be used within WithdrawProvider");
    return v;
}

// one withdraw modal, openable from the header and the trade panel
export function WithdrawProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <Ctx.Provider value={{ open: () => setOpen(true) }}>
            {children}
            <WithdrawModal open={open} onOpenChange={setOpen} />
        </Ctx.Provider>
    );
}
