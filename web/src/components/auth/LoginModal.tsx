"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
    useConnectWallet,
    useCurrentAccount,
    useSignPersonalMessage,
    useWallets,
} from "@mysten/dapp-kit";
import { usePrivy } from "@privy-io/react-auth";
import { Wallet, Mail, LogIn } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { useAuth, API_URL } from "@/components/AuthProvider";
import { getEnokiFlow, enokiOn, googleClientId, twitchClientId } from "@/lib/enoki";

const privyOn = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

function Option({
    icon,
    label,
    onClick,
    busy,
}: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    busy?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-lg border border-pred-edge/15 bg-pred-input px-3.5 py-3 text-[13px] font-semibold text-pred-text transition-colors hover:border-pred-edge/40 hover:bg-pred-elevated disabled:opacity-60"
        >
            <span className="text-pred-dim">{icon}</span>
            {busy ? "Connecting..." : label}
        </button>
    );
}

// slush wallet: connect, sign a nonce, exchange for a session
function SlushLogin({ onDone }: { onDone: () => void }) {
    const wallets = useWallets();
    const account = useCurrentAccount();
    const { mutateAsync: connect } = useConnectWallet();
    const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
    const { exchange } = useAuth();
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");

    const onClick = async () => {
        setErr("");
        const slush = wallets.find((w) => /slush|sui wallet/i.test(w.name));
        if (!slush) {
            window.open("https://slush.app", "_blank", "noopener");
            return;
        }
        setBusy(true);
        try {
            let acc = account;
            if (!acc) {
                const res = await connect({ wallet: slush });
                acc = res.accounts[0];
            }
            const challenge = await fetch(`${API_URL}/auth/challenge`, { method: "POST" });
            const { nonce } = await challenge.json();
            const message = new TextEncoder().encode(`Sign in to Pred: ${nonce}`);
            const { signature } = await signPersonalMessage({ message, account: acc! });
            await exchange("/auth/slush", { address: acc!.address, signature, nonce });
            onDone();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "failed");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Option icon={<Wallet className="size-4" />} label="Slush wallet" onClick={onClick} busy={busy} />
            {err && <p className="text-[12px] text-pred-red">{err}</p>}
        </>
    );
}

// google / twitch via enoki: redirect to the provider
function OauthLogin({ provider }: { provider: "google" | "twitch" }) {
    const clientId = provider === "google" ? googleClientId : twitchClientId;
    const label = provider === "google" ? "Continue with Google" : "Continue with Twitch";

    const onClick = async () => {
        const flow = getEnokiFlow();
        if (!flow || !clientId) return;
        sessionStorage.setItem("enoki_provider", provider);
        const url = await flow.createAuthorizationURL({
            provider,
            clientId,
            redirectUrl: `${window.location.origin}/auth/callback`,
            network: "testnet",
        });
        window.location.href = url;
    };

    return <Option icon={<LogIn className="size-4" />} label={label} onClick={onClick} />;
}

// email via privy: open the modal, exchange the access token
function EmailLogin({ onDone }: { onDone: () => void }) {
    const { login, authenticated, getAccessToken } = usePrivy();
    const { exchange } = useAuth();
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (!pending || !authenticated) return;
        (async () => {
            try {
                const token = await getAccessToken();
                if (token) await exchange("/auth/privy", { token });
                onDone();
            } finally {
                setPending(false);
            }
        })();
    }, [pending, authenticated, getAccessToken, exchange, onDone]);

    const onClick = () => {
        setPending(true);
        login({ loginMethods: ["email"] });
    };

    return <Option icon={<Mail className="size-4" />} label="Continue with email" onClick={onClick} busy={pending} />;
}

export default function LoginModal({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
}) {
    const done = () => onOpenChange(false);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect to Pred</DialogTitle>
                    <DialogDescription>
                        We create a secure trading wallet for you on Sui testnet.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <SlushLogin onDone={done} />
                    {enokiOn && googleClientId && <OauthLogin provider="google" />}
                    {enokiOn && twitchClientId && <OauthLogin provider="twitch" />}
                    {privyOn && <EmailLogin onDone={done} />}
                </div>
            </DialogContent>
        </Dialog>
    );
}
