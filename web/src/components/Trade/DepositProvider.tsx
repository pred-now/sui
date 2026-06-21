"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import DepositModal from "@/components/Trade/DepositModal";

const Ctx = createContext<{ open: () => void } | null>(null);

export function useDeposit() {
    const v = useContext(Ctx);
    if (!v) throw new Error("useDeposit must be used within DepositProvider");
    return v;
}

// one deposit modal, openable from the header and the trade panel
export function DepositProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <Ctx.Provider value={{ open: () => setOpen(true) }}>
            {children}
            <DepositModal open={open} onOpenChange={setOpen} />
        </Ctx.Provider>
    );
}
