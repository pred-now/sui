"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useSuiClientQuery } from "@mysten/dapp-kit";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/AuthProvider";
import TokenSelect from "@/components/Trade/TokenSelect";
import { TOKENS, type TokenDef } from "@/lib/tokens";
import {
    getAccount,
    setWithdrawAddress,
    requestWithdraw,
    requestWithdrawSui,
    DUSDC_UNIT,
    SUI_UNIT,
    type Account,
} from "@/lib/account";

const SUI_GAS_BUFFER = 0.02; // leave gas in the proxy

export default function WithdrawModal({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const { user, token } = useAuth();
    const proxy = user?.address ?? "";
    const [asset, setAsset] = useState<TokenDef>(TOKENS[0]);
    const [acct, setAcct] = useState<Account | null>(null);
    const [addr, setAddr] = useState("");
    const [amount, setAmount] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [digest, setDigest] = useState<string | null>(null);

    // proxy SUI balance, for the SUI max
    const suiBal = useSuiClientQuery(
        "getBalance",
        { owner: proxy, coinType: SUI_TYPE_ARG },
        { enabled: !!proxy, refetchInterval: 15000 },
    );

    useEffect(() => {
        if (!open || !token) return;
        let alive = true;
        (async () => {
            setErr("");
            setDigest(null);
            try {
                const a = await getAccount(token);
                if (!alive) return;
                setAcct(a);
                setAddr(a.withdrawAddress ?? "");
            } catch (e) {
                if (alive) setErr(e instanceof Error ? e.message : "failed");
            }
        })();
        return () => {
            alive = false;
        };
    }, [open, token]);

    const maxDisplay =
        asset.key === "USDC"
            ? (acct ? acct.available / DUSDC_UNIT : 0)
            : Math.max(0, Number(suiBal.data?.totalBalance ?? 0) / SUI_UNIT - SUI_GAS_BUFFER);

    const amt = Number(amount);
    const validAddr = /^0x[0-9a-fA-F]{64}$/.test(addr);
    const canSubmit = !busy && validAddr && amt > 0 && amt <= maxDisplay;

    const submit = async () => {
        if (!token) return;
        setBusy(true);
        setErr("");
        try {
            // register or change the destination first
            if (addr !== acct?.withdrawAddress) {
                await setWithdrawAddress(token, addr, !!acct?.withdrawAddress);
            }
            const id = crypto.randomUUID();
            const res =
                asset.key === "USDC"
                    ? await requestWithdraw(token, amt, id)
                    : await requestWithdrawSui(token, amt, id);
            setDigest(res.digest);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "withdraw failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Withdraw</DialogTitle>
                    <DialogDescription>
                        {asset.collateral
                            ? "Withdraw up to your equity. Borrowed funds can never leave."
                            : "Send SUI from your Pred wallet, a little is kept for gas."}
                    </DialogDescription>
                </DialogHeader>

                {!token ? (
                    <p className="text-[12.5px] text-pred-dim">Connect your account first.</p>
                ) : digest ? (
                    <div className="flex flex-col items-center gap-2 py-2 text-center">
                        <CheckCircle2 className="size-7 text-pred-green" />
                        <p className="text-[13px] font-semibold text-pred-text">Withdrawal sent</p>
                        <p className="font-mono text-[11px] break-all text-pred-dimmer">{digest}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <TokenSelect token={asset} onChange={setAsset} />

                        <div>
                            <div className="mb-1.5 text-xs text-pred-dim">Destination address</div>
                            <Input
                                value={addr}
                                placeholder="0x…"
                                onChange={e => setAddr(e.target.value.trim())}
                                className="h-9 font-mono text-xs"
                            />
                        </div>

                        <div>
                            <div className="mb-1.5 flex items-center justify-between text-xs text-pred-dim">
                                <span>Amount ({asset.label})</span>
                                <button
                                    onClick={() => setAmount(String(maxDisplay))}
                                    className="font-semibold text-pred-dim hover:text-pred-text"
                                >
                                    Max {maxDisplay.toLocaleString("en-US", { maximumFractionDigits: asset.decimals === 9 ? 4 : 2 })}
                                </button>
                            </div>
                            <Input
                                value={amount}
                                inputMode="decimal"
                                placeholder="0.00"
                                onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                                className="h-9 text-base font-semibold"
                            />
                        </div>

                        {err && <p className="text-[12px] wrap-break-word text-pred-red">{err}</p>}

                        <Button
                            disabled={!canSubmit}
                            onClick={submit}
                            className="w-full bg-pred-green text-pred-ink hover:bg-pred-green/90"
                        >
                            {busy ? "Withdrawing…" : `Withdraw ${asset.label}`}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
