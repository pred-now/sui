"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createNetworkConfig, SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { PrivyProvider } from "@privy-io/react-auth";

import { AuthProvider } from "@/components/AuthProvider";
import { DepositProvider } from "@/components/Trade/DepositProvider";
import { WithdrawProvider } from "@/components/Trade/WithdrawProvider";

import "@mysten/dapp-kit/dist/index.css";

const { networkConfig } = createNetworkConfig({
    testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" },
});
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

// only mount Privy when an app id is configured
function WithPrivy({ children }: { children: ReactNode }) {
    if (!privyAppId) return <>{children}</>;
    return (
        <PrivyProvider appId={privyAppId} config={{ loginMethods: ["email"] }}>
            {children}
        </PrivyProvider>
    );
}

export default function Providers({ children }: { children: ReactNode }) {
    const [qc] = useState(() => new QueryClient());
    return (
        <QueryClientProvider client={qc}>
            <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
                <WalletProvider autoConnect>
                    <WithPrivy>
                        <AuthProvider>
                            <DepositProvider>
                                <WithdrawProvider>{children}</WithdrawProvider>
                            </DepositProvider>
                        </AuthProvider>
                    </WithPrivy>
                </WalletProvider>
            </SuiClientProvider>
        </QueryClientProvider>
    );
}
