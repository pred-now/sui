import { SUI_TYPE_ARG } from "@mysten/sui/utils";

import { USDC } from "@/lib/config";

export interface TokenDef {
    key: "USDC" | "SUI";
    label: string;
    type: string;
    decimals: number;
    icon: string;
    collateral: boolean;
}

export const TOKENS: TokenDef[] = [
    { key: "USDC", label: "USDC", type: USDC, decimals: 6, icon: "/usdc.svg", collateral: true },
    { key: "SUI", label: "SUI", type: SUI_TYPE_ARG, decimals: 9, icon: "/sui.svg", collateral: false },
];
