"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Copy, Check } from "lucide-react";
import {
    useCurrentAccount,
    useSignAndExecuteTransaction,
    useSuiClientQuery,
} from "@mysten/dapp-kit";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/AuthProvider";
import TokenSelect from "@/components/Trade/TokenSelect";
import { TOKENS, type TokenDef } from "@/lib/tokens";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function DepositModal({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const { user } = useAuth();
    const proxy = user?.address ?? "";
    const account = useCurrentAccount();
    const canWallet = !!account && user?.provider === "slush" && account.address !== proxy;
    const [token, setToken] = useState<TokenDef>(TOKENS[0]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-100">
                <DialogHeader>
                    <DialogTitle className="text-center">Deposit</DialogTitle>
                    <DialogDescription className="text-center">
                        Fund your Pred account on Sui testnet.
                    </DialogDescription>
                </DialogHeader>

                {!proxy ? (
                    <p className="text-[12.5px] text-pred-dim">Connect your account first.</p>
                ) : (
                    <div className="flex flex-col gap-4">
                        <TokenSelect token={token} onChange={setToken} />

                        {canWallet ? (
                            <Tabs defaultValue="wallet">
                                <TabsList className="w-full bg-pred-input">
                                    <TabsTrigger value="wallet">From wallet</TabsTrigger>
                                    <TabsTrigger value="address">From address</TabsTrigger>
                                </TabsList>
                                <TabsContent value="wallet">
                                    <WalletDeposit
                                        token={token}
                                        from={account!.address}
                                        to={proxy}
                                    />
                                </TabsContent>
                                <TabsContent value="address">
                                    <AddressDeposit address={proxy} />
                                </TabsContent>
                            </Tabs>
                        ) : (
                            <AddressDeposit address={proxy} />
                        )}

                        <Note token={token} />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// send the chosen token from the connected wallet to the proxy
function WalletDeposit({ token, from, to }: { token: TokenDef; from: string; to: string }) {
    const [amount, setAmount] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [digest, setDigest] = useState<string | null>(null);
    const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
    const bal = useSuiClientQuery(
        "getBalance",
        { owner: from, coinType: token.type },
        { refetchInterval: 15000 },
    );

    const gasBuffer = token.key === "SUI" ? 0.05 : 0; // leave SUI for gas
    const maxDisplay = Math.max(0, Number(bal.data?.totalBalance ?? 0) / 10 ** token.decimals - gasBuffer);

    const submit = async () => {
        setBusy(true);
        setErr("");
        try {
            const base = BigInt(Math.round(Number(amount) * 10 ** token.decimals));
            const tx = new Transaction();
            if (token.key === "SUI") {
                const [coin] = tx.splitCoins(tx.gas, [base]);
                tx.transferObjects([coin], to);
            } else {
                tx.transferObjects([coinWithBalance({ type: token.type, balance: base })], to);
            }
            const res = await signAndExecute({ transaction: tx });
            setDigest(res.digest);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "deposit failed");
        } finally {
            setBusy(false);
        }
    };

    if (digest) return <Success digest={digest} />;

    const amt = Number(amount);
    return (
        <div className="flex flex-col gap-3 pt-3">
            <div className="text-[11px] text-pred-dimmer">From {short(from)}</div>
            <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-pred-dim">
                    <span>Amount ({token.label})</span>
                    <button
                        onClick={() => setAmount(String(maxDisplay))}
                        className="font-semibold text-pred-dim hover:text-pred-text"
                    >
                        Max {maxDisplay.toLocaleString("en-US", { maximumFractionDigits: token.decimals === 9 ? 4 : 2 })}
                    </button>
                </div>
                <Input
                    value={amount}
                    inputMode="decimal"
                    placeholder="0.00"
                    onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="h-10 text-base font-semibold"
                />
            </div>
            {err && <p className="text-[12px] wrap-break-word text-pred-red">{err}</p>}
            <Button
                disabled={busy || !(amt > 0) || amt > maxDisplay}
                onClick={submit}
                className="w-full bg-pred-green text-pred-ink hover:bg-pred-green/90"
            >
                {busy ? "Depositing…" : `Deposit ${token.label}`}
            </Button>
        </div>
    );
}

// show the proxy address and a QR for an external transfer
function AddressDeposit({ address }: { address: string }) {
    const [qr, setQr] = useState("");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        QRCode.toDataURL(address, {
            margin: 1,
            width: 200,
            color: { dark: "#0b0f12", light: "#ffffff" },
        })
            .then(setQr)
            .catch(() => setQr(""));
    }, [address]);

    const copy = () => {
        navigator.clipboard?.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex flex-col items-center gap-3 pt-3">
            <div className="rounded-xl bg-white p-2.5">
                {qr ? (
                    <Image src={qr} alt="deposit address QR" width={180} height={180} unoptimized className="size-45" />
                ) : (
                    <div className="size-45" />
                )}
            </div>
            <div className="w-full">
                <div className="mb-1.5 text-xs text-pred-dim">Your deposit address</div>
                <div className="rounded-lg border border-pred-edge/15 bg-pred-input px-3 py-2 font-mono text-[12px] break-all text-pred-text select-all">
                    {address}
                </div>
            </div>
            <Button variant="outline" onClick={copy} className="w-full">
                {copied ? (
                    <>
                        <Check className="size-4" /> Copied
                    </>
                ) : (
                    <>
                        <Copy className="size-4" /> Copy address
                    </>
                )}
            </Button>
        </div>
    );
}

function Success({ digest }: { digest: string }) {
    return (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Check className="size-7 text-pred-green" />
            <p className="text-[13px] font-semibold text-pred-text">
                Deposit sent, crediting shortly
            </p>
            <p className="font-mono text-[11px] break-all text-pred-dimmer">{digest}</p>
        </div>
    );
}

function Note({ token }: { token: TokenDef }) {
    return (
        <p className="text-[11px] leading-relaxed text-pred-dimmer">
            {token.collateral
                ? "USDC is credited to your USD balance 1:1. "
                : "SUI is credited to your USD balance at the current price. "}
            Only send {token.label} on Sui testnet.
        </p>
    );
}
